import crypto from 'node:crypto';
import { type Logger } from '../types/logger.types.js';
import {
  type Conversation,
  type ConversationMessage,
  type ConversationFilter,
  type ConversationListResult,
  type TokenUsage,
  type CompressionState,
  type ContentBlockData,
} from '../types/conversation.types.js';
import { ConversationRepository } from '../repositories/conversation-repository.js';

/**
 * ConversationService — manages shared, provider-independent conversations.
 *
 * Key design: conversations are identified by a stable conversation ID
 * passed by the client. When a provider fails mid-conversation, the
 * next provider picks up with the full conversation history intact.
 */

export class ConversationService {
  private static readonly TOKEN_COST_PER_INPUT = 0.000003;
  private static readonly TOKEN_COST_PER_OUTPUT = 0.000015;
  private static readonly MAX_MESSAGES_BEFORE_COMPRESSION = 20;
  private static readonly MAX_TOKENS_BEFORE_COMPRESSION = 8000;

  constructor(
    private readonly repository: ConversationRepository,
    private readonly logger: Logger,
  ) {}

  /**
   * Get or create a conversation from an incoming request.
   * If the client sends a conversation ID, we resume that conversation.
   * Otherwise, we create a new one.
   */
  getOrCreate(params: {
    conversationId?: string;
    clientType: string;
    model: string;
    systemPrompt?: string;
    messages?: Array<{ role: string; content: string | unknown }>;
    provider?: string;
  }): { conversation: Conversation; isNew: boolean } {
    let conv: Conversation | null = null;

    // Try to resume existing conversation
    if (params.conversationId) {
      conv = this.repository.get(params.conversationId);
    }

    if (conv) {
      // Update existing conversation
      this.repository.update(conv.id, {
        model: params.model,
        lastProvider: params.provider || conv.lastProvider,
        active: true,
      });

      return { conversation: conv, isNew: false };
    }

    // Create new conversation
    const now = new Date().toISOString();
    const newConv: Conversation = {
      id: params.conversationId || `conv_${crypto.randomUUID().slice(0, 12)}`,
      externalId: params.conversationId,
      clientType: params.clientType,
      model: params.model,
      systemPrompt: params.systemPrompt,
      lastProvider: params.provider,
      active: true,
      createdAt: now,
      updatedAt: now,
      messages: [],
      metadata: {},
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 },
      compression: {
        enabled: true,
        compressionCount: 0,
        tokensSaved: 0,
        strategy: 'truncate',
      },
    };

    this.repository.create(newConv);
    this.logger.info(`Conversation created: ${newConv.id}`, { clientType: params.clientType, model: params.model });

    return { conversation: newConv, isNew: true };
  }

  /**
   * Add messages from a request/response cycle to the conversation.
   */
  addMessages(
    conversationId: string,
    requestMessages: Array<{ role: string; content: string | unknown }>,
    responseContent: string,
    provider: string,
    tokens?: { input: number; output: number },
  ): void {
    const now = new Date().toISOString();

    // Add each user message
    for (const msg of requestMessages) {
      const message: ConversationMessage = {
        id: `msg_${crypto.randomUUID().slice(0, 8)}`,
        role: msg.role as ConversationMessage['role'],
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        timestamp: now,
        provider,
      };
      this.repository.addMessage(conversationId, message);
    }

    // Add response
    const responseMessage: ConversationMessage = {
      id: `msg_${crypto.randomUUID().slice(0, 8)}`,
      role: 'assistant',
      content: responseContent,
      timestamp: now,
      tokens: tokens?.output,
      provider,
    };
    this.repository.addMessage(conversationId, responseMessage);

    // Update token usage
    if (tokens) {
      const conv = this.repository.get(conversationId);
      if (conv) {
        const usage: TokenUsage = {
          inputTokens: conv.tokenUsage.inputTokens + tokens.input,
          outputTokens: conv.tokenUsage.outputTokens + tokens.output,
          totalTokens: conv.tokenUsage.totalTokens + tokens.input + tokens.output,
          estimatedCost: conv.tokenUsage.estimatedCost +
            (tokens.input * ConversationService.TOKEN_COST_PER_INPUT) +
            (tokens.output * ConversationService.TOKEN_COST_PER_OUTPUT),
        };
        this.repository.update(conversationId, { tokenUsage: usage });
      }
    }

    // Check if compression is needed
    this._maybeCompress(conversationId);
  }

  /**
   * Add tool call and tool result messages.
   */
  addToolMessages(
    conversationId: string,
    toolCalls: Array<{ id: string; name: string; arguments: string }>,
    toolResults: Array<{ id: string; content: string }>,
    provider: string,
  ): void {
    const now = new Date().toISOString();

    for (const tc of toolCalls) {
      const msg: ConversationMessage = {
        id: `msg_${crypto.randomUUID().slice(0, 8)}`,
        role: 'assistant',
        content: JSON.stringify(tc),
        timestamp: now,
        provider,
        toolCalls: [{
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        }],
      };
      this.repository.addMessage(conversationId, msg);
    }

    for (const tr of toolResults) {
      const msg: ConversationMessage = {
        id: `msg_${crypto.randomUUID().slice(0, 8)}`,
        role: 'tool',
        content: tr.content,
        timestamp: now,
        provider,
        toolCallId: tr.id,
      };
      this.repository.addMessage(conversationId, msg);
    }
  }

  /**
   * Build the message array for a new request, including all conversation history.
   */
  buildRequestMessages(conversationId: string, newMessages: Array<{ role: string; content: unknown }>): Array<{ role: string; content: unknown }> {
    const conv = this.repository.get(conversationId);
    if (!conv) return newMessages;

    const history = conv.messages
      .filter(m => !m.compressed || m.role === 'system')
      .map(m => ({
        role: m.role,
        content: m.originalContent ? JSON.parse(m.originalContent) : m.content,
      }));

    return [...history, ...newMessages];
  }

  /**
   * Get conversation history for debugging/inspection.
   */
  get(id: string): Conversation | null {
    return this.repository.get(id);
  }

  /**
   * List conversations.
   */
  list(filter: ConversationFilter): ConversationListResult {
    return this.repository.list(filter);
  }

  /**
   * Get messages for a conversation.
   */
  getMessages(conversationId: string): ConversationMessage[] {
    return this.repository.getMessages(conversationId);
  }

  /**
   * Archive old conversations.
   */
  archive(days: number): number {
    return this.repository.archive(days);
  }

  /**
   * Update a conversation's provider (for failover).
   */
  updateProvider(conversationId: string, newProvider: string): void {
    this.repository.update(conversationId, { lastProvider: newProvider });
    this.logger.info(`Conversation ${conversationId} now using provider: ${newProvider}`);
  }

  /**
   * Get file attachments for a conversation.
   */
  getFiles(conversationId: string) {
    return this.repository.getFiles(conversationId);
  }

  /**
   * Check if context compression is needed and perform it.
   */
  private _maybeCompress(conversationId: string): void {
    const conv = this.repository.get(conversationId);
    if (!conv || !conv.compression?.enabled) return;

    const messages = conv.messages;
    const totalTokens = conv.tokenUsage.totalTokens;

    if (messages.length > ConversationService.MAX_MESSAGES_BEFORE_COMPRESSION ||
        totalTokens > ConversationService.MAX_TOKENS_BEFORE_COMPRESSION) {
      this._compress(conv);
    }
  }

  /**
   * Compress conversation context by summarizing old messages.
   * Preserves the most recent messages and compresses older ones.
   */
  private _compress(conv: Conversation): void {
    const messages = conv.messages;
    if (messages.length < 4) return;

    const keepRecent = 6; // Keep last 6 messages as-is
    const compressible = messages.slice(0, messages.length - keepRecent);

    if (compressible.length < 2) return;

    let tokensSaved = 0;
    let compressedCount = 0;

    for (const msg of compressible) {
      if (msg.compressed) continue;
      if (typeof msg.content !== 'string') continue;

      const content = msg.content;
      // Store original content
      msg.originalContent = content;

      // Compress: truncate long messages, keep structure
      if (content.length > 200) {
        msg.content = content.slice(0, 100) + '...[compressed]';
      }

      msg.compressed = true;
      compressedCount++;
      tokensSaved += Math.ceil(content.length / 4);
    }

    // Update compression stats
    const compression: CompressionState = {
      ...conv.compression!,
      lastCompressedAt: new Date().toISOString(),
      compressionCount: (conv.compression?.compressionCount || 0) + compressedCount,
      tokensSaved: (conv.compression?.tokensSaved || 0) + tokensSaved,
    };

    // Store compression state in DB
    const convRow = this.repository.get(conv.id);
    if (convRow) {
      // We store compression info in metadata
      const metadata = { ...convRow.metadata, compression };
      this.repository.update(conv.id, { metadata });
    }

    this.logger.info(`Conversation ${conv.id} compressed: saved ${tokensSaved} tokens across ${compressedCount} messages`);
  }
}

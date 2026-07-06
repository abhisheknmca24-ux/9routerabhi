import crypto from 'node:crypto';
import { type Logger } from '../types/logger.types.js';
import {
  type Conversation,
  type ConversationMessage,
  type ConversationFilter,
  type ConversationListResult,
  type TokenUsage,
  type CompressionState,
} from '../types/conversation.types.js';
import { ConversationRepository } from '../repositories/conversation-repository.js';

/**
 * ConversationService — manages shared, provider-independent conversations.
 *
 * Key design: conversations are identified by a stable conversation ID
 * (msg_xxx) passed by the client. When a provider fails mid-conversation,
 * the next provider receives the FULL conversation context:
 *   - system prompt
 *   - all previous messages (user, assistant, tool)
 *   - assistant response history
 *   - tool calls and results
 *   - file attachments
 *   - conversation state (active, metadata, compression)
 *
 * The client never knows failover occurred. Conversation IDs remain identical.
 */

export class ConversationService {
  private static readonly TOKEN_COST_PER_INPUT = 0.000003;
  private static readonly TOKEN_COST_PER_OUTPUT = 0.000015;
  private static readonly MAX_MESSAGES_BEFORE_COMPRESSION = 30;
  private static readonly MAX_TOKENS_BEFORE_COMPRESSION = 12000;

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

    if (params.conversationId) {
      conv = this.repository.get(params.conversationId);
    }

    if (conv) {
      this.repository.update(conv.id, {
        model: params.model,
        lastProvider: params.provider || conv.lastProvider,
        active: true,
      });
      return { conversation: conv, isNew: false };
    }

    const now = new Date().toISOString();
    const newConv: Conversation = {
      id: params.conversationId || `msg_${crypto.randomUUID().slice(0, 12)}`,
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
   * Build the FULL message array for a new provider request, including:
   * - system prompt
   * - all previous messages in order
   * - assistant responses
   * - tool calls and results
   * - attachments as context
   *
   * This is what makes failover transparent — the new provider gets
   * the complete conversation history.
   */
  buildFullRequest(conversationId: string): {
    systemPrompt?: string;
    messages: Array<{ role: string; content: unknown }>;
    attachments: Array<{ name: string; mimeType: string; type: string }>;
  } {
    const conv = this.repository.get(conversationId);
    if (!conv) {
      return { messages: [], attachments: [] };
    }

    // 1. System prompt
    const systemPrompt = conv.systemPrompt;

    // 2. All messages (including tool calls, tool results, compressed messages)
    const messages: Array<{ role: string; content: unknown }> = [];

    for (const msg of conv.messages) {
      const entry: { role: string; content: unknown } = {
        role: msg.role,
        content: msg.originalContent ? JSON.parse(msg.originalContent) : msg.content,
      };

      // Preserve tool call metadata
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        (entry as any).tool_calls = msg.toolCalls;
      }
      if (msg.toolCallId) {
        (entry as any).tool_call_id = msg.toolCallId;
      }

      messages.push(entry);
    }

    // 3. Attachments
    const attachments = this.repository.getFiles(conversationId).map(f => ({
      name: f.name,
      mimeType: f.mimeType,
      type: f.type,
    }));

    return { systemPrompt, messages, attachments };
  }

  /**
   * Add messages from a request/response cycle to the conversation.
   */
  addMessages(
    conversationId: string,
    requestMessages: Array<{ role: string; content: string | unknown; tool_calls?: Array<unknown>; tool_call_id?: string }>,
    responseContent: string,
    provider: string,
    tokens?: { input: number; output: number },
  ): void {
    const now = new Date().toISOString();

    for (const msg of requestMessages) {
      const message: ConversationMessage = {
        id: `msg_${crypto.randomUUID().slice(0, 8)}`,
        role: msg.role as ConversationMessage['role'],
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        timestamp: now,
        provider,
        toolCalls: msg.tool_calls as ConversationMessage['toolCalls'],
        toolCallId: msg.tool_call_id,
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

    this._maybeCompress(conversationId);
  }

  /**
   * Update provider after failover — the conversation ID stays the same,
   * only the provider reference changes.
   */
  onProviderFailover(conversationId: string, failedProvider: string, newProvider: string): void {
    this.repository.update(conversationId, { lastProvider: newProvider });

    // Log the failover event in metadata
    const conv = this.repository.get(conversationId);
    if (conv) {
      const failoverEvents = (conv.metadata?.failoverEvents as Array<Record<string, unknown>>) ?? [];
      failoverEvents.push({
        from: failedProvider,
        to: newProvider,
        timestamp: new Date().toISOString(),
      });
      this.repository.update(conversationId, {
        metadata: { ...conv.metadata, failoverEvents, lastFailoverAt: new Date().toISOString() },
      });
    }

    this.logger.info(`Conversation ${conversationId} failed over: ${failedProvider} → ${newProvider}`);
  }

  /**
   * Attach a file to a conversation.
   */
  attachFile(
    conversationId: string,
    file: { name: string; mimeType: string; data?: string; size: number; type: string },
  ): string {
    const fileId = `file_${crypto.randomUUID().slice(0, 8)}`;
    this.repository.addFile(conversationId, { id: fileId, ...file });
    return fileId;
  }

  /**
   * Get conversation history for debugging.
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
   * Get file attachments.
   */
  getFiles(conversationId: string) {
    return this.repository.getFiles(conversationId);
  }

  /**
   * Archive old conversations (mark inactive).
   */
  archive(days: number): number {
    return this.repository.archive(days);
  }

  // ─── Private ───

  private _maybeCompress(conversationId: string): void {
    const conv = this.repository.get(conversationId);
    if (!conv || !conv.compression?.enabled) return;

    if (conv.messages.length > ConversationService.MAX_MESSAGES_BEFORE_COMPRESSION ||
        conv.tokenUsage.totalTokens > ConversationService.MAX_TOKENS_BEFORE_COMPRESSION) {
      this._compress(conv);
    }
  }

  private _compress(conv: Conversation): void {
    const messages = conv.messages;
    if (messages.length < 4) return;

    const keepRecent = 8;
    const compressible = messages.slice(0, messages.length - keepRecent);
    if (compressible.length < 2) return;

    let tokensSaved = 0;
    let compressedCount = 0;

    for (const msg of compressible) {
      if (msg.compressed) continue;
      if (typeof msg.content !== 'string') continue;

      msg.originalContent = msg.content;

      if (msg.content.length > 300) {
        msg.content = msg.content.slice(0, 150) + '...[compressed]';
      }

      msg.compressed = true;
      compressedCount++;
      tokensSaved += Math.ceil(msg.content.length / 4);
    }

    if (compressedCount > 0) {
      const compression: CompressionState = {
        ...conv.compression!,
        lastCompressedAt: new Date().toISOString(),
        compressionCount: (conv.compression?.compressionCount || 0) + compressedCount,
        tokensSaved: (conv.compression?.tokensSaved || 0) + tokensSaved,
      };

      const convRow = this.repository.get(conv.id);
      if (convRow) {
        this.repository.update(conv.id, { metadata: { ...convRow.metadata, compression } });
      }
    }
  }
}

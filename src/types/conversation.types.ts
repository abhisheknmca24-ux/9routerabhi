/** Shared conversation continuity — provider-independent conversation state */

export interface Conversation {
  /** Unique conversation ID */
  id: string;
  /** Client-provided conversation ID if any */
  externalId?: string;
  /** Client type that created this */
  clientType: string;
  /** The model originally requested */
  model: string;
  /** System prompt */
  systemPrompt?: string;
  /** All messages in the conversation */
  messages: ConversationMessage[];
  /** Provider that last handled this conversation */
  lastProvider?: string;
  /** Whether conversation is active */
  active: boolean;
  /** ISO timestamps */
  createdAt: string;
  updatedAt: string;
  /** Metadata */
  metadata: Record<string, unknown>;
  /** Token usage across the conversation */
  tokenUsage: TokenUsage;
  /** Context compression settings */
  compression?: CompressionState;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | ContentBlockData[];
  timestamp: string;
  tokens?: number;
  /** Reference to the provider that generated this */
  provider?: string;
  /** Whether this message was compressed */
  compressed?: boolean;
  /** Original content before compression (stored separately) */
  originalContent?: string;
  /** Tool calls if any */
  toolCalls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
  /** Tool result ID if this is a tool result */
  toolCallId?: string;
  /** File attachments */
  attachments?: ConversationAttachment[];
}

export type ContentBlockData = {
  type: 'text' | 'image' | 'tool_use' | 'tool_result' | 'document';
  text?: string;
  imageData?: string;
  mediaType?: string;
  toolUseId?: string;
  toolName?: string;
  input?: Record<string, unknown>;
  content?: string | ContentBlockData[];
  isError?: boolean;
  source?: { type: string; media_type: string; data?: string; url?: string };
};

export interface ConversationAttachment {
  type: 'image' | 'file' | 'code';
  name: string;
  mimeType: string;
  /** Base64 encoded data or reference */
  data?: string;
  /** File reference if stored in DB */
  fileRef?: string;
  size: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface CompressionState {
  enabled: boolean;
  lastCompressedAt?: string;
  compressionCount: number;
  tokensSaved: number;
  strategy: 'truncate' | 'summarize' | 'drop-images' | 'none';
}

export interface ConversationFilter {
  search?: string;
  clientType?: string;
  model?: string;
  active?: boolean;
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'tokenUsage';
  sortOrder?: 'asc' | 'desc';
}

export interface ConversationListResult {
  conversations: ConversationSummary[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ConversationSummary {
  id: string;
  clientType: string;
  model: string;
  messageCount: number;
  lastProvider?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  tokenUsage: TokenUsage;
}

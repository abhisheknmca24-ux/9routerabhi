/**
 * Universal API types — normalized request/response shared across all clients.
 */

/** Known supported clients */
export type ClientType =
  | 'claude-desktop'
  | 'claude-code'
  | 'claude-cli'
  | 'cursor'
  | 'continue-dev'
  | 'roo-code'
  | 'cline'
  | 'vscode-ai'
  | 'openai-compatible'
  | 'anthropic-compatible'
  | 'unknown';

/** API protocol detected */
export type ProtocolType =
  | 'openai-chat'       // POST /v1/chat/completions
  | 'anthropic-messages' // POST /v1/messages
  | 'openai-models'     // GET /v1/models
  | 'anthropic-models'  // GET /v1/models (Anthropic)
  | 'health'            // GET /api/health
  | 'unknown';

/** Normalized message role */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

/** Normalized content block */
export interface ContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result';
  text?: string;
  imageUrl?: { url: string };
  toolUseId?: string;
  toolName?: string;
  content?: string | ContentBlock[];
}

/** Normalized request — independent of incoming protocol */
export interface SharedRequest {
  /** The raw model name from the client */
  model: string;
  /** Resolved model after alias/combo resolution */
  resolvedModel?: string;
  /** Conversation messages */
  messages: SharedMessage[];
  /** System prompt(s) */
  system?: string | SharedMessage[];
  /** Max tokens to generate */
  maxTokens?: number;
  /** Temperature (0-2) */
  temperature?: number;
  /** Top-p sampling */
  topP?: number;
  /** Stop sequences */
  stop?: string[];
  /** Whether streaming was requested */
  stream: boolean;
  /** Extra provider-specific parameters */
  extraParams?: Record<string, unknown>;
  /** Client that sent this request */
  client: ClientInfo;
}

export interface SharedMessage {
  role: MessageRole;
  content: string | ContentBlock[];
  name?: string;
  toolCallId?: string;
  toolCalls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
}

/** Client identification context */
export interface ClientInfo {
  type: ClientType;
  protocol: ProtocolType;
  userAgent: string;
  ip: string;
  clientVersion?: string;
}

/** Normalized response chunk (for streaming) */
export interface SharedResponseChunk {
  type: 'text' | 'text_delta' | 'done' | 'error' | 'tool_call' | 'tool_result';
  content?: string;
  delta?: string;
  finishReason?: 'stop' | 'length' | 'error' | 'tool_calls';
  toolCalls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
}

/** Normalized complete response */
export interface SharedResponse {
  content: string;
  finishReason?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  model: string;
}

/** Streaming callback type */
export interface StreamCallbacks {
  onToken: (chunk: SharedResponseChunk) => void;
  onDone: (response: SharedResponse) => void;
  onError: (error: Error) => void;
}

/** Client detection result */
export interface DetectionResult {
  client: ClientType;
  protocol: ProtocolType;
  confidence: number; // 0.0 - 1.0
}

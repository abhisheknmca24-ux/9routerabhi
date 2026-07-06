import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SharedRequest, SharedResponse, SharedResponseChunk, ClientInfo } from '../types/api.types.js';

/** Standardized pipeline context — flows through every stage */
export interface PipelineContext {
  /** Unique request ID */
  requestId: string;
  /** Raw incoming HTTP request */
  req: IncomingMessage;
  /** Raw outgoing HTTP response */
  res: ServerResponse;
  /** Parsed request body */
  body: Record<string, unknown>;

  /** Client identification (populated by ClientDetectionStage) */
  clientInfo?: ClientInfo;
  /** Normalized request (populated by ProtocolParsingStage) */
  sharedRequest?: SharedRequest;
  /** Resolved model target after alias lookup */
  resolvedModel?: string;
  /** Whether this model was resolved via alias */
  isAliased?: boolean;
  /** The alias that was resolved, if any */
  resolvedAlias?: { name: string; target: string; targetType: string };
  /** Prompt analysis result */
  promptAnalysis?: PromptAnalysis;
  /** Selected combo/profile info */
  comboSelection?: ComboSelection;
  /** Provider health snapshot at decision time */
  providerHealthSnapshot?: Record<string, unknown>;
  /** Whether to stream the response */
  stream: boolean;
  /** Error if any stage failed */
  error?: PipelineError;

  /** Response data (populated by ProviderExecutionStage) */
  responseData?: SharedResponse;
  /** Streamed chunks for streaming responses */
  streamChunks?: SharedResponseChunk[];

  /** Request timeline (populated by pipeline) */
  timeline: TimelineEntry[];
  /** Custom metadata for hooks/plugins */
  metadata: Record<string, unknown>;
}

export interface PipelineError {
  code: string;
  message: string;
  stage: string;
  retryable: boolean;
  statusCode: number;
}

export interface TimelineEntry {
  stage: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  data?: Record<string, unknown>;
}

export interface PromptAnalysis {
  modelFamily: string;
  estimatedTokens: number;
  hasImages: boolean;
  hasTools: boolean;
  messageCount: number;
  systemPromptLength: number;
}

export interface ComboSelection {
  name: string;
  providers: string[];
  fallbackChain: string[];
}

/** Hook that runs before/after a stage */
export interface PipelineHook {
  name: string;
  before?: (ctx: PipelineContext) => Promise<void> | void;
  after?: (ctx: PipelineContext) => Promise<void> | void;
}

/** Plugin registration */
export interface PipelinePlugin {
  name: string;
  hooks?: PipelineHook[];
  /** Additional stages to inject at a specific position */
  stages?: Array<{ stage: PipelineStage; before?: string; after?: string }>;
}

/** Single stage in the pipeline */
export interface PipelineStage {
  name: string;
  execute(ctx: PipelineContext): Promise<void>;
}

/**
 * Complete Anthropic API Formatter
 *
 * Converts responses from the internal routing engine into exact
 * Anthropic-compatible responses that Claude Desktop accepts natively.
 *
 * Supports:
 *   - /v1/messages (non-streaming)
 *   - SSE streaming with all 7 event types
 *   - Content blocks (text, image, tool_use, tool_result)
 *   - Tool use / function calling
 *   - Thinking blocks (extended thinking)
 *   - Usage statistics
 *   - Stop reasons (end_turn, max_tokens, stop_sequence, tool_use)
 *   - Error responses
 *   - System prompts
 *   - Conversation IDs (msg_xxx)
 *   - Request IDs
 *   - Metadata
 *   - Images (base64 and URL)
 *   - Documents (PDF, text)
 *   - JSON mode
 */

import crypto from 'node:crypto';
import type { SharedResponse, SharedResponseChunk, SharedMessage } from '../types/api.types.js';

export interface AnthropicMessageRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string | AnthropicTextBlock[];
  max_tokens: number;
  metadata?: Record<string, string>;
  stop_sequences?: string[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  tools?: AnthropicTool[];
  tool_choice?: { type: 'auto' | 'any' | 'tool'; name?: string };
  thinking?: { type: 'enabled'; budget_tokens: number };
}

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | AnthropicThinkingBlock
  | AnthropicDocumentBlock;

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

export interface AnthropicImageBlock {
  type: 'image';
  source: {
    type: 'base64' | 'url';
    media_type: string;
    data?: string;
    url?: string;
  };
}

export interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | AnthropicContentBlock[];
  is_error?: boolean;
}

export interface AnthropicThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature?: string;
}

export interface AnthropicDocumentBlock {
  type: 'document';
  source: {
    type: 'base64' | 'url' | 'text';
    media_type: string;
    data?: string;
    url?: string;
  };
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface AnthropicStreamEvent {
  event: string;
  data: string;
}

export class AnthropicFormatter {
  private readonly _baseId: string;

  constructor() {
    this._baseId = crypto.randomBytes(4).toString('hex');
  }

  /** Generate a unique message ID */
  messageId(): string {
    return `msg_${this._baseId}_${Date.now().toString(36)}`;
  }

  /** Generate a unique request ID */
  requestId(): string {
    return `req_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
  }

  // ═══════════════════════════════════════════════════════════════
  //  Non-Streaming Response
  // ═══════════════════════════════════════════════════════════════

  /**
   * Format a complete /v1/messages response from internal response data.
   */
  formatResponse(params: {
    model: string;
    content: string;
    finishReason?: string;
    inputTokens?: number;
    outputTokens?: number;
    stopSequence?: string | null;
    tools?: Array<{ id: string; name: string; arguments: string }>;
    thinking?: string;
  }): AnthropicResponse {
    const content: AnthropicContentBlock[] = [];

    // Add thinking block if present
    if (params.thinking) {
      content.push({
        type: 'thinking',
        thinking: params.thinking,
        signature: `sig_${crypto.randomBytes(8).toString('hex')}`,
      });
    }

    // Add text content
    if (params.content) {
      content.push({ type: 'text', text: params.content });
    }

    // Add tool use blocks
    if (params.tools && params.tools.length > 0) {
      for (const tool of params.tools) {
        content.push({
          type: 'tool_use',
          id: tool.id || `toolu_${crypto.randomBytes(8).toString('hex')}`,
          name: tool.name,
          input: JSON.parse(tool.arguments || '{}'),
        });
      }
    }

    // Map stop reason
    const stopReason = this._mapStopReason(params.finishReason, params.tools);

    return {
      id: this.messageId(),
      type: 'message',
      role: 'assistant',
      content,
      model: params.model,
      stop_reason: stopReason,
      stop_sequence: params.stopSequence ?? null,
      usage: {
        input_tokens: params.inputTokens ?? 0,
        output_tokens: params.outputTokens ?? 0,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  Streaming — Full Event Sequence
  // ═══════════════════════════════════════════════════════════════

  /**
   * Generate the `message_start` event.
   */
  messageStart(params: {
    model: string;
    content?: string;
    inputTokens?: number;
    outputTokens?: number;
    stopReason?: string | null;
    tools?: Array<{ id: string; name: string; arguments: string }>;
    thinking?: string;
  }): AnthropicStreamEvent {
    const content: AnthropicContentBlock[] = [];

    if (params.thinking) {
      content.push({
        type: 'thinking',
        thinking: params.thinking,
        signature: `sig_${crypto.randomBytes(8).toString('hex')}`,
      });
    }

    return {
      event: 'message_start',
      data: JSON.stringify({
        type: 'message_start',
        message: {
          id: this.messageId(),
          type: 'message',
          role: 'assistant',
          content,
          model: params.model,
          stop_reason: this._mapStopReason(params.stopReason || null, params.tools),
          stop_sequence: null,
          usage: {
            input_tokens: params.inputTokens ?? 0,
            output_tokens: params.outputTokens ?? 0,
          },
        },
      }),
    };
  }

  /**
   * Generate `content_block_start` for a text block.
   */
  contentBlockStart(index: number, text: string): AnthropicStreamEvent {
    return {
      event: 'content_block_start',
      data: JSON.stringify({
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text },
      }),
    };
  }

  /**
   * Generate `content_block_start` for a thinking block.
   */
  thinkingBlockStart(index: number, thinking: string): AnthropicStreamEvent {
    return {
      event: 'content_block_start',
      data: JSON.stringify({
        type: 'content_block_start',
        index,
        content_block: { type: 'thinking', thinking },
      }),
    };
  }

  /**
   * Generate `content_block_start` for a tool_use block.
   */
  toolUseBlockStart(index: number, id: string, name: string): AnthropicStreamEvent {
    return {
      event: 'content_block_start',
      data: JSON.stringify({
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id, name, input: {} },
      }),
    };
  }

  /**
   * Generate `content_block_delta` for a text delta.
   */
  contentBlockDelta(index: number, delta: string): AnthropicStreamEvent {
    return {
      event: 'content_block_delta',
      data: JSON.stringify({
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text: delta },
      }),
    };
  }

  /**
   * Generate `content_block_delta` for a thinking delta.
   */
  thinkingDelta(index: number, delta: string): AnthropicStreamEvent {
    return {
      event: 'content_block_delta',
      data: JSON.stringify({
        type: 'content_block_delta',
        index,
        delta: { type: 'thinking_delta', thinking: delta },
      }),
    };
  }

  /**
   * Generate `content_block_delta` for input JSON (tool_use).
   */
  inputJsonDelta(index: number, partialJson: string): AnthropicStreamEvent {
    return {
      event: 'content_block_delta',
      data: JSON.stringify({
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: partialJson },
      }),
    };
  }

  /**
   * Generate `content_block_stop`.
   */
  contentBlockStop(index: number): AnthropicStreamEvent {
    return {
      event: 'content_block_stop',
      data: JSON.stringify({ type: 'content_block_stop', index }),
    };
  }

  /**
   * Generate `message_delta`.
   */
  messageDelta(params: {
    stopReason?: string | null;
    stopSequence?: string | null;
    outputTokens?: number;
  }): AnthropicStreamEvent {
    return {
      event: 'message_delta',
      data: JSON.stringify({
        type: 'message_delta',
        delta: {
          stop_reason: this._mapStopReason(params.stopReason || null),
          stop_sequence: params.stopSequence ?? null,
        },
        usage: {
          output_tokens: params.outputTokens ?? 0,
        },
      }),
    };
  }

  /**
   * Generate `message_stop`.
   */
  messageStop(): AnthropicStreamEvent {
    return {
      event: 'message_stop',
      data: JSON.stringify({ type: 'message_stop' }),
    };
  }

  /**
   * Generate `ping` (keepalive).
   */
  ping(): AnthropicStreamEvent {
    return { event: 'ping', data: JSON.stringify({ type: 'ping' }) };
  }

  /**
   * Generate an `error` event.
   */
  error(params: {
    type: string;
    message: string;
  }): AnthropicStreamEvent {
    return {
      event: 'error',
      data: JSON.stringify({
        type: 'error',
        error: {
          type: params.type,
          message: params.message,
        },
      }),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  SSE Helpers
  // ═══════════════════════════════════════════════════════════════

  /** Render a stream event as an SSE string */
  renderEvent(event: AnthropicStreamEvent): string {
    return `event: ${event.event}\ndata: ${event.data}\n\n`;
  }

  /** Render a full streaming sequence from a SharedResponse */
  renderStream(
    response: SharedResponse,
    options?: {
      thinking?: string;
      tools?: Array<{ id: string; name: string; arguments: string }>;
      inputTokens?: number;
    },
  ): string {
    let output = '';
    let blockIndex = 0;

    // 1. message_start
    const startData: Record<string, unknown> = {
      type: 'message_start',
      message: {
        id: this.messageId(),
        type: 'message',
        role: 'assistant',
        content: [],
        model: response.model,
        stop_reason: this._mapStopReason(response.finishReason, options?.tools),
        stop_sequence: null,
        usage: {
          input_tokens: options?.inputTokens ?? 0,
          output_tokens: 0,
        },
      },
    };

    // Add thinking block to initial message if present
    if (options?.thinking) {
      (startData.message as Record<string, unknown>).content = [
        { type: 'thinking', thinking: options.thinking },
      ];
    }

    output += `event: message_start\ndata: ${JSON.stringify(startData)}\n\n`;

    // 2. Thinking block (if present)
    if (options?.thinking) {
      output += this.renderEvent(this.thinkingBlockStart(blockIndex++, options.thinking));
      // No thinking_delta in this simplified version — just the start block
    }

    // 3. Text content block
    if (response.content) {
      output += this.renderEvent(this.contentBlockStart(blockIndex, response.content));

      // Split content into deltas (by word or sentence for realism)
      const words = response.content.split(/(?<=\s)/);
      let buffer = '';
      for (const word of words) {
        buffer += word;
        if (buffer.length >= 5 || word === words[words.length - 1]) {
          output += this.renderEvent(this.contentBlockDelta(blockIndex, buffer));
          buffer = '';
        }
      }
      if (buffer) {
        output += this.renderEvent(this.contentBlockDelta(blockIndex, buffer));
      }

      output += this.renderEvent(this.contentBlockStop(blockIndex));
    }

    // 4. Tool use blocks (if any)
    if (options?.tools) {
      for (const tool of options.tools) {
        blockIndex++;
        output += this.renderEvent(this.toolUseBlockStart(
          blockIndex,
          tool.id,
          tool.name,
        ));
        // Stream the input JSON
        const inputStr = tool.arguments;
        const chunkSize = Math.ceil(inputStr.length / 3);
        for (let i = 0; i < 3; i++) {
          const chunk = inputStr.slice(i * chunkSize, (i + 1) * chunkSize);
          if (chunk) {
            output += this.renderEvent(this.inputJsonDelta(blockIndex, chunk));
          }
        }
        output += this.renderEvent(this.contentBlockStop(blockIndex));
      }
    }

    // 5. message_delta
    output += this.renderEvent(this.messageDelta({
      stopReason: response.finishReason,
      outputTokens: response.usage?.outputTokens,
    }));

    // 6. message_stop
    output += this.renderEvent(this.messageStop());

    return output;
  }

  // ═══════════════════════════════════════════════════════════════
  //  Error Response
  // ═══════════════════════════════════════════════════════════════

  /**
   * Format an error response in Anthropic format.
   */
  formatError(statusCode: number, type: string, message: string): {
    statusCode: number;
    body: Record<string, unknown>;
  } {
    const errorBody = {
      type: 'error',
      error: {
        type: this._mapErrorType(type),
        message,
      },
    };

    // Anthropic error status codes
    const statusMap: Record<string, number> = {
      authentication_error: 401,
      permission_error: 403,
      not_found: 404,
      rate_limit_error: 429,
      api_error: 500,
      overloaded_error: 529,
    };

    return {
      statusCode: statusMap[type] ?? statusCode,
      body: errorBody,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  Request Parsing
  // ═══════════════════════════════════════════════════════════════

  /**
   * Extract Anthropic-specific metadata from request headers.
   */
  parseRequestHeaders(headers: Record<string, string | string[] | undefined>): {
    anthropicVersion: string;
    requestId?: string;
    beta?: string[];
  } {
    const version = (headers['anthropic-version'] as string) || '2023-06-01';
    const requestId = headers['x-request-id'] as string || undefined;
    const beta = (headers['anthropic-beta'] as string)?.split(',').map(s => s.trim()) || [];

    return { anthropicVersion: version, requestId, beta };
  }

  /**
   * Validate an Anthropic request body.
   */
  validateRequest(body: Record<string, unknown>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];

    if (!body.model) errors.push('model is required');
    if (!body.messages) errors.push('messages is required');
    if (!body.max_tokens && body.max_tokens !== 0) errors.push('max_tokens is required');

    if (body.messages && Array.isArray(body.messages)) {
      for (let i = 0; i < body.messages.length; i++) {
        const msg = body.messages[i] as Record<string, unknown>;
        if (!msg.role) errors.push(`messages[${i}].role is required`);
        if (!msg.content) errors.push(`messages[${i}].content is required`);
      }
    }

    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  }

  // ═══════════════════════════════════════════════════════════════
  //  Content Block Builders
  // ═══════════════════════════════════════════════════════════════

  /** Create a text content block */
  textBlock(text: string): AnthropicTextBlock {
    return { type: 'text', text };
  }

  /** Create an image content block (base64) */
  imageBlock(base64: string, mediaType: string): AnthropicImageBlock {
    return {
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: base64 },
    };
  }

  /** Create an image content block (URL) */
  imageUrlBlock(url: string, mediaType: string): AnthropicImageBlock {
    return {
      type: 'image',
      source: { type: 'url', media_type: mediaType, url },
    };
  }

  /** Create a tool_use content block */
  toolUseBlock(name: string, input: Record<string, unknown>, id?: string): AnthropicToolUseBlock {
    return {
      type: 'tool_use',
      id: id || `toolu_${crypto.randomBytes(8).toString('hex')}`,
      name,
      input,
    };
  }

  /** Create a tool_result content block */
  toolResultBlock(toolUseId: string, content: string, isError?: boolean): AnthropicToolResultBlock {
    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content,
      is_error: isError,
    };
  }

  /** Create a thinking content block */
  thinkingBlock(thinking: string): AnthropicThinkingBlock {
    return {
      type: 'thinking',
      thinking,
      signature: `sig_${crypto.randomBytes(8).toString('hex')}`,
    };
  }

  /** Create a document content block */
  documentBlock(data: string, mediaType: string, type: 'base64' | 'url' | 'text' = 'base64'): AnthropicDocumentBlock {
    return {
      type: 'document',
      source: { type, media_type: mediaType, data },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  Internal Helpers
  // ═══════════════════════════════════════════════════════════════

  private _mapStopReason(
    reason?: string | null,
    tools?: Array<{ name: string }>,
  ): AnthropicResponse['stop_reason'] {
    if (tools && tools.length > 0) return 'tool_use';
    if (reason === 'stop' || reason === 'end_turn') return 'end_turn';
    if (reason === 'length') return 'max_tokens';
    if (reason === 'content_filter') return 'end_turn';
    if (reason === 'tool_calls') return 'tool_use';
    return null;
  }

  private _mapErrorType(type: string): string {
    const map: Record<string, string> = {
      authentication_error: 'authentication_error',
      invalid_request_error: 'invalid_request_error',
      rate_limit_error: 'rate_limit_error',
      api_error: 'api_error',
      overloaded_error: 'overloaded_error',
      permission_error: 'permission_error',
      not_found: 'not_found',
    };
    return map[type] || 'api_error';
  }
}

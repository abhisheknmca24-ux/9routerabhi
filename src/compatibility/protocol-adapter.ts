import { type IncomingMessage, type ServerResponse } from 'node:http';
import {
  type SharedRequest,
  type SharedResponse,
  type SharedResponseChunk,
  type SharedMessage,
  type ContentBlock,
  type StreamCallbacks,
  type ProtocolType,
} from '../types/api.types.js';

/**
 * ProtocolAdapter — converts between client-specific protocols and the
 * universal SharedRequest / SharedResponse format.
 *
 * Each client speaks a different wire format. This adapter normalises
 * incoming requests and formats outgoing responses so the routing engine
 * only ever sees SharedRequest and SharedResponse.
 */

export class ProtocolAdapter {
  /**
   * Parse an incoming HTTP request into a SharedRequest.
   * Handles both OpenAI /v1/chat/completions and Anthropic /v1/messages formats.
   */
  parseRequest(
    req: IncomingMessage,
    body: Record<string, unknown>,
    client: { protocol: ProtocolType; type: string; userAgent: string; ip: string; clientVersion?: string },
  ): SharedRequest | null {
    if (client.protocol === 'anthropic-messages') {
      return this._fromAnthropic(req, body, client);
    }
    if (client.protocol === 'openai-chat') {
      return this._fromOpenAI(req, body, client);
    }
    return null;
  }

  /**
   * Format a SharedResponse into the correct wire format for the client protocol.
   */
  formatResponse(response: SharedResponse, protocol: ProtocolType): Record<string, unknown> {
    if (protocol === 'anthropic-messages') {
      return this._toAnthropic(response);
    }
    return this._toOpenAI(response);
  }

  /**
   * Format a streaming chunk into the correct SSE format for the client.
   */
  formatStreamChunk(chunk: SharedResponseChunk, protocol: ProtocolType): string {
    if (protocol === 'anthropic-messages') {
      return this._anthropicStreamChunk(chunk);
    }
    return this._openaiStreamChunk(chunk);
  }

  /**
   * Get the SSE stream end marker for the given protocol.
   */
  formatStreamEnd(protocol: ProtocolType): string {
    if (protocol === 'anthropic-messages') {
      return 'event: done\ndata: {}\n\n';
    }
    return 'data: [DONE]\n\n';
  }

  /** Get the Content-Type header for responses */
  getContentType(protocol: ProtocolType, stream: boolean): string {
    if (protocol === 'anthropic-messages') {
      return stream ? 'text/event-stream' : 'application/json';
    }
    return stream ? 'text/event-stream' : 'application/json';
  }

  // ─── OpenAI → Shared ───

  private _fromOpenAI(
    req: IncomingMessage,
    body: Record<string, unknown>,
    client: { protocol: ProtocolType; type: string; userAgent: string; ip: string },
  ): SharedRequest {
    const messages = (body.messages as Array<Record<string, unknown>> || []).map(m => this._openaiMessage(m));
    const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
    const filteredMessages = messages.filter(m => m.role !== 'system');

    return {
      model: (body.model as string) || '',
      messages: filteredMessages,
      system: system || undefined,
      maxTokens: (body.max_tokens as number) || undefined,
      temperature: (body.temperature as number) || undefined,
      topP: (body.top_p as number) || undefined,
      stop: (body.stop as string[]) || undefined,
      stream: (body.stream as boolean) || false,
      extraParams: body as Record<string, unknown>,
      client: { type: client.type as any, protocol: client.protocol as any, userAgent: client.userAgent, ip: client.ip },
    };
  }

  private _openaiMessage(msg: Record<string, unknown>): SharedMessage {
    const role = (msg.role as string) || 'user';
    const content = msg.content;
    const result: SharedMessage = {
      role: role as SharedMessage['role'],
      content: typeof content === 'string' ? content : JSON.stringify(content),
    };
    if (msg.name) result.name = msg.name as string;
    if (msg.tool_calls) {
      result.toolCalls = msg.tool_calls as SharedMessage['toolCalls'];
    }
    if (msg.tool_call_id) result.toolCallId = msg.tool_call_id as string;
    return result;
  }

  // ─── Anthropic → Shared ───

  private _fromAnthropic(
    req: IncomingMessage,
    body: Record<string, unknown>,
    client: { protocol: ProtocolType; type: string; userAgent: string; ip: string; clientVersion?: string },
  ): SharedRequest {
    const messages = (body.messages as Array<Record<string, unknown>> || []).map(m => this._anthropicMessage(m));
    const system = body.system;

    return {
      model: (body.model as string) || '',
      messages,
      system: typeof system === 'string' ? system : Array.isArray(system)
        ? (system as Array<{ text: string }>).map(b => b.text).join('\n')
        : undefined,
      maxTokens: (body.max_tokens as number) || undefined,
      temperature: (body.temperature as number) || undefined,
      topP: (body.top_p as number) || undefined,
      stop: (body.stop_sequences as string[]) || undefined,
      stream: (body.stream as boolean) ?? true, // Anthropic defaults to streaming
      extraParams: body as Record<string, unknown>,
      client: { type: client.type as any, protocol: client.protocol as any, userAgent: client.userAgent, ip: client.ip },
    };
  }

  private _anthropicMessage(msg: Record<string, unknown>): SharedMessage {
    const role = (msg.role as string) || 'user';
    const content = msg.content;
    const result: SharedMessage = {
      role: role as SharedMessage['role'],
      content: typeof content === 'string' ? content : JSON.stringify(content),
    };
    return result;
  }

  // ─── Shared → OpenAI ───

  private _toOpenAI(response: SharedResponse): Record<string, unknown> {
    return {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: response.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: response.content,
        },
        finish_reason: response.finishReason || 'stop',
      }],
      usage: response.usage ? {
        prompt_tokens: response.usage.inputTokens || 0,
        completion_tokens: response.usage.outputTokens || 0,
        total_tokens: response.usage.totalTokens || 0,
      } : undefined,
    };
  }

  // ─── Shared → Anthropic ───

  private _toAnthropic(response: SharedResponse): Record<string, unknown> {
    return {
      id: `msg_${Date.now().toString(36)}`,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: response.content }],
      model: response.model,
      stop_reason: response.finishReason === 'length' ? 'max_tokens' : (response.finishReason || 'end_turn'),
      stop_sequence: null,
      usage: response.usage ? {
        input_tokens: response.usage.inputTokens || 0,
        output_tokens: response.usage.outputTokens || 0,
      } : undefined,
    };
  }

  // ─── Streaming Chunks ───

  private _openaiStreamChunk(chunk: SharedResponseChunk): string {
    if (chunk.type === 'done') {
      return 'data: [DONE]\n\n';
    }
    if (chunk.type === 'error') {
      return `data: ${JSON.stringify({ error: { message: chunk.content } })}\n\n`;
    }

    const data = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: '',
      choices: [{
        index: 0,
        delta: {
          ...(chunk.delta ? { content: chunk.delta } : {}),
          ...(chunk.type === 'tool_call' ? { tool_calls: chunk.toolCalls } : {}),
        },
        ...(chunk.finishReason ? { finish_reason: chunk.finishReason } : {}),
      }],
    };

    return `data: ${JSON.stringify(data)}\n\n`;
  }

  private _anthropicStreamChunk(chunk: SharedResponseChunk): string {
    if (chunk.type === 'done') {
      return 'event: done\ndata: {}\n\n';
    }
    if (chunk.type === 'error') {
      return `event: error\ndata: ${JSON.stringify({ error: { message: chunk.content } })}\n\n`;
    }
    if (chunk.type === 'text_delta' && chunk.delta) {
      const data = {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: chunk.delta },
      };
      return `event: content_block_delta\ndata: ${JSON.stringify(data)}\n\n`;
    }
    if (chunk.type === 'text') {
      const startData = {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: chunk.content },
      };
      return `event: content_block_start\ndata: ${JSON.stringify(startData)}\n\n`;
    }

    return '';
  }
}

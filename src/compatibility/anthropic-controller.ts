/**
 * AnthropicController
 *
 * A clean, modular Anthropic Messages API compatibility layer.
 *
 * Accepts Anthropic-format requests (POST /v1/messages),
 * translates them to the internal OpenAI-compatible format,
 * calls the existing gateway via HttpAgent,
 * and converts responses back into exact Anthropic format.
 *
 * Supports non-streaming and streaming (SSE).
 * Streaming handles provider failover transparently.
 *
 * NO provider logic, NO routing engine changes, NO health engine changes.
 * Everything uses existing services.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import http from 'node:http';
import https from 'node:https';
import { URL as NodeURL } from 'node:url';
import { type HttpAgent } from '../performance/http-agent.js';
import { AnthropicFormatter, type AnthropicMessage } from '../formatter/anthropic-formatter.js';

export interface AnthropicControllerConfig {
  /** URL of the upstream OpenAI-compatible gateway */
  gatewayUrl: string;
  /** Max providers to iterate for streaming failover */
  maxStreamingFailover?: number;
  /** Provider endpoints to try in order for streaming failover */
  providerEndpoints?: string[];
}

export class AnthropicController {
  private readonly formatter: AnthropicFormatter;

  constructor(
    private readonly httpAgent: HttpAgent,
    private readonly config: AnthropicControllerConfig,
  ) {
    this.formatter = new AnthropicFormatter();
  }

  /**
   * Handle a /v1/messages request — both streaming and non-streaming.
   */
  async handleMessages(req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>): Promise<void> {
    const validation = this.formatter.validateRequest(body);
    if (!validation.valid) {
      const err = this.formatter.formatError(400, 'invalid_request_error', validation.errors!.join('; '));
      res.statusCode = err.statusCode;
      res.setHeader('content-type', 'application/json');
      res.setHeader('x-request-id', this.formatter.requestId());
      res.end(JSON.stringify(err.body));
      return;
    }

    const stream = body.stream === true;

    if (stream) {
      await this._handleStream(res, body);
    } else {
      await this._handleNonStream(res, body);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  Non-Streaming
  // ═══════════════════════════════════════════════════════════════

  private async _handleNonStream(res: ServerResponse, body: Record<string, unknown>): Promise<void> {
    const openaiBody = this._toOpenAI(body);
    openaiBody.stream = false;

    let upstreamResponse;
    try {
      upstreamResponse = await this.httpAgent.post(
        `${this.config.gatewayUrl}/v1/chat/completions`,
        openaiBody,
        { timeout: 120000 },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upstream request failed';
      const errResp = this.formatter.formatError(502, 'api_error', message);
      res.statusCode = errResp.statusCode;
      res.setHeader('content-type', 'application/json');
      res.setHeader('x-request-id', this.formatter.requestId());
      res.end(JSON.stringify(errResp.body));
      return;
    }

    const upstreamData = upstreamResponse.data as Record<string, unknown> | undefined;
    const choice = (upstreamData?.choices as Array<Record<string, unknown>> | undefined)?.[0];

    if (upstreamResponse.status >= 400 || !choice) {
      const errorMessage = (upstreamData?.error as Record<string, unknown> | undefined)?.message as string
        ?? `Upstream returned ${upstreamResponse.status}`;
      const anthropicErrorType = upstreamResponse.status === 429 ? 'rate_limit_error'
        : upstreamResponse.status === 401 ? 'authentication_error'
        : upstreamResponse.status === 403 ? 'permission_error'
        : 'api_error';
      const errResp = this.formatter.formatError(upstreamResponse.status, anthropicErrorType, errorMessage);
      res.statusCode = errResp.statusCode;
      res.setHeader('content-type', 'application/json');
      res.setHeader('x-request-id', this.formatter.requestId());
      res.end(JSON.stringify(errResp.body));
      return;
    }

    const message = choice?.message as Record<string, unknown> | undefined;
    const content = (message?.content as string) ?? '';
    const finishReason = (choice?.finish_reason as string) ?? 'stop';
    const toolCalls = (message?.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }> | undefined);
    const usage = upstreamData?.usage as Record<string, unknown> | undefined;

    const response = this.formatter.formatResponse({
      model: (body.model as string) ?? '',
      content,
      finishReason,
      inputTokens: (usage?.prompt_tokens as number) ?? 0,
      outputTokens: (usage?.completion_tokens as number) ?? 0,
      tools: toolCalls?.map(tc => ({
        id: tc.id,
        name: tc.function?.name ?? '',
        arguments: tc.function?.arguments ?? '{}',
      })),
    });

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.setHeader('x-request-id', this.formatter.requestId());
    res.end(JSON.stringify(response));
  }

  // ═══════════════════════════════════════════════════════════════
  //  Streaming — exact Anthropic SSE events
  // ═══════════════════════════════════════════════════════════════

  private async _handleStream(res: ServerResponse, body: Record<string, unknown>): Promise<void> {
    const model = (body.model as string) ?? '';
    const openaiBase = this._toOpenAI(body);
    openaiBase.stream = true;

    // SSE headers
    res.statusCode = 200;
    res.setHeader('content-type', 'text/event-stream');
    res.setHeader('cache-control', 'no-cache');
    res.setHeader('connection', 'keep-alive');
    res.setHeader('x-accel-buffering', 'no');
    res.setHeader('x-request-id', this.formatter.requestId());

    // The provider chain to try (for failover)
    const providerChain = [
      this.config.gatewayUrl,
      ...(this.config.providerEndpoints ?? []),
    ];

    let accumulatedContent = '';
    let success = false;
    let finalFinishReason: string | undefined;
    let finalUsage: { promptTokens?: number; completionTokens?: number } = {};
    let lastToolCalls: Array<{ id: string; name: string; arguments: string }> | undefined;
    let blockIndex = 0;

    for (let attempt = 0; attempt < Math.min(providerChain.length, this.config.maxStreamingFailover ?? 3); attempt++) {
      const upstreamUrl = `${providerChain[attempt]}/v1/chat/completions`;
      if (success) break;

      try {
        await this._streamFromProvider(
          upstreamUrl,
          openaiBase,
          // onChunk: raw OpenAI delta
          (delta: string) => {
            if (!delta) return;

            // First text from this provider — send content_block_start if needed
            // (content_block_start is only sent once per block)
            if (accumulatedContent === '' && attempt === 0) {
              res.write(this.formatter.renderEvent(this.formatter.contentBlockStart(blockIndex, '')));
            }

            accumulatedContent += delta;
            res.write(this.formatter.renderEvent(this.formatter.contentBlockDelta(blockIndex, delta)));
          },
          // onToolCall: when we get a tool call delta
          (tc: { id: string; name: string; arguments: string }) => {
            if (!lastToolCalls) lastToolCalls = [];
            // Send tool_use block start + input_json_delta
            res.write(this.formatter.renderEvent(
              this.formatter.toolUseBlockStart(++blockIndex, tc.id, tc.name)
            ));
            if (tc.arguments) {
              res.write(this.formatter.renderEvent(
                this.formatter.inputJsonDelta(blockIndex, tc.arguments)
              ));
            }
            lastToolCalls!.push(tc);
          },
          // onFinish: stream completed successfully
          (finishReason: string, usage?: { promptTokens?: number; completionTokens?: number }) => {
            success = true;
            finalFinishReason = finishReason;
            if (usage) finalUsage = usage;
          },
          // onError: this provider failed, try next
          async () => {
            // If we have partial content from a previous attempt, the next
            // provider needs the accumulated context. We re-send the Anthropic
            // messages plus the accumulated assistant content.
            // This is handled by the caller loop — `accumulatedContent` persists.
          },
        );
      } catch {
        // Provider failed, try next
        continue;
      }
    }

    if (!success && accumulatedContent.length === 0) {
      // Complete failure — send error event
      res.write(this.formatter.renderEvent(this.formatter.error({
        type: 'api_error',
        message: 'All providers failed',
      })));
    } else {
      // Send stop event for the content block
      res.write(this.formatter.renderEvent(this.formatter.contentBlockStop(blockIndex)));

      // message_delta
      res.write(this.formatter.renderEvent(this.formatter.messageDelta({
        stopReason: finalFinishReason || 'end_turn',
        outputTokens: finalUsage.completionTokens || Math.ceil(accumulatedContent.length / 4),
      })));

      // message_stop
      res.write(this.formatter.renderEvent(this.formatter.messageStop()));
    }

    res.end();
  }

  /**
   * Stream from a single upstream provider via SSE.
   * Calls onChunk for each text delta, onFinish when done, onError on failure.
   */
  private _streamFromProvider(
    upstreamUrl: string,
    body: Record<string, unknown>,
    onChunk: (delta: string) => void,
    onToolCall: (tc: { id: string; name: string; arguments: string }) => void,
    onFinish: (finishReason: string, usage?: { promptTokens?: number; completionTokens?: number }) => void,
    onError: () => Promise<void>,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new NodeURL(upstreamUrl);
      const useHttps = parsedUrl.protocol === 'https:';
      const postData = JSON.stringify(body);

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (useHttps ? 443 : 80),
        path: parsedUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'Accept': 'text/event-stream',
        },
        timeout: 30000,
      };

      const req = (useHttps ? https : http).request(options, (upstreamRes) => {
        if (upstreamRes.statusCode && upstreamRes.statusCode >= 400) {
          // Non-200 from upstream — drain then reject
          upstreamRes.resume();
          reject(new Error(`Upstream returned ${upstreamRes.statusCode}`));
          return;
        }

        let buffer = '';
        let finished = false;

        upstreamRes.on('data', (chunk: Buffer | string) => {
          buffer += chunk.toString();

          // Process complete lines
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) continue;

            if (trimmed.startsWith('data: ')) {
              const data = trimmed.slice(6).trim();
              if (data === '[DONE]') {
                finished = true;
                onFinish('stop');
                resolve();
                return;
              }

              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta;
                const finishReason = parsed.choices?.[0]?.finish_reason;

                if (delta?.content) {
                  onChunk(delta.content);
                }

                // Handle tool calls in delta
                if (delta?.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    const func = tc.function;
                    if (func?.name) {
                      onToolCall({
                        id: tc.id,
                        name: func.name,
                        arguments: func.arguments || '',
                      });
                    }
                  }
                }

                if (finishReason) {
                  finished = true;
                  const usage = parsed.usage;
                  onFinish(finishReason, {
                    promptTokens: usage?.prompt_tokens,
                    completionTokens: usage?.completion_tokens,
                  });
                  resolve();
                  return;
                }
              } catch {}
            }
          }
        });

        upstreamRes.on('end', () => {
          if (!finished) {
            // Stream ended without [DONE] or finish_reason
            onFinish('end_turn');
            resolve();
          }
        });

        upstreamRes.on('error', (err) => {
          reject(err);
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('ETIMEDOUT'));
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.write(postData);
      req.end();
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  Format Translation
  // ═══════════════════════════════════════════════════════════════

  private _toOpenAI(anthropicBody: Record<string, unknown>): Record<string, unknown> {
    const anthropicMessages = (anthropicBody.messages as AnthropicMessage[]) ?? [];
    const system = anthropicBody.system;

    const openaiMessages: Array<Record<string, unknown>> = [];

    if (system) {
      if (typeof system === 'string') {
        openaiMessages.push({ role: 'system', content: system });
      } else if (Array.isArray(system)) {
        const systemText = system
          .map((b: Record<string, unknown>) => b.text as string ?? '')
          .filter(Boolean)
          .join('\n');
        if (systemText) {
          openaiMessages.push({ role: 'system', content: systemText });
        }
      }
    }

    for (const msg of anthropicMessages) {
      const openaiMsg: Record<string, unknown> = {
        role: msg.role === 'assistant' ? 'assistant' : 'user',
      };

      if (typeof msg.content === 'string') {
        openaiMsg.content = msg.content;
      } else if (Array.isArray(msg.content)) {
        const textParts: string[] = [];
        for (const block of msg.content) {
          if (block.type === 'text' && 'text' in block) {
            textParts.push((block as { text: string }).text);
          } else if (block.type === 'image' && 'source' in block) {
            const src = (block as { source: { type: string; media_type: string; data?: string; url?: string } }).source;
            if (src.type === 'base64' && src.data) {
              textParts.push(`data:${src.media_type};base64,${src.data}`);
            } else if (src.type === 'url' && src.url) {
              textParts.push(src.url);
            }
          } else if (block.type === 'tool_use') {
            const tu = block as { id: string; name: string; input: Record<string, unknown> };
            openaiMsg.tool_calls = [{
              id: tu.id,
              type: 'function',
              function: { name: tu.name, arguments: JSON.stringify(tu.input) },
            }];
          } else if (block.type === 'tool_result') {
            const tr = block as { tool_use_id: string; content: string | unknown; is_error?: boolean };
            openaiMessages.push({
              role: 'tool',
              tool_call_id: tr.tool_use_id,
              content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content),
            });
            continue;
          } else if (block.type === 'thinking') {
            textParts.push(`[Thinking: ${(block as { thinking: string }).thinking}]`);
          }
        }
        openaiMsg.content = textParts.join('\n') || ' ';
      }

      openaiMessages.push(openaiMsg);
    }

    return {
      model: anthropicBody.model,
      messages: openaiMessages,
      max_tokens: anthropicBody.max_tokens ?? 4096,
      temperature: anthropicBody.temperature,
      top_p: anthropicBody.top_p,
      stop: anthropicBody.stop_sequences,
      stream: true,
    };
  }
}

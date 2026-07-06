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
 * NO provider logic, NO routing engine changes, NO health engine changes.
 * Everything uses existing services.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { type HttpAgent } from '../performance/http-agent.js';
import { AnthropicFormatter, type AnthropicResponse, type AnthropicMessage } from '../formatter/anthropic-formatter.js';

export interface AnthropicControllerConfig {
  /** URL of the upstream OpenAI-compatible gateway */
  gatewayUrl: string;
}

/**
 * Handles POST /v1/messages for non-streaming requests.
 * Translates Anthropic → Internal → Anthropic.
 */
export class AnthropicController {
  private readonly formatter: AnthropicFormatter;

  constructor(
    private readonly httpAgent: HttpAgent,
    private readonly config: AnthropicControllerConfig,
  ) {
    this.formatter = new AnthropicFormatter();
  }

  /**
   * Handle a non-streaming /v1/messages request.
   * No provider logic, no routing — just format translation.
   */
  async handleMessages(req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>): Promise<void> {
    // ── 1. Validate ──
    const validation = this.formatter.validateRequest(body);
    if (!validation.valid) {
      const err = this.formatter.formatError(400, 'invalid_request_error', validation.errors!.join('; '));
      res.statusCode = err.statusCode;
      res.setHeader('content-type', 'application/json');
      res.setHeader('x-request-id', this.formatter.requestId());
      res.end(JSON.stringify(err.body));
      return;
    }

    // ── 2. Translate Anthropic request → OpenAI-compatible body ──
    const openaiBody = this._toOpenAI(body);

    // ── 3. Call existing gateway (no routing, no provider logic) ──
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

    // ── 4. Extract response data from upstream ──
    const upstreamData = upstreamResponse.data as Record<string, unknown> | undefined;
    const choice = (upstreamData?.choices as Array<Record<string, unknown>> | undefined)?.[0];

    // ── 5. Handle upstream errors ──
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

    // ── 6. Build Anthropic response ──
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

    // ── 7. Return ──
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.setHeader('x-request-id', this.formatter.requestId());
    res.end(JSON.stringify(response));
  }

  // ─── Private: Anthropic → OpenAI translation ───

  /**
   * Convert an Anthropic /v1/messages request body into
   * an OpenAI /v1/chat/completions body.
   *
   * This is the ONLY place where format translation happens.
   * No routing, no provider selection, no health checks.
   */
  private _toOpenAI(anthropicBody: Record<string, unknown>): Record<string, unknown> {
    const anthropicMessages = (anthropicBody.messages as AnthropicMessage[]) ?? [];
    const system = anthropicBody.system;

    // Build OpenAI messages array
    const openaiMessages: Array<Record<string, unknown>> = [];

    // Add system prompt as a system message if present
    if (system) {
      if (typeof system === 'string') {
        openaiMessages.push({ role: 'system', content: system });
      } else if (Array.isArray(system)) {
        // Anthropic allows system as an array of text blocks
        const systemText = system
          .map((b: Record<string, unknown>) => b.text as string ?? '')
          .filter(Boolean)
          .join('\n');
        if (systemText) {
          openaiMessages.push({ role: 'system', content: systemText });
        }
      }
    }

    // Translate each Anthropic message
    for (const msg of anthropicMessages) {
      const openaiMsg: Record<string, unknown> = {
        role: msg.role === 'assistant' ? 'assistant' : 'user',
      };

      // Content can be a string or an array of content blocks
      if (typeof msg.content === 'string') {
        openaiMsg.content = msg.content;
      } else if (Array.isArray(msg.content)) {
        // Anthropic content blocks → OpenAI format
        const textParts: string[] = [];
        for (const block of msg.content) {
          if (block.type === 'text' && 'text' in block) {
            textParts.push((block as { text: string }).text);
          } else if (block.type === 'image' && 'source' in block) {
            // Images: convert to OpenAI image_url format
            const src = (block as { source: { type: string; media_type: string; data?: string; url?: string } }).source;
            if (src.type === 'base64' && src.data) {
              textParts.push(`data:${src.media_type};base64,${src.data}`);
            } else if (src.type === 'url' && src.url) {
              textParts.push(src.url);
            }
          } else if (block.type === 'tool_use') {
            // Tool use blocks become tool_calls
            const tu = block as { id: string; name: string; input: Record<string, unknown> };
            openaiMsg.tool_calls = [{
              id: tu.id,
              type: 'function',
              function: { name: tu.name, arguments: JSON.stringify(tu.input) },
            }];
          } else if (block.type === 'tool_result') {
            // Tool result becomes a tool role message
            const tr = block as { tool_use_id: string; content: string | unknown; is_error?: boolean };
            openaiMessages.push({
              role: 'tool',
              tool_call_id: tr.tool_use_id,
              content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content),
            });
            continue; // Skip the normal push below
          } else if (block.type === 'thinking') {
            // Thinking blocks are informational — include as a comment
            textParts.push(`[Thinking: ${(block as { thinking: string }).thinking}]`);
          }
        }
        openaiMsg.content = textParts.join('\n') || ' ';
      }

      openaiMessages.push(openaiMsg);
    }

    // Build the full OpenAI request body
    return {
      model: anthropicBody.model,
      messages: openaiMessages,
      max_tokens: anthropicBody.max_tokens ?? 4096,
      temperature: anthropicBody.temperature,
      top_p: anthropicBody.top_p,
      stop: anthropicBody.stop_sequences,
      stream: false,
    };
  }
}

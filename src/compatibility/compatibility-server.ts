/**
 * Universal Compatibility Gateway — runs on port 20134
 *
 * This is the single entry point for ALL clients. It:
 * 1. Detects client type (Claude Desktop, Cursor, OpenAI, etc.)
 * 2. Auto-selects the correct protocol adapter
 * 3. Routes through the shared engine
 * 4. Formats responses back in the client's native protocol
 *
 * The existing gateway on port 20128 remains untouched for backward compatibility.
 */

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { ConsoleLogger } from '../logger/console-logger.js';
import { createEngineServer } from '../engines/engine-server.js';
import { SecurityIntegration } from '../security/security-integration.js';
import { Router } from 'express';

import { CompatibilityLayer } from './compatibility-layer.js';
import { buildClientInfo } from './client-detector.js';
import { AnthropicFormatter } from '../formatter/anthropic-formatter.js';

const PORT = parseInt(process.env.COMPAT_ENGINE_PORT || '20134', 10);

const logger = new ConsoleLogger(
  process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error' | undefined,
  { service: 'compatibility-engine' },
);

const security = new SecurityIntegration({
  requireAuth: process.env.REQUIRE_API_KEY === 'true',
  logger,
});

// ─── Stub engine that calls the real gateway ───
// The real routing engine sits behind the scenes. This adapter calls it.
import { HttpAgent } from '../performance/http-agent.js';

const gatewayUrl = process.env.GATEWAY_URL || 'http://127.0.0.1:20128';
const httpAgent = new HttpAgent({ logger });
const anthropicFormatter = new AnthropicFormatter();

// ─── Anthropic /v1/messages handler — uses AnthropicFormatter for exact compat ───
async function handleAnthropicMessages(req: any, res: any): Promise<void> {
  const body = req.body || {};

  // Validate
  const validation = anthropicFormatter.validateRequest(body);
  if (!validation.valid) {
    const err = anthropicFormatter.formatError(400, 'invalid_request_error', validation.errors!.join('; '));
    res.statusCode = err.statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('x-request-id', anthropicFormatter.requestId());
    return res.end(JSON.stringify(err.body));
  }

  const model = body.model as string;
  const stream = body.stream !== false; // Anthropic defaults to streaming
  const maxTokens = body.max_tokens as number || 4096;

  // Detect client info for stats
  const clientInfo = buildClientInfo(req);

  // Build Anthropic-specific request metadata
  const { anthropicVersion, requestId, beta } = anthropicFormatter.parseRequestHeaders(req.headers);
  res.setHeader('anthropic-version', anthropicVersion);
  res.setHeader('x-request-id', requestId || anthropicFormatter.requestId());

  if (stream) {
    // ── Streaming Response ──
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Start with ping
    res.write(anthropicFormatter.renderEvent(anthropicFormatter.ping()));

    // Send message_start
    res.write(anthropicFormatter.renderEvent(anthropicFormatter.messageStart({
      model,
      inputTokens: 0,
    })));

    try {
      // Call the upstream OpenAI-compatible gateway
      const upstreamResponse = await httpAgent.post(`${gatewayUrl}/v1/chat/completions`, {
        model,
        messages: body.messages,
        max_tokens: maxTokens,
        temperature: body.temperature as number | undefined,
        stream: true,
      });

      // Parse SSE and convert to Anthropic format
      if (upstreamResponse.raw) {
        const lines = upstreamResponse.raw.split('\n');
        let fullContent = '';
        let blockIndex = 0;
        let toolUseId = '';

        // Check if tools are requested
        const hasTools = Array.isArray(body.tools) && body.tools.length > 0;

        // Send content_block_start
        res.write(anthropicFormatter.renderEvent(
          anthropicFormatter.contentBlockStart(blockIndex, '')
        ));

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') break;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;

            if (delta?.content) {
              fullContent += delta.content;
              res.write(anthropicFormatter.renderEvent(
                anthropicFormatter.contentBlockDelta(blockIndex, delta.content)
              ));
            }

            // Handle tool calls in delta
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.function?.name) {
                  toolUseId = tc.id || `toolu_${Date.now().toString(36)}`;
                  // Send tool_use block start
                  res.write(anthropicFormatter.renderEvent(
                    anthropicFormatter.toolUseBlockStart(++blockIndex, toolUseId, tc.function.name)
                  ));
                }
                if (tc.function?.arguments) {
                  res.write(anthropicFormatter.renderEvent(
                    anthropicFormatter.inputJsonDelta(blockIndex, tc.function.arguments)
                  ));
                }
              }
            }
          } catch {}
        }

        // Stop the text content block
        res.write(anthropicFormatter.renderEvent(anthropicFormatter.contentBlockStop(blockIndex)));

        // If we had tools, stop those blocks too
        if (blockIndex > 0) {
          res.write(anthropicFormatter.renderEvent(anthropicFormatter.contentBlockStop(blockIndex)));
        }

        // message_delta
        res.write(anthropicFormatter.renderEvent(anthropicFormatter.messageDelta({
          stopReason: 'end_turn',
          outputTokens: Math.ceil(fullContent.length / 4),
        })));

        // message_stop
        res.write(anthropicFormatter.renderEvent(anthropicFormatter.messageStop()));
        res.end();
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Upstream request failed';
      res.write(anthropicFormatter.renderEvent(anthropicFormatter.error({
        type: 'api_error',
        message: errMsg,
      })));
      res.end();
    }
  } else {
    // ── Non-Streaming Response ──
    try {
      const upstreamResponse = await httpAgent.post(`${gatewayUrl}/v1/chat/completions`, {
        model,
        messages: body.messages,
        max_tokens: maxTokens,
        temperature: body.temperature as number | undefined,
        stream: false,
      });

      const choice = (upstreamResponse.data as any)?.choices?.[0];
      const content = choice?.message?.content || '';
      const finishReason = choice?.finish_reason;

      // Check for tool calls
      const toolCalls = choice?.message?.tool_calls;
      const tools = toolCalls?.map((tc: any) => ({
        id: tc.id,
        name: tc.function?.name || '',
        arguments: tc.function?.arguments || '{}',
      }));

      const response = anthropicFormatter.formatResponse({
        model,
        content,
        finishReason,
        inputTokens: (upstreamResponse.data as any)?.usage?.prompt_tokens,
        outputTokens: (upstreamResponse.data as any)?.usage?.completion_tokens,
        tools,
      });

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(response));
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Upstream request failed';
      const errResponse = anthropicFormatter.formatError(500, 'api_error', errMsg);
      res.statusCode = errResponse.statusCode;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(errResponse.body));
    }
  }
}

const compatLayer = new CompatibilityLayer(logger, {
  route: async (request) => {
    // Forward to the real gateway's OpenAI-compatible endpoint
    const response = await httpAgent.post(`${gatewayUrl}/v1/chat/completions`, {
      model: request.model,
      messages: request.messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      top_p: request.topP,
      stream: false,
    });

    const choice = (response.data as any)?.choices?.[0]?.message;
    return {
      content: choice?.content || '',
      finishReason: (response.data as any)?.choices?.[0]?.finish_reason || 'stop',
      model: request.model,
    };
  },
  stream: async (request, callbacks) => {
    try {
      const response = await httpAgent.post(`${gatewayUrl}/v1/chat/completions`, {
        model: request.model,
        messages: request.messages.map(m => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        })),
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        stream: true,
      });

      // Parse SSE response from upstream
      if (response.raw) {
        const lines = response.raw.split('\n');
        let fullContent = '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') break;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullContent += delta;
              callbacks.onToken({ type: 'text_delta', delta });
            }
            const finishReason = parsed.choices?.[0]?.finish_reason;
            if (finishReason) {
              callbacks.onDone({ content: fullContent, finishReason, model: request.model });
              return;
            }
          } catch {}
        }

        callbacks.onDone({ content: fullContent, model: request.model });
      }
    } catch (err) {
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  },
});

// ─── Express server ───
createEngineServer({
  name: 'Compatibility Engine',
  port: PORT,
  host: '127.0.0.1',
  logger,
  security,
  configureRoutes: (app) => {
    app.use(express.json({ limit: '10mb' }));

    // Universal endpoint: all clients hit this
    app.all('/v1/chat/completions', async (req, res) => {
      await compatLayer.handleRequest(req as any, res as any, req.body || {});
    });

    // /v1/messages uses dedicated AnthropicFormatter for exact Claude Desktop compat
    app.all('/v1/messages', async (req, res) => {
      await handleAnthropicMessages(req, res);
    });

    app.get('/v1/models', async (_req, res) => {
      // Proxy to real gateway
      try {
        const response = await httpAgent.get(`${gatewayUrl}/v1/models`);
        res.json(response.data || { data: [] });
      } catch {
        res.json({ data: [] });
      }
    });

    // Client stats dashboard
    app.get('/api/compatibility/clients', (_req, res) => {
      res.json({ clients: compatLayer.getClientStats() });
    });

    app.post('/api/compatibility/reset', (_req, res) => {
      compatLayer.resetClientStats();
      res.json({ status: 'reset' });
    });

    // Client dashboard page
    app.get('/clients', (_req, res) => {
      const htmlPath = path.resolve(process.cwd(), 'src', 'compatibility', 'clients-dashboard.html');
      if (fs.existsSync(htmlPath)) return res.sendFile(htmlPath);
      const distPath = path.resolve(process.cwd(), 'dist', 'compatibility', 'clients-dashboard.html');
      if (fs.existsSync(distPath)) return res.sendFile(distPath);
      res.status(404).type('text').send('Dashboard not found');
    });

    // Detect client info (debug endpoint)
    app.post('/api/compatibility/detect', (req, res) => {
      const clientInfo = buildClientInfo(req as any);
      res.json(clientInfo);
    });
  },
});

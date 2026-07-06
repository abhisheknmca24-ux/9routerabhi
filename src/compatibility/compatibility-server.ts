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

    app.all('/v1/messages', async (req, res) => {
      await compatLayer.handleRequest(req as any, res as any, req.body || {});
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

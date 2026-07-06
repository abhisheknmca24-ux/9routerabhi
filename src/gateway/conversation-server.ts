/**
 * Conversation Engine — runs on port 20137
 *
 * Manages shared, provider-independent conversations with context
 * compression, file storage, and full continuity across provider switches.
 */

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { ConsoleLogger } from '../logger/console-logger.js';
import { createEngineServer } from '../engines/engine-server.js';
import { SecurityIntegration } from '../security/security-integration.js';
import { ConversationRepository } from '../repositories/conversation-repository.js';
import { ConversationService } from '../services/conversation.service.js';

const PORT = parseInt(process.env.CONVERSATION_ENGINE_PORT || '20137', 10);

const logger = new ConsoleLogger(
  process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error' | undefined,
  { service: 'conversation-engine' },
);

const security = new SecurityIntegration({
  requireAuth: process.env.REQUIRE_API_KEY === 'true',
  logger,
});

const repository = new ConversationRepository(logger);
const conversationService = new ConversationService(repository, logger);

// Archive conversations older than 7 days on startup
repository.archive(7);

createEngineServer({
  name: 'Conversation Engine',
  port: PORT,
  host: '127.0.0.1',
  logger,
  security,
  configureRoutes: (app) => {
    // ─── REST API ───

    /** GET /api/conversations — list conversations */
    app.get('/api/conversations', (req, res) => {
      const filter = {
        search: req.query.search as string | undefined,
        clientType: req.query.clientType as string | undefined,
        model: req.query.model as string | undefined,
        active: req.query.active !== undefined ? req.query.active === 'true' : undefined,
        page: req.query.page ? parseInt(req.query.page as string) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        sortBy: req.query.sortBy as 'createdAt' | 'updatedAt' | undefined,
        sortOrder: req.query.sortOrder as 'asc' | 'desc' | undefined,
      };
      res.json(conversationService.list(filter));
    });

    /** GET /api/conversations/stats — aggregate stats */
    app.get('/api/conversations/stats', (_req, res) => {
      const all = conversationService.list({ limit: 5000 });
      const totalConversations = all.total;
      const totalMessages = all.conversations.reduce((a, c) => a + c.messageCount, 0);
      const totalTokens = all.conversations.reduce((a, c) => a + c.tokenUsage.totalTokens, 0);
      const totalCost = all.conversations.reduce((a, c) => a + c.tokenUsage.estimatedCost, 0);
      const byClient = all.conversations.reduce((acc: Record<string, number>, c) => {
        acc[c.clientType] = (acc[c.clientType] || 0) + 1;
        return acc;
      }, {});

      res.json({
        totalConversations,
        totalMessages,
        totalTokens,
        totalCost,
        activeConversations: all.conversations.filter(c => c.active !== false).length,
        byClient,
      });
    });

    /** GET /api/conversations/:id — get conversation with messages */
    app.get('/api/conversations/:id', (req, res) => {
      const conv = conversationService.get(req.params.id);
      if (!conv) return res.status(404).json({ error: 'Conversation not found' });
      const messages = conversationService.getMessages(req.params.id);
      res.json({ ...conv, messages });
    });

    /** GET /api/conversations/:id/messages — get messages */
    app.get('/api/conversations/:id/messages', (req, res) => {
      const messages = conversationService.getMessages(req.params.id);
      res.json({ messages, total: messages.length });
    });

    /** GET /api/conversations/:id/files — get files */
    app.get('/api/conversations/:id/files', (req, res) => {
      const files = conversationService.getFiles(req.params.id);
      res.json({ files, total: files.length });
    });

    /** POST /api/conversations — create or get conversation */
    app.post('/api/conversations', (req, res) => {
      const { conversationId, clientType, model, systemPrompt, provider } = req.body;
      if (!clientType || !model) {
        return res.status(400).json({ error: 'clientType and model required' });
      }
      const result = conversationService.getOrCreate({
        conversationId, clientType, model, systemPrompt, provider,
      });
      res.status(result.isNew ? 201 : 200).json(result.conversation);
    });

    /** POST /api/conversations/:id/messages — add messages */
    app.post('/api/conversations/:id/messages', (req, res) => {
      const { requestMessages, responseContent, provider, tokens } = req.body;
      if (!requestMessages || !responseContent) {
        return res.status(400).json({ error: 'requestMessages and responseContent required' });
      }
      conversationService.addMessages(
        req.params.id,
        requestMessages,
        responseContent,
        provider || 'unknown',
        tokens,
      );
      res.json({ status: 'added' });
    });

    /** POST /api/conversations/:id/provider — update provider (for failover) */
    app.patch('/api/conversations/:id/provider', (req, res) => {
      const { provider } = req.body;
      if (!provider) return res.status(400).json({ error: 'provider required' });
      conversationService.updateProvider(req.params.id, provider);
      res.json({ status: 'updated', provider });
    });

    /** Dashboard UI */
    app.get('/conversations', (_req, res) => {
      const htmlPath = path.resolve(process.cwd(), 'src', 'gateway', 'conversation-dashboard.html');
      if (fs.existsSync(htmlPath)) return res.sendFile(htmlPath);
      const distPath = path.resolve(process.cwd(), 'dist', 'gateway', 'conversation-dashboard.html');
      if (fs.existsSync(distPath)) return res.sendFile(distPath);
      res.status(404).type('text').send('Dashboard not found');
    });
  },
});

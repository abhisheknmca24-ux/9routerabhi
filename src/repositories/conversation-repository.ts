import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { type Logger } from '../types/logger.types.js';
import {
  type Conversation,
  type ConversationMessage,
  type ConversationSummary,
  type ConversationFilter,
  type ConversationListResult,
  type TokenUsage,
  type ContentBlockData,
} from '../types/conversation.types.js';

export class ConversationRepository {
  private db: Database.Database;

  constructor(
    private readonly logger: Logger,
    dbPath?: string,
  ) {
    const resolvedPath = dbPath || path.resolve(process.cwd(), 'data', 'conversations.db');
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this._createTables();
    this.logger.info(`Conversation DB initialized: ${resolvedPath}`);
  }

  private _createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        externalId TEXT,
        clientType TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        systemPrompt TEXT DEFAULT '',
        lastProvider TEXT DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        inputTokens INTEGER NOT NULL DEFAULT 0,
        outputTokens INTEGER NOT NULL DEFAULT 0,
        totalTokens INTEGER NOT NULL DEFAULT 0,
        estimatedCost REAL NOT NULL DEFAULT 0,
        compressionEnabled INTEGER NOT NULL DEFAULT 0,
        compressionCount INTEGER NOT NULL DEFAULT 0,
        tokensSaved INTEGER NOT NULL DEFAULT 0,
        compressionStrategy TEXT NOT NULL DEFAULT 'none'
      );

      CREATE TABLE IF NOT EXISTS conversation_messages (
        id TEXT PRIMARY KEY,
        conversationId TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        timestamp TEXT NOT NULL,
        tokens INTEGER DEFAULT 0,
        provider TEXT DEFAULT '',
        compressed INTEGER NOT NULL DEFAULT 0,
        originalContent TEXT DEFAULT '',
        toolCalls TEXT DEFAULT '[]',
        toolCallId TEXT DEFAULT '',
        attachments TEXT DEFAULT '[]',
        FOREIGN KEY (conversationId) REFERENCES conversations(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS conversation_files (
        id TEXT PRIMARY KEY,
        conversationId TEXT NOT NULL,
        name TEXT NOT NULL,
        mimeType TEXT NOT NULL DEFAULT '',
        data TEXT,
        size INTEGER NOT NULL DEFAULT 0,
        type TEXT NOT NULL DEFAULT 'file',
        FOREIGN KEY (conversationId) REFERENCES conversations(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updatedAt DESC);
      CREATE INDEX IF NOT EXISTS idx_conv_client ON conversations(clientType);
      CREATE INDEX IF NOT EXISTS idx_conv_messages ON conversation_messages(conversationId, timestamp);
      CREATE INDEX IF NOT EXISTS idx_conv_active ON conversations(active);
    `);
  }

  create(conv: Conversation): void {
    this.db.prepare(`
      INSERT INTO conversations (id, externalId, clientType, model, systemPrompt, lastProvider, active,
        createdAt, updatedAt, metadata, inputTokens, outputTokens, totalTokens, estimatedCost,
        compressionEnabled, compressionCount, tokensSaved, compressionStrategy)
      VALUES (@id, @externalId, @clientType, @model, @systemPrompt, @lastProvider, @active,
        @createdAt, @updatedAt, @metadata, @inputTokens, @outputTokens, @totalTokens, @estimatedCost,
        @compressionEnabled, @compressionCount, @tokensSaved, @compressionStrategy)
    `).run({
      id: conv.id,
      externalId: conv.externalId || null,
      clientType: conv.clientType,
      model: conv.model,
      systemPrompt: conv.systemPrompt || '',
      lastProvider: conv.lastProvider || null,
      active: conv.active ? 1 : 0,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      metadata: JSON.stringify(conv.metadata),
      inputTokens: conv.tokenUsage.inputTokens,
      outputTokens: conv.tokenUsage.outputTokens,
      totalTokens: conv.tokenUsage.totalTokens,
      estimatedCost: conv.tokenUsage.estimatedCost,
      compressionEnabled: conv.compression?.enabled ? 1 : 0,
      compressionCount: conv.compression?.compressionCount || 0,
      tokensSaved: conv.compression?.tokensSaved || 0,
      compressionStrategy: conv.compression?.strategy || 'none',
    });
  }

  get(id: string): Conversation | null {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;

    const messages = this.db.prepare(
      'SELECT * FROM conversation_messages WHERE conversationId = ? ORDER BY timestamp ASC'
    ).all(id) as Array<Record<string, unknown>>;

    const conv = this._rowToConversation(row, messages);
    return conv;
  }

  update(id: string, updates: Partial<Conversation>): void {
    const sets: string[] = [];
    const bindings: Record<string, unknown> = { id };

    if (updates.model !== undefined) { sets.push('model = @model'); bindings.model = updates.model; }
    if (updates.lastProvider !== undefined) { sets.push('lastProvider = @lastProvider'); bindings.lastProvider = updates.lastProvider; }
    if (updates.active !== undefined) { sets.push('active = @active'); bindings.active = updates.active ? 1 : 0; }
    if (updates.metadata !== undefined) { sets.push('metadata = @metadata'); bindings.metadata = JSON.stringify(updates.metadata); }
    if (updates.tokenUsage !== undefined) {
      sets.push('inputTokens = @inputTokens, outputTokens = @outputTokens, totalTokens = @totalTokens, estimatedCost = @estimatedCost');
      bindings.inputTokens = updates.tokenUsage.inputTokens;
      bindings.outputTokens = updates.tokenUsage.outputTokens;
      bindings.totalTokens = updates.tokenUsage.totalTokens;
      bindings.estimatedCost = updates.tokenUsage.estimatedCost;
    }

    sets.push('updatedAt = @updatedAt');
    bindings.updatedAt = new Date().toISOString();

    this.db.prepare(`UPDATE conversations SET ${sets.join(', ')} WHERE id = @id`).run(bindings);
  }

  addMessage(conversationId: string, message: ConversationMessage): void {
    this.db.prepare(`
      INSERT INTO conversation_messages (id, conversationId, role, content, timestamp, tokens,
        provider, compressed, originalContent, toolCalls, toolCallId, attachments)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      message.id, conversationId, message.role,
      typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
      message.timestamp, message.tokens || 0,
      message.provider || '', message.compressed ? 1 : 0,
      message.originalContent || '',
      JSON.stringify(message.toolCalls || []),
      message.toolCallId || '',
      JSON.stringify(message.attachments || []),
    );

    this.db.prepare('UPDATE conversations SET updatedAt = ?, lastProvider = ? WHERE id = ?')
      .run(new Date().toISOString(), message.provider || '', conversationId);
  }

  getMessages(conversationId: string): ConversationMessage[] {
    const rows = this.db.prepare(
      'SELECT * FROM conversation_messages WHERE conversationId = ? ORDER BY timestamp ASC'
    ).all(conversationId) as Array<Record<string, unknown>>;
    return rows.map(r => ({
      id: r.id as string,
      conversationId: r.conversationId as string,
      role: r.role as ConversationMessage['role'],
      content: this._parseContent(r.content as string),
      timestamp: r.timestamp as string,
      tokens: r.tokens as number,
      provider: r.provider as string,
      compressed: (r.compressed as number) === 1,
      originalContent: r.originalContent as string || undefined,
      toolCalls: JSON.parse(r.toolCalls as string || '[]'),
      toolCallId: r.toolCallId as string || undefined,
      attachments: JSON.parse(r.attachments as string || '[]'),
    }));
  }

  list(filter: ConversationFilter): ConversationListResult {
    const conditions: string[] = [];
    const bindings: Record<string, unknown> = {};

    if (filter.search) {
      conditions.push('(id LIKE @search OR model LIKE @search OR clientType LIKE @search)');
      bindings.search = `%${filter.search}%`;
    }
    if (filter.clientType) { conditions.push('clientType = @clientType'); bindings.clientType = filter.clientType; }
    if (filter.model) { conditions.push('model = @model'); bindings.model = filter.model; }
    if (filter.active !== undefined) { conditions.push('active = @active'); bindings.active = filter.active ? 1 : 0; }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const allowedSorts = ['createdAt', 'updatedAt'];
    const sortCol = allowedSorts.includes(filter.sortBy || '') ? filter.sortBy! : 'updatedAt';
    const sortOrder = filter.sortOrder === 'asc' ? 'ASC' : 'DESC';

    const page = filter.page || 1;
    const limit = Math.min(filter.limit || 50, 500);
    const offset = (page - 1) * limit;

    const countRow = this.db.prepare(`SELECT COUNT(*) as c FROM conversations ${where}`).get(bindings) as { c: number };
    const total = countRow.c;

    const rows = this.db.prepare(`
      SELECT c.*, (SELECT COUNT(*) FROM conversation_messages WHERE conversationId = c.id) as messageCount
      FROM conversations c ${where}
      ORDER BY ${sortCol} ${sortOrder}
      LIMIT @limit OFFSET @offset
    `).all({ ...bindings, limit, offset }) as Array<Record<string, unknown>>;

    return {
      conversations: rows.map(r => ({
        id: r.id as string,
        clientType: r.clientType as string,
        model: r.model as string,
        messageCount: (r.messageCount as number) || 0,
        lastProvider: r.lastProvider as string || undefined,
        active: (r.active as number) === 1,
        createdAt: r.createdAt as string,
        updatedAt: r.updatedAt as string,
        tokenUsage: {
          inputTokens: (r.inputTokens as number) || 0,
          outputTokens: (r.outputTokens as number) || 0,
          totalTokens: (r.totalTokens as number) || 0,
          estimatedCost: (r.estimatedCost as number) || 0,
        },
      })),
      total, page, limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  addFile(conversationId: string, file: { id: string; name: string; mimeType: string; data?: string; size: number; type: string }): void {
    this.db.prepare(`
      INSERT INTO conversation_files (id, conversationId, name, mimeType, data, size, type)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(file.id, conversationId, file.name, file.mimeType, file.data || '', file.size, file.type);
  }

  getFiles(conversationId: string): Array<{ id: string; name: string; mimeType: string; size: number; type: string }> {
    return this.db.prepare(
      'SELECT id, name, mimeType, size, type FROM conversation_files WHERE conversationId = ?'
    ).all(conversationId) as Array<{ id: string; name: string; mimeType: string; size: number; type: string }>;
  }

  /** Mark old conversations inactive */
  archive(days: number): number {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const result = this.db.prepare('UPDATE conversations SET active = 0 WHERE updatedAt < ? AND active = 1').run(cutoff);
    return result.changes;
  }

  close(): void {
    this.db.close();
  }

  private _parseContent(content: string): string | ContentBlockData[] {
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) return parsed;
      return content;
    } catch {
      return content;
    }
  }

  private _rowToConversation(row: Record<string, unknown>, messageRows: Array<Record<string, unknown>>): Conversation {
    const messages = messageRows.map(r => ({
      id: r.id as string,
      role: r.role as ConversationMessage['role'],
      content: this._parseContent(r.content as string),
      timestamp: r.timestamp as string,
      tokens: r.tokens as number,
      provider: r.provider as string,
      compressed: (r.compressed as number) === 1,
      originalContent: r.originalContent as string || undefined,
      toolCalls: JSON.parse(r.toolCalls as string || '[]'),
      toolCallId: r.toolCallId as string || undefined,
      attachments: JSON.parse(r.attachments as string || '[]'),
    }));

    return {
      id: row.id as string,
      externalId: row.externalId as string || undefined,
      clientType: row.clientType as string,
      model: row.model as string,
      systemPrompt: row.systemPrompt as string || undefined,
      lastProvider: row.lastProvider as string || undefined,
      active: (row.active as number) === 1,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
      metadata: JSON.parse(row.metadata as string || '{}'),
      tokenUsage: {
        inputTokens: (row.inputTokens as number) || 0,
        outputTokens: (row.outputTokens as number) || 0,
        totalTokens: (row.totalTokens as number) || 0,
        estimatedCost: (row.estimatedCost as number) || 0,
      },
      compression: {
        enabled: (row.compressionEnabled as number) === 1,
        compressionCount: (row.compressionCount as number) || 0,
        tokensSaved: (row.tokensSaved as number) || 0,
        strategy: (row.compressionStrategy as string) as any || 'none',
      },
      messages,
    };
  }
}

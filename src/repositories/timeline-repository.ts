import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { type Logger } from '../types/logger.types.js';
import {
  type TimelineRecord,
  type TimelineFilter,
  type TimelineListResult,
  type TimelineStats,
} from '../types/timeline.types.js';

export class TimelineRepository {
  private db: Database.Database;

  constructor(
    private readonly logger: Logger,
    dbPath?: string,
  ) {
    const resolvedPath = dbPath || path.resolve(process.cwd(), 'data', 'timeline.db');
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this._createTables();
    this.logger.info(`Timeline DB initialized: ${resolvedPath}`);
  }

  private _createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS timeline (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        requestId TEXT UNIQUE NOT NULL,
        timestamp TEXT NOT NULL,
        client TEXT NOT NULL DEFAULT '',
        protocol TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        resolvedModel TEXT DEFAULT '',
        aliased INTEGER NOT NULL DEFAULT 0,
        aliasName TEXT DEFAULT '',
        combo TEXT DEFAULT '',
        providers TEXT DEFAULT '',
        finalProvider TEXT DEFAULT '',
        latencyMs INTEGER NOT NULL DEFAULT 0,
        success INTEGER NOT NULL DEFAULT 1,
        streamed INTEGER NOT NULL DEFAULT 0,
        retries INTEGER NOT NULL DEFAULT 0,
        fallbacks INTEGER NOT NULL DEFAULT 0,
        statusCode INTEGER DEFAULT NULL,
        error TEXT DEFAULT '',
        tokens INTEGER DEFAULT 0,
        cost REAL DEFAULT 0,
        stageTimeline TEXT DEFAULT '[]',
        promptPreview TEXT DEFAULT '',
        responseLength INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_timeline_ts ON timeline(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_timeline_client ON timeline(client);
      CREATE INDEX IF NOT EXISTS idx_timeline_model ON timeline(model);
      CREATE INDEX IF NOT EXISTS idx_timeline_success ON timeline(success);
      CREATE INDEX IF NOT EXISTS idx_timeline_requestId ON timeline(requestId);
    `);
  }

  insert(record: TimelineRecord): void {
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO timeline
          (requestId, timestamp, client, protocol, model, resolvedModel, aliased, aliasName,
           combo, providers, finalProvider, latencyMs, success, streamed, retries, fallbacks,
           statusCode, error, tokens, cost, stageTimeline, promptPreview, responseLength)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.requestId, record.timestamp, record.client, record.protocol,
        record.model, record.resolvedModel || '', record.aliased ? 1 : 0, record.aliasName || '',
        record.combo || '', record.providers, record.finalProvider || '',
        record.latencyMs, record.success ? 1 : 0, record.streamed ? 1 : 0,
        record.retries, record.fallbacks, record.statusCode ?? null,
        record.error || '', record.tokens ?? 0, record.cost ?? 0,
        record.stageTimeline, record.promptPreview || '', record.responseLength ?? 0,
      );
    } catch (err) {
      this.logger.error(`Failed to insert timeline record: ${(err as Error).message}`);
    }
  }

  list(filter: TimelineFilter): TimelineListResult {
    const conditions: string[] = [];
    const bindings: Record<string, unknown> = {};

    if (filter.search) {
      conditions.push('(model LIKE @search OR client LIKE @search OR error LIKE @search OR combo LIKE @search)');
      bindings.search = `%${filter.search}%`;
    }
    if (filter.client) { conditions.push('client = @client'); bindings.client = filter.client; }
    if (filter.model) { conditions.push('model = @model'); bindings.model = filter.model; }
    if (filter.success !== undefined) { conditions.push('success = @success'); bindings.success = filter.success ? 1 : 0; }
    if (filter.aliased !== undefined) { conditions.push('aliased = @aliased'); bindings.aliased = filter.aliased ? 1 : 0; }
    if (filter.streamed !== undefined) { conditions.push('streamed = @streamed'); bindings.streamed = filter.streamed ? 1 : 0; }
    if (filter.minLatency !== undefined) { conditions.push('latencyMs >= @minLatency'); bindings.minLatency = filter.minLatency; }
    if (filter.maxLatency !== undefined) { conditions.push('latencyMs <= @maxLatency'); bindings.maxLatency = filter.maxLatency; }

    if (filter.startDate) { conditions.push('timestamp >= @startDate'); bindings.startDate = filter.startDate; }
    if (filter.endDate) { conditions.push('timestamp <= @endDate'); bindings.endDate = filter.endDate; }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const allowedSorts = ['timestamp', 'latencyMs', 'tokens', 'cost'];
    const sortCol = allowedSorts.includes(filter.sortBy || '') ? filter.sortBy! : 'timestamp';
    const sortOrder = filter.sortOrder === 'asc' ? 'ASC' : 'DESC';

    const page = filter.page || 1;
    const limit = Math.min(filter.limit || 50, 500);
    const offset = (page - 1) * limit;

    const countRow = this.db.prepare(`SELECT COUNT(*) as c FROM timeline ${where}`).get(bindings) as { c: number };
    const total = countRow.c;

    const rows = this.db.prepare(`
      SELECT * FROM timeline ${where}
      ORDER BY ${sortCol} ${sortOrder}
      LIMIT @limit OFFSET @offset
    `).all({ ...bindings, limit, offset }) as Array<Record<string, unknown>>;

    return {
      records: rows.map(r => this._rowToRecord(r)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  getByRequestId(requestId: string): TimelineRecord | undefined {
    const row = this.db.prepare('SELECT * FROM timeline WHERE requestId = ?').get(requestId) as Record<string, unknown> | undefined;
    return row ? this._rowToRecord(row) : undefined;
  }

  getStats(filter?: { startDate?: string; endDate?: string }): TimelineStats {
    let where = '';
    const bindings: Record<string, unknown> = {};
    if (filter?.startDate) { where = 'WHERE timestamp >= @startDate'; bindings.startDate = filter.startDate; }
    if (filter?.endDate) {
      where += where ? ' AND' : 'WHERE';
      where += ' timestamp <= @endDate';
      bindings.endDate = filter.endDate;
    }

    const base = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
        COALESCE(AVG(latencyMs), 0) as avgLat,
        COALESCE(SUM(tokens), 0) as totalTok,
        COALESCE(SUM(cost), 0) as totalCost,
        SUM(CASE WHEN aliased = 1 THEN 1 ELSE 0 END) as aliasedCount,
        SUM(CASE WHEN streamed = 1 THEN 1 ELSE 0 END) as streamedCount
      FROM timeline ${where}
    `).get(bindings) as Record<string, unknown>;

    const total = (base.total as number) || 0;
    const successes = (base.successes as number) || 0;

    // Top clients
    const clients = this.db.prepare(`
      SELECT client, COUNT(*) as c FROM timeline ${where}
      GROUP BY client ORDER BY c DESC LIMIT 5
    `).all(bindings) as Array<{ client: string; c: number }>;

    // Top models
    const models = this.db.prepare(`
      SELECT model, COUNT(*) as c FROM timeline ${where}
      GROUP BY model ORDER BY c DESC LIMIT 10
    `).all(bindings) as Array<{ model: string; c: number }>;

    return {
      totalRequests: total,
      successRate: total > 0 ? successes / total : 0,
      avgLatency: base.avgLat as number,
      totalTokens: base.totalTok as number,
      totalCost: base.totalCost as number,
      topClients: clients.map(c => ({ client: c.client, count: c.c })),
      topModels: models.map(m => ({ model: m.model, count: m.c })),
      errorRate: total > 0 ? (total - successes) / total : 0,
      aliasUsageRate: total > 0 ? ((base.aliasedCount as number) || 0) / total : 0,
      streamingRate: total > 0 ? ((base.streamedCount as number) || 0) / total : 0,
    };
  }

  /** Delete records older than N days */
  prune(days: number): number {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const result = this.db.prepare('DELETE FROM timeline WHERE timestamp < ?').run(cutoff);
    this.logger.info(`Pruned ${result.changes} timeline records older than ${days} days`);
    return result.changes;
  }

  close(): void {
    this.db.close();
  }

  private _rowToRecord(row: Record<string, unknown>): TimelineRecord {
    return {
      id: row.id as number,
      requestId: row.requestId as string,
      timestamp: row.timestamp as string,
      client: row.client as string,
      protocol: row.protocol as string,
      model: row.model as string,
      resolvedModel: row.resolvedModel as string || undefined,
      aliased: (row.aliased as number) === 1,
      aliasName: row.aliasName as string || undefined,
      combo: row.combo as string || undefined,
      providers: row.providers as string,
      finalProvider: row.finalProvider as string || undefined,
      latencyMs: row.latencyMs as number,
      success: (row.success as number) === 1,
      streamed: (row.streamed as number) === 1,
      retries: row.retries as number,
      fallbacks: row.fallbacks as number,
      statusCode: row.statusCode as number | null ?? undefined,
      error: row.error as string || undefined,
      tokens: row.tokens as number || 0,
      cost: row.cost as number || 0,
      stageTimeline: row.stageTimeline as string,
      promptPreview: row.promptPreview as string || undefined,
      responseLength: row.responseLength as number || 0,
    };
  }
}

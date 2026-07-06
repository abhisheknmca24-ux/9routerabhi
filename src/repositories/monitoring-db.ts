import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { type Logger } from '../types/logger.types.js';
import {
  type ProviderMetricsSnapshot,
  type ProviderDailyStats,
} from '../types/monitoring.types.js';

export class MonitoringDatabase {
  private db: Database.Database;

  constructor(
    private readonly logger: Logger,
    dbPath?: string,
  ) {
    const resolvedPath = dbPath || path.resolve(process.cwd(), 'data', 'monitoring.db');
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this._createTables();
    this.logger.info(`Monitoring DB initialized: ${resolvedPath}`);
  }

  private _createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metrics_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        providerId TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        alive INTEGER NOT NULL DEFAULT 1,
        latency REAL NOT NULL DEFAULT 0,
        successCount INTEGER NOT NULL DEFAULT 0,
        errorCount INTEGER NOT NULL DEFAULT 0,
        successRate REAL NOT NULL DEFAULT 1.0,
        count429 INTEGER NOT NULL DEFAULT 0,
        count502 INTEGER NOT NULL DEFAULT 0,
        dailyRequests INTEGER NOT NULL DEFAULT 0,
        tokens INTEGER NOT NULL DEFAULT 0,
        cost REAL NOT NULL DEFAULT 0.0,
        status TEXT NOT NULL DEFAULT 'unknown',
        healthScore REAL NOT NULL DEFAULT 1.0
      );

      CREATE TABLE IF NOT EXISTS daily_stats (
        date TEXT NOT NULL,
        providerId TEXT NOT NULL,
        totalRequests INTEGER NOT NULL DEFAULT 0,
        successfulRequests INTEGER NOT NULL DEFAULT 0,
        failedRequests INTEGER NOT NULL DEFAULT 0,
        successRate REAL NOT NULL DEFAULT 1.0,
        count429 INTEGER NOT NULL DEFAULT 0,
        count502 INTEGER NOT NULL DEFAULT 0,
        avgLatency REAL NOT NULL DEFAULT 0,
        totalTokens INTEGER NOT NULL DEFAULT 0,
        totalCost REAL NOT NULL DEFAULT 0.0,
        PRIMARY KEY (date, providerId)
      );

      CREATE INDEX IF NOT EXISTS idx_snapshots_provider ON metrics_snapshots(providerId, timestamp);
      CREATE INDEX IF NOT EXISTS idx_daily_provider ON daily_stats(providerId, date);
    `);
  }

  insertSnapshot(snapshot: ProviderMetricsSnapshot): void {
    const stmt = this.db.prepare(`
      INSERT INTO metrics_snapshots
        (providerId, timestamp, alive, latency, successCount, errorCount,
         successRate, count429, count502, dailyRequests, tokens, cost, status, healthScore)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      snapshot.providerId,
      snapshot.timestamp,
      snapshot.alive ? 1 : 0,
      snapshot.latency,
      snapshot.successCount,
      snapshot.errorCount,
      snapshot.successRate,
      snapshot.count429,
      snapshot.count502,
      snapshot.dailyRequests,
      snapshot.tokens,
      snapshot.cost,
      snapshot.status,
      snapshot.healthScore,
    );
  }

  updateDailyStats(
    date: string,
    providerId: string,
    success: boolean,
    latency: number,
    statusCode: number | undefined,
    tokens: number,
    cost: number,
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO daily_stats (date, providerId, totalRequests, successfulRequests, failedRequests,
        successRate, count429, count502, avgLatency, totalTokens, totalCost)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date, providerId) DO UPDATE SET
        totalRequests = totalRequests + 1,
        successfulRequests = successfulRequests + ?,
        failedRequests = failedRequests + ?,
        successRate = CAST(successfulRequests AS REAL) / CAST(totalRequests AS REAL),
        count429 = count429 + ?,
        count502 = count502 + ?,
        avgLatency = (avgLatency * (totalRequests - 1) + ?) / totalRequests,
        totalTokens = totalTokens + ?,
        totalCost = totalCost + ?
    `);

    const isSuccess = success ? 1 : 0;
    const isFail = success ? 0 : 1;
    const is429 = statusCode === 429 ? 1 : 0;
    const is502 = statusCode === 502 ? 1 : 0;

    stmt.run(
      date, providerId,
      isSuccess, isFail,
      isSuccess ? 0 : 1,  // failed requests for insert
      isSuccess ? 1 : 0,  // successRate for insert
      is429, is502, latency, tokens, cost,  // for insert
      isSuccess, isFail, is429, is502, latency, tokens, cost,  // for update
    );
  }

  getProviderHistory(providerId: string, hours: number = 24): ProviderMetricsSnapshot[] {
    const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();
    const stmt = this.db.prepare(`
      SELECT * FROM metrics_snapshots
      WHERE providerId = ? AND timestamp >= ?
      ORDER BY timestamp ASC
    `);
    const rows = stmt.all(providerId, cutoff) as Array<Record<string, unknown>>;
    return rows.map(r => ({
      id: r.id as number,
      providerId: r.providerId as string,
      timestamp: r.timestamp as string,
      alive: (r.alive as number) === 1,
      latency: r.latency as number,
      successCount: r.successCount as number,
      errorCount: r.errorCount as number,
      successRate: r.successRate as number,
      count429: r.count429 as number,
      count502: r.count502 as number,
      dailyRequests: r.dailyRequests as number,
      tokens: r.tokens as number,
      cost: r.cost as number,
      status: r.status as string,
      healthScore: r.healthScore as number,
    }));
  }

  getDailyStats(providerId: string, days: number = 30): ProviderDailyStats[] {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const stmt = this.db.prepare(`
      SELECT * FROM daily_stats
      WHERE providerId = ? AND date >= ?
      ORDER BY date ASC
    `);
    const rows = stmt.all(providerId, cutoff) as Array<Record<string, unknown>>;
    return rows.map(r => ({
      date: r.date as string,
      providerId: r.providerId as string,
      totalRequests: r.totalRequests as number,
      successfulRequests: r.successfulRequests as number,
      failedRequests: r.failedRequests as number,
      successRate: r.successRate as number,
      count429: r.count429 as number,
      count502: r.count502 as number,
      avgLatency: r.avgLatency as number,
      totalTokens: r.totalTokens as number,
      totalCost: r.totalCost as number,
    }));
  }

  getLatestSnapshot(providerId: string): ProviderMetricsSnapshot | null {
    const stmt = this.db.prepare(`
      SELECT * FROM metrics_snapshots
      WHERE providerId = ?
      ORDER BY timestamp DESC LIMIT 1
    `);
    const row = stmt.get(providerId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as number,
      providerId: row.providerId as string,
      timestamp: row.timestamp as string,
      alive: (row.alive as number) === 1,
      latency: row.latency as number,
      successCount: row.successCount as number,
      errorCount: row.errorCount as number,
      successRate: row.successRate as number,
      count429: row.count429 as number,
      count502: row.count502 as number,
      dailyRequests: row.dailyRequests as number,
      tokens: row.tokens as number,
      cost: row.cost as number,
      status: row.status as string,
      healthScore: row.healthScore as number,
    };
  }

  getAllLatestSnapshots(): ProviderMetricsSnapshot[] {
    const stmt = this.db.prepare(`
      SELECT m.* FROM metrics_snapshots m
      INNER JOIN (
        SELECT providerId, MAX(timestamp) as maxTs
        FROM metrics_snapshots GROUP BY providerId
      ) latest ON m.providerId = latest.providerId AND m.timestamp = latest.maxTs
    `);
    const rows = stmt.all() as Array<Record<string, unknown>>;
    return rows.map(r => ({
      id: r.id as number,
      providerId: r.providerId as string,
      timestamp: r.timestamp as string,
      alive: (r.alive as number) === 1,
      latency: r.latency as number,
      successCount: r.successCount as number,
      errorCount: r.errorCount as number,
      successRate: r.successRate as number,
      count429: r.count429 as number,
      count502: r.count502 as number,
      dailyRequests: r.dailyRequests as number,
      tokens: r.tokens as number,
      cost: r.cost as number,
      status: r.status as string,
      healthScore: r.healthScore as number,
    }));
  }

  close(): void {
    this.db.close();
  }
}

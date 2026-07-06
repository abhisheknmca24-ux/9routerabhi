import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { type Logger } from '../types/logger.types.js';
import {
  type AliasConfig,
  type AliasFilterParams,
  type AliasListResult,
  type AliasTargetType,
  type CreateAliasRequest,
} from '../types/alias.types.js';
export class AliasRepository {
  private db: Database.Database;

  constructor(
    private readonly logger: Logger,
    dbPath?: string,
  ) {
    const resolvedPath = dbPath || path.resolve(process.cwd(), 'data', 'aliases.db');
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this._createTables();
    this.logger.info(`Alias DB initialized: ${resolvedPath}`);
  }

  private _createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS aliases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        target TEXT NOT NULL,
        targetType TEXT NOT NULL DEFAULT 'combo',
        enabled INTEGER NOT NULL DEFAULT 1,
        priority INTEGER NOT NULL DEFAULT 0,
        description TEXT DEFAULT '',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS alias_stats (
        aliasId INTEGER NOT NULL PRIMARY KEY,
        totalRequests INTEGER NOT NULL DEFAULT 0,
        successfulRequests INTEGER NOT NULL DEFAULT 0,
        failedRequests INTEGER NOT NULL DEFAULT 0,
        lastUsed TEXT DEFAULT NULL,
        FOREIGN KEY (aliasId) REFERENCES aliases(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_aliases_name ON aliases(name);
      CREATE INDEX IF NOT EXISTS idx_aliases_enabled ON aliases(enabled);
      CREATE INDEX IF NOT EXISTS idx_aliases_priority ON aliases(priority);
      CREATE INDEX IF NOT EXISTS idx_aliases_target ON aliases(target);
    `);
  }

  getAll(): AliasConfig[] {
    const rows = this.db.prepare(`
      SELECT a.*, s.totalRequests, s.successfulRequests, s.failedRequests, s.lastUsed
      FROM aliases a
      LEFT JOIN alias_stats s ON a.id = s.aliasId
      ORDER BY a.priority ASC, a.name ASC
    `).all() as Array<Record<string, unknown>>;
    return rows.map(r => this._rowToConfig(r));
  }

  list(params: AliasFilterParams): AliasListResult {
    const conditions: string[] = [];
    const bindings: Record<string, unknown> = {};

    if (params.search) {
      conditions.push('(a.name LIKE @search OR a.target LIKE @search OR a.description LIKE @search)');
      bindings.search = `%${params.search}%`;
    }
    if (params.targetType) {
      conditions.push('a.targetType = @targetType');
      bindings.targetType = params.targetType;
    }
    if (params.enabled !== undefined) {
      conditions.push('a.enabled = @enabled');
      bindings.enabled = params.enabled ? 1 : 0;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sortCol = params.sortBy || 'priority';
    const sortOrder = params.sortOrder || 'asc';
    const allowedSorts = ['name', 'priority', 'createdAt', 'updatedAt'];
    const col = allowedSorts.includes(sortCol) ? sortCol : 'priority';
    const order = sortOrder === 'desc' ? 'DESC' : 'ASC';

    const page = params.page || 1;
    const limit = params.limit || 50;
    const offset = (page - 1) * limit;

    const countResult = this.db.prepare(`SELECT COUNT(*) as count FROM aliases a ${where}`).get(bindings) as { count: number };
    const total = countResult.count;

    const rows = this.db.prepare(`
      SELECT a.*, s.totalRequests, s.successfulRequests, s.failedRequests, s.lastUsed
      FROM aliases a
      LEFT JOIN alias_stats s ON a.id = s.aliasId
      ${where}
      ORDER BY a.${col} ${order}
      LIMIT @limit OFFSET @offset
    `).all({ ...bindings, limit, offset }) as Array<Record<string, unknown>>;

    return {
      aliases: rows.map(r => this._rowToConfig(r)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  getByName(name: string): AliasConfig | undefined {
    const row = this.db.prepare(`
      SELECT a.*, s.totalRequests, s.successfulRequests, s.failedRequests, s.lastUsed
      FROM aliases a
      LEFT JOIN alias_stats s ON a.id = s.aliasId
      WHERE a.name = ?
    `).get(name) as Record<string, unknown> | undefined;
    return row ? this._rowToConfig(row) : undefined;
  }

  getById(id: number): AliasConfig | undefined {
    const row = this.db.prepare(`
      SELECT a.*, s.totalRequests, s.successfulRequests, s.failedRequests, s.lastUsed
      FROM aliases a
      LEFT JOIN alias_stats s ON a.id = s.aliasId
      WHERE a.id = ?
    `).get(id) as Record<string, unknown> | undefined;
    return row ? this._rowToConfig(row) : undefined;
  }

  create(req: CreateAliasRequest): AliasConfig {
    const now = new Date().toISOString();
    const name = req.name.trim();
    const target = req.target.trim();

    const result = this.db.prepare(`
      INSERT INTO aliases (name, target, targetType, enabled, priority, description, createdAt, updatedAt)
      VALUES (@name, @target, @targetType, @enabled, @priority, @description, @createdAt, @updatedAt)
    `).run({
      name,
      target,
      targetType: req.targetType,
      enabled: req.enabled !== false ? 1 : 0,
      priority: req.priority ?? 0,
      description: req.description?.trim() ?? '',
      createdAt: now,
      updatedAt: now,
    });

    // Create stats row
    this.db.prepare(`
      INSERT INTO alias_stats (aliasId, totalRequests, successfulRequests, failedRequests, lastUsed)
      VALUES (@id, 0, 0, 0, NULL)
    `).run({ id: result.lastInsertRowid });

    return this.getById(result.lastInsertRowid as number)!;
  }

  update(name: string, updates: Partial<Omit<AliasConfig, 'name' | 'createdAt'>>): AliasConfig | null {
    const existing = this.getByName(name);
    if (!existing) return null;

    const sets: string[] = [];
    const bindings: Record<string, unknown> = { id: existing.id };

    if (updates.target !== undefined) { sets.push('target = @target'); bindings.target = updates.target.trim(); }
    if (updates.targetType !== undefined) { sets.push('targetType = @targetType'); bindings.targetType = updates.targetType; }
    if (updates.enabled !== undefined) { sets.push('enabled = @enabled'); bindings.enabled = updates.enabled ? 1 : 0; }
    if (updates.priority !== undefined) { sets.push('priority = @priority'); bindings.priority = updates.priority; }
    if (updates.description !== undefined) { sets.push('description = @description'); bindings.description = updates.description.trim(); }

    if (sets.length > 0) {
      sets.push('updatedAt = @updatedAt');
      bindings.updatedAt = new Date().toISOString();

      this.db.prepare(`UPDATE aliases SET ${sets.join(', ')} WHERE id = @id`).run(bindings);
    }

    return this.getById(existing.id!)!;
  }

  delete(name: string): boolean {
    const existing = this.getByName(name);
    if (!existing) return false;
    this.db.prepare('DELETE FROM aliases WHERE id = ?').run(existing.id);
    return true;
  }

  exists(name: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM aliases WHERE name = ?').get(name);
    return !!row;
  }

  count(filter?: { enabled?: boolean }): number {
    if (filter?.enabled !== undefined) {
      const row = this.db.prepare('SELECT COUNT(*) as c FROM aliases WHERE enabled = ?').get(filter.enabled ? 1 : 0) as { c: number };
      return row.c;
    }
    const row = this.db.prepare('SELECT COUNT(*) as c FROM aliases').get() as { c: number };
    return row.c;
  }

  importAliases(newAliases: AliasConfig[], overwrite: boolean): { imported: number; skipped: number; errors: Array<{ name: string; reason: string }> } {
    let imported = 0;
    let skipped = 0;
    const errors: Array<{ name: string; reason: string }> = [];
    const insert = this.db.transaction(() => {
      for (const alias of newAliases) {
        if (!alias.name || !alias.target) {
          errors.push({ name: alias.name || '(unnamed)', reason: 'Missing name or target' });
          skipped++;
          continue;
        }
        const exists = this.db.prepare('SELECT id FROM aliases WHERE name = ?').get(alias.name);
        if (exists) {
          if (overwrite) {
            this.db.prepare(`
              UPDATE aliases SET target = ?, targetType = ?, enabled = ?, priority = ?, description = ?, updatedAt = ?
              WHERE name = ?
            `).run(alias.target, alias.targetType || 'combo', alias.enabled ? 1 : 0, alias.priority ?? 0, alias.description ?? '', new Date().toISOString(), alias.name);
            imported++;
          } else {
            skipped++;
          }
        } else {
          const now = new Date().toISOString();
          const result = this.db.prepare(`
            INSERT INTO aliases (name, target, targetType, enabled, priority, description, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(alias.name, alias.target, alias.targetType || 'combo', alias.enabled ? 1 : 0, alias.priority ?? 0, alias.description ?? '', now, now);
          this.db.prepare('INSERT INTO alias_stats (aliasId) VALUES (?)').run(result.lastInsertRowid);
          imported++;
        }
      }
    });

    try {
      insert();
    } catch (err) {
      this.logger.error(`Import transaction failed: ${(err as Error).message}`);
      return { imported: 0, skipped: newAliases.length, errors: [{ name: '(transaction)', reason: (err as Error).message }] };
    }

    this.logger.info(`Imported ${imported} aliases, skipped ${skipped}, ${errors.length} errors`);
    return { imported, skipped, errors };
  }

  exportAliases(): AliasConfig[] {
    return this.getAll();
  }

  recordUsage(aliasId: number, success: boolean): void {
    this.db.prepare(`
      INSERT INTO alias_stats (aliasId, totalRequests, successfulRequests, failedRequests, lastUsed)
      VALUES (?, 1, ?, ?, datetime('now'))
      ON CONFLICT(aliasId) DO UPDATE SET
        totalRequests = totalRequests + 1,
        successfulRequests = successfulRequests + ?,
        failedRequests = failedRequests + ?,
        lastUsed = datetime('now')
    `).run(aliasId, success ? 1 : 0, success ? 0 : 1, success ? 1 : 0, success ? 0 : 1);
  }

  resolve(name: string): AliasConfig | undefined {
    const row = this.db.prepare(`
      SELECT a.*, s.totalRequests, s.successfulRequests, s.failedRequests, s.lastUsed
      FROM aliases a
      LEFT JOIN alias_stats s ON a.id = s.aliasId
      WHERE a.name = ? AND a.enabled = 1
      ORDER BY a.priority ASC
      LIMIT 1
    `).get(name) as Record<string, unknown> | undefined;
    return row ? this._rowToConfig(row) : undefined;
  }

  close(): void {
    this.db.close();
  }

  private _rowToConfig(row: Record<string, unknown>): AliasConfig {
    return {
      id: row.id as number,
      name: row.name as string,
      target: row.target as string,
      targetType: (row.targetType as AliasTargetType) || 'combo',
      enabled: (row.enabled as number) === 1,
      priority: (row.priority as number) || 0,
      description: (row.description as string) || undefined,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
      stats: {
        totalRequests: (row.totalRequests as number) || 0,
        successfulRequests: (row.successfulRequests as number) || 0,
        failedRequests: (row.failedRequests as number) || 0,
        lastUsed: (row.lastUsed as string) || null,
      },
    };
  }
}

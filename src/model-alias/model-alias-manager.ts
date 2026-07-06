import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ModelAliasManager
 *
 * A clean, reusable alias engine that maps friendly model names
 * (like "claude-sonnet-4-5") to internal combo profiles (like "Coding").
 *
 * - File-based configuration (no database dependency)
 * - Zero hardcoded values
 * - Easy future expansion — just add entries to aliases.json
 * - Reusable — instantiate with any config path
 * - No routing engine changes — only resolves names
 */

export interface ModelAlias {
  /** The friendly model name clients will use */
  name: string;
  /** The internal combo profile or model ID to route to */
  target: string;
  /** Optional human-readable description */
  description?: string;
}

export interface AliasFile {
  version: number;
  description?: string;
  aliases: ModelAlias[];
}

export class ModelAliasManager {
  private aliases: ModelAlias[] = [];
  private configPath: string;

  /**
   * @param configPath Path to the aliases JSON file. Defaults to config/aliases.json
   */
  constructor(configPath?: string) {
    this.configPath = configPath ?? this._defaultConfigPath();
    this._load();
  }

  /**
   * Resolve a model name to its target combo/profile.
   * Returns null if no alias matches.
   */
  resolve(modelName: string): string | null {
    const alias = this.aliases.find(a => a.name === modelName);
    return alias ? alias.target : null;
  }

  /**
   * Get the full alias object for a model name.
   * Returns undefined if no alias matches.
   */
  get(modelName: string): ModelAlias | undefined {
    return this.aliases.find(a => a.name === modelName);
  }

  /**
   * Get all configured aliases.
   */
  getAll(): ModelAlias[] {
    return [...this.aliases];
  }

  /**
   * Check if a model name has an alias.
   */
  has(modelName: string): boolean {
    return this.aliases.some(a => a.name === modelName);
  }

  /**
   * Reload aliases from disk (for hot-reload).
   */
  reload(): void {
    this._load();
  }

  /**
   * Get the total count of aliases.
   */
  get count(): number {
    return this.aliases.length;
  }

  /**
   * Set a custom config path and reload.
   */
  setConfigPath(configPath: string): void {
    this.configPath = configPath;
    this._load();
  }

  // ── Private ──

  private _load(): void {
    try {
      const resolvedPath = path.resolve(this.configPath);
      if (!fs.existsSync(resolvedPath)) {
        console.warn(`[ModelAliasManager] Config not found at ${resolvedPath}, starting empty`);
        this.aliases = [];
        return;
      }

      const raw = fs.readFileSync(resolvedPath, 'utf-8');
      const data: AliasFile = JSON.parse(raw);

      if (!data.aliases || !Array.isArray(data.aliases)) {
        console.warn('[ModelAliasManager] Invalid aliases config: missing aliases array');
        this.aliases = [];
        return;
      }

      this.aliases = data.aliases.filter(a => a.name && a.target);
      console.log(`[ModelAliasManager] Loaded ${this.aliases.length} aliases from ${resolvedPath}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[ModelAliasManager] Failed to load aliases: ${message}`);
      this.aliases = [];
    }
  }

  private _defaultConfigPath(): string {
    // Try to find config relative to project root
    const cwd = process.cwd();
    const candidates = [
      path.join(cwd, 'config', 'aliases.json'),
      path.join(cwd, '..', 'config', 'aliases.json'),
      path.join(__dirname, '..', '..', 'config', 'aliases.json'),
      path.join(__dirname, '..', '..', '..', 'config', 'aliases.json'),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }

    // Default fallback
    return path.join(cwd, 'config', 'aliases.json');
  }
}

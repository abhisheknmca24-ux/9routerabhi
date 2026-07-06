import fs from 'node:fs';
import path from 'node:path';
import { type Logger } from '../types/logger.types.js';
import { type AliasConfig, type AliasFile } from '../types/alias.types.js';

const ALIASES_VERSION = 1;

export class AliasRepository {
  private aliases: AliasConfig[] = [];
  private readonly filePath: string;

  constructor(
    private readonly logger: Logger,
    configDir: string,
  ) {
    this.filePath = path.join(configDir, 'aliases.json');
    this._load();
  }

  getAll(): AliasConfig[] {
    return [...this.aliases];
  }

  getByName(name: string): AliasConfig | undefined {
    return this.aliases.find(a => a.name === name);
  }

  search(query: string): AliasConfig[] {
    const lower = query.toLowerCase();
    return this.aliases.filter(a =>
      a.name.toLowerCase().includes(lower) ||
      a.target.toLowerCase().includes(lower) ||
      (a.description ?? '').toLowerCase().includes(lower),
    );
  }

  add(alias: AliasConfig): void {
    this.aliases.push(alias);
    this._save();
  }

  update(name: string, updates: Partial<Omit<AliasConfig, 'name' | 'createdAt'>>): AliasConfig | null {
    const idx = this.aliases.findIndex(a => a.name === name);
    if (idx === -1) return null;
    this.aliases[idx] = { ...this.aliases[idx], ...updates, updatedAt: new Date().toISOString() };
    this._save();
    return this.aliases[idx];
  }

  delete(name: string): boolean {
    const idx = this.aliases.findIndex(a => a.name === name);
    if (idx === -1) return false;
    this.aliases.splice(idx, 1);
    this._save();
    return true;
  }

  exists(name: string): boolean {
    return this.aliases.some(a => a.name === name);
  }

  count(): number {
    return this.aliases.length;
  }

  importAliases(newAliases: AliasConfig[], overwrite: boolean): { imported: number; skipped: number; errors: Array<{ name: string; reason: string }> } {
    let imported = 0;
    let skipped = 0;
    const errors: Array<{ name: string; reason: string }> = [];

    for (const alias of newAliases) {
      if (!alias.name || !alias.target) {
        errors.push({ name: alias.name || '(unnamed)', reason: 'Missing name or target' });
        skipped++;
        continue;
      }
      const existing = this.aliases.findIndex(a => a.name === alias.name);
      if (existing !== -1) {
        if (overwrite) {
          this.aliases[existing] = { ...alias, updatedAt: new Date().toISOString() };
          imported++;
        } else {
          skipped++;
        }
      } else {
        this.aliases.push({ ...alias, createdAt: alias.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() });
        imported++;
      }
    }

    this._save();
    this.logger.info(`Imported ${imported} aliases, skipped ${skipped}, ${errors.length} errors`);
    return { imported, skipped, errors };
  }

  exportAliases(): AliasConfig[] {
    return this.getAll();
  }

  private _load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const data = JSON.parse(raw) as AliasFile;
        this.aliases = data.aliases ?? [];
        this.logger.info(`Loaded ${this.aliases.length} aliases from ${this.filePath}`);
      } else {
        this.aliases = [];
        this.logger.info('No aliases file found, starting empty');
      }
    } catch (err) {
      this.logger.error(`Failed to load aliases: ${(err as Error).message}`);
      this.aliases = [];
    }
  }

  private _save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const data: AliasFile = { version: ALIASES_VERSION, aliases: this.aliases };
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      this.logger.error(`Failed to save aliases: ${(err as Error).message}`);
    }
  }
}

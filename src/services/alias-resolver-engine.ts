import { type Logger } from '../types/logger.types.js';
import { type AliasConfig, type AliasListResult, type AliasFilterParams } from '../types/alias.types.js';
import { AliasRepository } from '../repositories/alias-repository.js';

/**
 * AliasResolverEngine — sits between incoming model names and the routing engine.
 *
 * When a client sends a model name that isn't a raw provider model (no '/'),
 * this engine checks if it's an alias and resolves it to the target combo/profile.
 *
 * The routing engine never sees the alias — it only sees the resolved target.
 */
export class AliasResolverEngine {
  constructor(
    private readonly repository: AliasRepository,
    private readonly logger: Logger,
  ) {}

  /**
   * Resolve a model name through the alias engine.
   * Returns the alias config if found and enabled, or null if not an alias.
   * Also records usage stats for the alias.
   */
  resolve(model: string): { target: string; targetType: string } | null {
    // Only resolve names without '/' (raw provider models bypass aliases)
    if (model.includes('/')) return null;

    const alias = this.repository.resolve(model);
    if (!alias || !alias.id) return null;

    // Record usage
    this.repository.recordUsage(alias.id, true);

    this.logger.debug(`Alias resolved: ${model} → ${alias.target} (${alias.targetType})`, {
      alias: model,
      target: alias.target,
      type: alias.targetType,
    });

    return { target: alias.target, targetType: alias.targetType };
  }

  /**
   * Record a failure for an alias (for stats tracking).
   */
  recordFailure(model: string): void {
    if (model.includes('/')) return;
    const alias = this.repository.resolve(model);
    if (alias?.id) {
      this.repository.recordUsage(alias.id, false);
    }
  }

  /**
   * Preview what an alias would resolve to without recording stats.
   */
  preview(model: string): { alias: AliasConfig | null; resolvedTarget: string; targetType: string } {
    if (model.includes('/')) {
      return { alias: null, resolvedTarget: model, targetType: 'model' };
    }

    const alias = this.repository.resolve(model);
    if (alias) {
      return {
        alias,
        resolvedTarget: alias.target,
        targetType: alias.targetType,
      };
    }

    // Check if it matches any disabled alias
    const all = this.repository.getAll();
    const disabled = all.find(a => a.name === model && !a.enabled);
    if (disabled) {
      return { alias: disabled, resolvedTarget: '(disabled)', targetType: disabled.targetType };
    }

    return { alias: null, resolvedTarget: model, targetType: 'model' };
  }

  /** List aliases with filters */
  list(params: AliasFilterParams): AliasListResult {
    return this.repository.list(params);
  }

  /** Get single alias */
  get(name: string): AliasConfig | null {
    return this.repository.getByName(name) ?? null;
  }

  /** Get all aliases */
  getAll(): AliasConfig[] {
    return this.repository.getAll();
  }

  /** Create alias */
  create(config: {
    name: string; target: string; targetType: 'combo' | 'model';
    enabled?: boolean; priority?: number; description?: string;
  }): AliasConfig {
    return this.repository.create({
      name: config.name,
      target: config.target,
      targetType: config.targetType,
      enabled: config.enabled,
      priority: config.priority,
      description: config.description,
    });
  }

  /** Update alias */
  update(name: string, updates: Partial<Omit<AliasConfig, 'name' | 'createdAt'>>): AliasConfig | null {
    return this.repository.update(name, updates);
  }

  /** Delete alias */
  delete(name: string): boolean {
    return this.repository.delete(name);
  }

  /** Toggle enable/disable */
  toggle(name: string, enabled: boolean): AliasConfig | null {
    return this.repository.update(name, { enabled });
  }

  /** Bulk import */
  importAliases(data: unknown, overwrite: boolean): ReturnType<AliasRepository['importAliases']> {
    const aliases = Array.isArray(data) ? data : [];
    return this.repository.importAliases(
      aliases.map((a: Record<string, unknown>) => ({
        name: String(a.name ?? ''),
        target: String(a.target ?? ''),
        targetType: (a.targetType as 'combo' | 'model') || 'combo',
        enabled: a.enabled !== false,
        priority: Number(a.priority ?? 0),
        description: a.description ? String(a.description) : undefined,
        createdAt: (a.createdAt as string) || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        stats: undefined,
      })),
      overwrite,
    );
  }

  /** Export */
  exportAliases(): AliasConfig[] {
    return this.repository.exportAliases();
  }

  /** Get stats summary */
  getStats(): { total: number; enabled: number; disabled: number; totalRequests: number } {
    const all = this.repository.getAll();
    return {
      total: all.length,
      enabled: all.filter(a => a.enabled).length,
      disabled: all.filter(a => !a.enabled).length,
      totalRequests: all.reduce((sum, a) => sum + (a.stats?.totalRequests || 0), 0),
    };
  }
}

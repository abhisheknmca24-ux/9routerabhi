import fs from 'node:fs';
import path from 'node:path';
import { type Logger } from '../../types/logger.types.js';
import { type RoutingPolicy, type RouteChain, type RouteChainLink, type RouteResolution } from '../../types/routing.types.js';
import { type ProvidersFile } from '../../types/provider.types.js';
import { RoutingPolicySchema } from '../../config/schemas/routing.schema.js';
import { ProvidersFileSchema } from '../../config/schemas/provider.schema.js';
import { ConfigValidationError } from '../../config/config-loader.js';

export class RoutingService {
  private routingPolicy: RoutingPolicy;
  private providers: ProvidersFile;
  private readonly routingPath: string;
  private readonly providersPath: string;
  private reloading = false;

  constructor(
    private readonly configDir: string,
    private readonly logger: Logger,
  ) {
    this.routingPath = path.join(configDir, 'routing', 'routing-policy.json');
    this.providersPath = path.join(configDir, 'providers', 'providers.json');
    this.routingPolicy = { strategy: 'priority-failover', tiers: [], defaultTier: 'primary', failoverTimeout: 5000, maxFailoverAttempts: 3, circuitBreaker: { enabled: false, failureThreshold: 0, resetTimeout: 0, halfOpenMaxRequests: 0 }, stickySession: false, loadBalancing: { enabled: false, algorithm: 'round-robin' } };
    this.providers = { providers: [], defaultProvider: '', fallbackProvider: '', providerOrder: [] };
    this._loadConfig();
  }

  getStatus(): {
    strategy: string;
    tiers: Array<{ name: string; providers: string[] }>;
    defaultTier: string;
    providerCount: number;
    enabledCount: number;
    providerOrder: string[];
  } {
    return {
      strategy: this.routingPolicy.strategy,
      tiers: this.routingPolicy.tiers.map(t => ({ name: t.name, providers: t.providers })),
      defaultTier: this.routingPolicy.defaultTier,
      providerCount: this.providers.providers.length,
      enabledCount: this.providers.providers.filter(p => p.enabled).length,
      providerOrder: this.providers.providerOrder,
    };
  }

  resolveModel(model: string): RouteResolution | null {
    const providerId = model.split('/')[0];
    const provider = this.providers.providers.find(p => p.id === providerId);

    if (!provider) return null;
    if (!provider.enabled) return null;

    const tier = this.routingPolicy.tiers.find(t => t.providers.includes(providerId));
    return {
      model,
      provider: provider.id,
      tier: tier ? tier.name : this.routingPolicy.defaultTier,
      endpoint: provider.auth?.endpoint,
      priority: provider.priority,
      models: provider.models,
    };
  }

  getChain(model: string): RouteChain | null {
    const providerId = model.split('/')[0];

    const chain: RouteChainLink[] = [];
    let found = false;

    for (const tier of this.routingPolicy.tiers) {
      for (const pid of tier.providers) {
        const p = this.providers.providers.find(pr => pr.id === pid && pr.enabled);
        if (p) {
          chain.push({ provider: p.id, tier: tier.name, endpoint: p.auth?.endpoint, priority: p.priority });
          if (pid === providerId) found = true;
        }
      }
    }

    if (!found) return null;
    return { model, chain, chainLength: chain.length, strategy: this.routingPolicy.strategy };
  }

  getProviders(): Array<{ id: string; name: string; enabled: boolean; type: string; models: string[]; priority: number }> {
    return this.providers.providers.map(p => ({ id: p.id, name: p.name, enabled: p.enabled, type: p.type, models: p.models, priority: p.priority }));
  }

  reload(): boolean {
    if (this.reloading) {
      this.logger.warn('Reload already in progress, skipping');
      return false;
    }
    this.reloading = true;
    try {
      this._loadConfig();
      this.logger.info('Configuration reloaded');
      return true;
    } catch (err) {
      this.logger.error('Failed to reload configuration', { error: (err as Error).message });
      return false;
    } finally {
      this.reloading = false;
    }
  }

  private _loadConfig(): void {
    if (fs.existsSync(this.routingPath)) {
      const raw = JSON.parse(fs.readFileSync(this.routingPath, 'utf-8'));
      const result = RoutingPolicySchema.safeParse(raw);
      if (result.success) {
        this.routingPolicy = result.data as RoutingPolicy;
      } else {
        throw new ConfigValidationError(this.routingPath, 'Invalid routing policy', result.error.issues.map((e: { path: (string | number)[]; message: string }) => `${e.path.join('.')}: ${e.message}`));
      }
    }
    if (fs.existsSync(this.providersPath)) {
      const raw = JSON.parse(fs.readFileSync(this.providersPath, 'utf-8'));
      const result = ProvidersFileSchema.safeParse(raw);
      if (result.success) {
        this.providers = result.data as ProvidersFile;
      } else {
        throw new ConfigValidationError(this.providersPath, 'Invalid providers config', result.error.issues.map((e: { path: (string | number)[]; message: string }) => `${e.path.join('.')}: ${e.message}`));
      }
    }
  }
}

/**
 * VirtualModelService — exposes virtual Anthropic-compatible model names
 * that map to internal combo profiles via the alias system.
 *
 * When Claude Desktop calls GET /v1/models, it expects to see familiar
 * model names like "claude-sonnet-4-5" and "claude-opus-4". This service
 * returns exactly those — never exposing internal provider names.
 *
 * The mapping is driven entirely by the alias database. Every enabled alias
 * that points to a combo profile becomes a virtual model.
 */

import { type Logger } from '../types/logger.types.js';
import { type AliasConfig } from '../types/alias.types.js';
import { AliasRepository } from '../repositories/alias-repository.js';
import { ProviderHealthTracker } from './provider-health-tracker.js';

export interface VirtualModel {
  /** The virtual model name exposed to clients */
  id: string;
  /** Human-readable name */
  name: string;
  /** The internal combo/profile it maps to */
  mappedCombo: string;
  /** The alias config backing this model */
  alias: AliasConfig;
  /** Provider health info if available */
  providerHealth?: {
    providers: string[];
    scores: Array<{ id: string; score: number; status: string; latency: number }>;
    averageLatency: number;
    averageScore: number;
    totalRequests: number;
  };
  /** Usage statistics */
  stats?: {
    requests: number;
    successful: number;
    failed: number;
    lastUsed: string | null;
  };
}

export interface ModelListResponse {
  object: 'list';
  data: VirtualModel[];
}

/** Known combo profiles with their provider chains */
const COMBO_PROVIDERS: Record<string, string[]> = {
  Coding: ['openrouter', 'nvidia'],
  Reasoning: ['openrouter'],
  Chat: ['openrouter', 'nvidia', 'cloudflare'],
  Balanced: ['openrouter', 'nvidia'],
  Vision: ['openrouter'],
  Research: ['openrouter'],
  Fast: ['nvidia', 'cloudflare'],
  Long_Context: ['openrouter'],
  Planning: ['openrouter', 'nvidia'],
};

export class VirtualModelService {
  private lastModelList: VirtualModel[] = [];
  private lastGeneratedAt = 0;
  private static readonly CACHE_TTL_MS = 10_000; // 10s cache

  constructor(
    private readonly aliasRepo: AliasRepository,
    private readonly healthTracker?: ProviderHealthTracker,
    private readonly logger?: Logger,
  ) {}

  /**
   * Get all virtual models — built from enabled aliases that target combo profiles.
   * Results are cached for 10 seconds.
   */
  getModels(clientType?: string): VirtualModel[] {
    const now = Date.now();
    if (this.lastModelList.length > 0 && (now - this.lastGeneratedAt) < VirtualModelService.CACHE_TTL_MS) {
      return this.lastModelList;
    }

    const aliases = this.aliasRepo.getAll();
    const enabledCombos = aliases.filter(a => a.enabled && a.targetType === 'combo');
    const enabledModels = aliases.filter(a => a.enabled && a.targetType === 'model');

    const models: VirtualModel[] = [];

    // 1. Build combo-driven virtual models
    for (const alias of enabledCombos) {
      const comboProviders = COMBO_PROVIDERS[alias.target] || [];
      const scores = comboProviders
        .map(id => {
          if (!this.healthTracker) return null;
          const score = this.healthTracker.getScore(id);
          return {
            id: score.providerId,
            score: score.healthScore,
            status: score.status,
            latency: score.avgLatencyMs,
          };
        })
        .filter(Boolean) as Array<{ id: string; score: number; status: string; latency: number }>;

      const avgLatency = scores.length > 0
        ? scores.reduce((s, p) => s + p.latency, 0) / scores.length
        : 0;
      const avgScore = scores.length > 0
        ? scores.reduce((s, p) => s + p.score, 0) / scores.length
        : 0;

      models.push({
        id: alias.name,
        name: alias.description || alias.name,
        mappedCombo: alias.target,
        alias,
        providerHealth: {
          providers: comboProviders,
          scores,
          averageLatency: Math.round(avgLatency),
          averageScore: Math.round(avgScore * 100) / 100,
          totalRequests: alias.stats?.totalRequests || 0,
        },
        stats: alias.stats ? {
          requests: alias.stats.totalRequests,
          successful: alias.stats.successfulRequests,
          failed: alias.stats.failedRequests,
          lastUsed: alias.stats.lastUsed,
        } : undefined,
      });
    }

    // 2. Add direct model aliases (non-combo)
    for (const alias of enabledModels) {
      models.push({
        id: alias.name,
        name: alias.description || alias.name,
        mappedCombo: alias.target,
        alias,
        stats: alias.stats ? {
          requests: alias.stats.totalRequests,
          successful: alias.stats.successfulRequests,
          failed: alias.stats.failedRequests,
          lastUsed: alias.stats.lastUsed,
        } : undefined,
      });
    }

    // 3. If no aliases exist yet, provide sensible defaults
    if (models.length === 0) {
      const defaultModels = this._getDefaultModels();
      // Create them as aliases so they persist
      for (const m of defaultModels) {
        try {
          if (!this.aliasRepo.exists(m.id)) {
            this.aliasRepo.create({
              name: m.id,
              target: m.combo,
              targetType: 'combo',
              enabled: true,
              priority: 0,
              description: `${m.id} → ${m.combo}`,
            });
            this.logger?.info(`Auto-created default alias: ${m.id} → ${m.combo}`);
          }
        } catch {}
      }
      // Reload and retry
      return this.getModels(clientType);
    }

    this.lastModelList = models;
    this.lastGeneratedAt = now;
    return models;
  }

  /**
   * Format models in the Anthropic GET /v1/models format.
   */
  getAnthropicModelList(clientType?: string): ModelListResponse {
    const models = this.getModels(clientType);
    return {
      object: 'list',
      data: models,
    };
  }

  /**
   * Format models in the OpenAI GET /v1/models format.
   */
  getOpenAIModelList(clientType?: string): { object: string; data: Array<{ id: string; object: string; created: number; owned_by: string }> } {
    const models = this.getModels(clientType);
    const now = Math.floor(Date.now() / 1000);
    return {
      object: 'list',
      data: models.map(m => ({
        id: m.id,
        object: 'model',
        created: now,
        owned_by: 'gateway',
      })),
    };
  }

  /**
   * Check if a model name is a known virtual model.
   */
  isVirtualModel(modelName: string): boolean {
    return this.getModels().some(m => m.id === modelName);
  }

  /**
   * Get detailed info about a virtual model.
   */
  getModel(modelName: string): VirtualModel | undefined {
    return this.getModels().find(m => m.id === modelName);
  }

  /**
   * Clear the cache (forces rebuild on next call).
   */
  clearCache(): void {
    this.lastGeneratedAt = 0;
    this.lastModelList = [];
  }

  /**
   * Default virtual models — created when no aliases exist yet.
   */
  private _getDefaultModels(): Array<{ id: string; combo: string }> {
    return [
      { id: 'claude-sonnet-4-5', combo: 'Coding' },
      { id: 'claude-sonnet-4', combo: 'Balanced' },
      { id: 'claude-opus-4', combo: 'Research' },
      { id: 'claude-opus-4-5', combo: 'Reasoning' },
      { id: 'claude-haiku-4', combo: 'Fast' },
      { id: 'claude-haiku-4-5', combo: 'Chat' },
      { id: 'gpt-4.1', combo: 'Balanced' },
      { id: 'gpt-4o', combo: 'Coding' },
      { id: 'gpt-4o-mini', combo: 'Fast' },
      { id: 'gemini-2.5-pro', combo: 'Research' },
      { id: 'gemini-2.5-flash', combo: 'Fast' },
      { id: 'deepseek-v3', combo: 'Reasoning' },
      { id: 'deepseek-r1', combo: 'Research' },
      { id: 'llama-4', combo: 'Balanced' },
      { id: 'mistral-large', combo: 'Reasoning' },
    ];
  }
}

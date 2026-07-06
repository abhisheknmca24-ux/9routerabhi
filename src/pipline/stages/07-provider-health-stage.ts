import type { PipelineContext, PipelineStage } from '../pipeline.types.js';
import type { ProviderHealthTracker } from '../../services/provider-health-tracker.js';

/** Stage 7: Check provider health before routing */
export class ProviderHealthStage implements PipelineStage {
  readonly name = 'provider-health';

  constructor(
    private readonly healthTracker: ProviderHealthTracker,
    private readonly healthyThreshold = 0.3,
  ) {}

  async execute(ctx: PipelineContext): Promise<void> {
    if (!ctx.comboSelection) return;

    const allProviders = ctx.comboSelection.providers;
    const unhealthy: string[] = [];

    for (const providerId of allProviders) {
      const score = this.healthTracker.getScore(providerId);
      ctx.metadata[`health:${providerId}`] = {
        score: score.healthScore,
        status: score.status,
        latency: score.avgLatencyMs,
      };

      if (score.status === 'auth_disabled' || score.healthScore < this.healthyThreshold) {
        unhealthy.push(providerId);
      }
    }

    // Filter out unhealthy providers from the selection
    const healthy = allProviders.filter(p => !unhealthy.includes(p));

    if (healthy.length === 0) {
      ctx.error = {
        code: 'NO_HEALTHY_PROVIDERS',
        message: 'All providers are unhealthy or disabled',
        stage: this.name,
        retryable: true,
        statusCode: 503,
      };
      return;
    }

    ctx.comboSelection.providers = healthy;
    ctx.providerHealthSnapshot = Object.fromEntries(
      allProviders.map(p => [p, ctx.metadata[`health:${p}`]]),
    );
  }
}

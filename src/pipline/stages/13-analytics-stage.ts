import type { PipelineContext, PipelineStage } from '../pipeline.types.js';
import type { MonitoringService } from '../../services/monitoring.service.js';
import type { ProviderHealthTracker } from '../../services/provider-health-tracker.js';

/** Stage 13: Record analytics and telemetry */
export class AnalyticsStage implements PipelineStage {
  readonly name = 'analytics';

  constructor(
    private readonly monitoring?: MonitoringService,
    private readonly healthTracker?: ProviderHealthTracker,
  ) {}

  async execute(ctx: PipelineContext): Promise<void> {
    if (!ctx.sharedRequest) return;

    const latencyMs = ctx.timeline.reduce((sum, t) => sum + t.durationMs, 0);
    const providerId = ctx.comboSelection?.providers?.[0] || 'unknown';
    const pipelineError = ctx.error;
    const success = !pipelineError;

    // Record in health tracker
    if (this.healthTracker) {
      if (success) {
        this.healthTracker.recordSuccess(providerId, latencyMs);
      } else {
        this.healthTracker.recordFailure(providerId, pipelineError.statusCode);
      }
    }

    // Record in monitoring service
    if (this.monitoring && ctx.clientInfo) {
      this.monitoring.report({
        providerId,
        status: success ? 'success' : 'failure',
        latencyMs,
        statusCode: ctx.error?.statusCode ?? 200,
        tokens: ctx.responseData?.usage?.outputTokens,
      });
    }

    ctx.metadata['analytics'] = {
      providerId,
      latencyMs,
      success,
      stageCount: ctx.timeline.length,
      timeline: ctx.timeline.map(t => ({ stage: t.stage, ms: t.durationMs })),
    };
  }
}

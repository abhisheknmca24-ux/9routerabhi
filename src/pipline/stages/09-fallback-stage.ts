import type { PipelineContext, PipelineStage } from '../pipeline.types.js';

/** Stage 9: Configure fallback logic when primary providers fail */
export class FallbackStage implements PipelineStage {
  readonly name = 'fallback-config';

  async execute(ctx: PipelineContext): Promise<void> {
    if (!ctx.comboSelection) return;

    const fallbackChain = ctx.comboSelection.fallbackChain;

    ctx.metadata['fallback'] = {
      enabled: fallbackChain.length > 0,
      chain: fallbackChain,
      strategy: 'chain',
    };
  }
}

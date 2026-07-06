import type { PipelineContext, PipelineStage, ComboSelection } from '../pipeline.types.js';

/**
 * Stage 6: Select the combo/profile for the resolved model.
 * Works with the existing combo system — does not modify it.
 */
export class ComboSelectionStage implements PipelineStage {
  readonly name = 'combo-selection';

  constructor(
    private readonly combos: Record<string, { providers: string[]; fallback: string[] }>,
  ) {}

  async execute(ctx: PipelineContext): Promise<void> {
    const model = ctx.resolvedModel || ctx.sharedRequest?.model || '';

    // Check if it's a known combo profile
    const combo = this.combos[model];
    if (combo) {
      ctx.comboSelection = {
        name: model,
        providers: combo.providers,
        fallbackChain: combo.fallback,
      };
      ctx.metadata['combo'] = ctx.comboSelection;
      return;
    }

    // Default: single-model routing
    const providerId = model.split('/')[0];
    ctx.comboSelection = {
      name: model,
      providers: [providerId],
      fallbackChain: [],
    };
  }
}

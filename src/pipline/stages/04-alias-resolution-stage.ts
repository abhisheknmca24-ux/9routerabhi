import type { PipelineContext, PipelineStage } from '../pipeline.types.js';
import type { AliasResolverEngine } from '../../services/alias-resolver-engine.js';

/** Stage 4: Resolve aliases — map friendly names to real models/combos */
export class AliasResolutionStage implements PipelineStage {
  readonly name = 'alias-resolution';

  constructor(private readonly aliasEngine: AliasResolverEngine) {}

  async execute(ctx: PipelineContext): Promise<void> {
    if (!ctx.sharedRequest) return;

    const model = ctx.sharedRequest.model;
    const resolved = this.aliasEngine.resolve(model);

    if (resolved) {
      ctx.isAliased = true;
      ctx.resolvedAlias = { name: model, target: resolved.target, targetType: resolved.targetType };
      ctx.resolvedModel = resolved.target;
      ctx.sharedRequest.resolvedModel = resolved.target;
    } else {
      ctx.isAliased = false;
      ctx.resolvedModel = model;
    }
  }
}

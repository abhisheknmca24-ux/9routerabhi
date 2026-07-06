import type { PipelineContext, PipelineStage } from '../pipeline.types.js';
import type { AliasResolverEngine } from '../../services/alias-resolver-engine.js';
import type { ModelAliasManager } from '../../model-alias/model-alias-manager.js';

/**
 * Stage 4: Resolve aliases — map friendly names to real models/combos.
 *
 * Supports both SQLite-backed (AliasResolverEngine) and file-based
 * (ModelAliasManager) alias sources. File-based aliases are checked
 * first (for Anthropic compat), falling back to SQLite.
 */
export class AliasResolutionStage implements PipelineStage {
  readonly name = 'alias-resolution';

  constructor(
    private readonly aliasEngine: AliasResolverEngine,
    private readonly fileAliases?: ModelAliasManager,
  ) {}

  async execute(ctx: PipelineContext): Promise<void> {
    if (!ctx.sharedRequest) return;

    const model = ctx.sharedRequest.model;

    // 1. Try file-based aliases first (claude-sonnet-4-5 → Coding)
    if (this.fileAliases) {
      const fileResult = this.fileAliases.resolve(model);
      if (fileResult) {
        ctx.isAliased = true;
        ctx.resolvedAlias = { name: model, target: fileResult, targetType: 'combo' };
        ctx.resolvedModel = fileResult;
        ctx.sharedRequest.resolvedModel = fileResult;
        return;
      }
    }

    // 2. Fall back to SQLite-based aliases
    const resolved = this.aliasEngine.resolve(model);
    if (resolved) {
      ctx.isAliased = true;
      ctx.resolvedAlias = { name: model, target: resolved.target, targetType: resolved.targetType as 'combo' | 'model' };
      ctx.resolvedModel = resolved.target;
      ctx.sharedRequest.resolvedModel = resolved.target;
    } else {
      ctx.isAliased = false;
      ctx.resolvedModel = model;
    }
  }
}

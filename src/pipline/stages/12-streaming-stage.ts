import type { PipelineContext, PipelineStage } from '../pipeline.types.js';

/**
 * Stage 12: Streaming handler — ensures SSE headers and flushes.
 * Only acts on streaming requests. Non-streaming passes through.
 */
export class StreamingStage implements PipelineStage {
  readonly name = 'streaming';

  async execute(ctx: PipelineContext): Promise<void> {
    if (!ctx.stream) return;

    // Headers already set by formatter. Ensure flush.
    if (typeof ctx.res.write === 'function') {
      ctx.res.flushHeaders?.();
    }
  }
}

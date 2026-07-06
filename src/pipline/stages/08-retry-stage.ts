import type { PipelineContext, PipelineStage } from '../pipeline.types.js';

/** Stage 8: Configure retry logic for provider execution */
export class RetryStage implements PipelineStage {
  readonly name = 'retry-config';

  constructor(
    private readonly maxRetries = 3,
    private readonly baseDelayMs = 1000,
  ) {}

  async execute(ctx: PipelineContext): Promise<void> {
    ctx.metadata['retry'] = {
      maxRetries: this.maxRetries,
      baseDelayMs: this.baseDelayMs,
      strategy: 'exponential-backoff',
    };
  }
}

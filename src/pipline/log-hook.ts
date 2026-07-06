import type { PipelineHook } from './pipeline.types.js';
import type { Logger } from '../types/logger.types.js';

/**
 * Logging hook — logs every stage execution with timing.
 * Attaches to the pipeline and logs before/after each stage.
 */
export function createLoggingHook(logger: Logger): PipelineHook {
  return {
    name: 'logging',
    before: (ctx) => {
      logger.debug(`Stage starting`, { requestId: ctx.requestId });
    },
    after: (ctx) => {
      const lastStage = ctx.timeline[ctx.timeline.length - 1];
      if (lastStage) {
        logger.info(`[${lastStage.stage}] ${lastStage.durationMs}ms`, {
          requestId: ctx.requestId,
          durationMs: lastStage.durationMs,
          stage: lastStage.stage,
        });
      }
    },
  };
}

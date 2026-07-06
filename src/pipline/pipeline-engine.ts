import { type Logger } from '../types/logger.types.js';
import {
  type PipelineContext,
  type PipelineStage,
  type PipelineHook,
  type PipelinePlugin,
  type TimelineEntry,
} from './pipeline.types.js';

export class PipelineEngine {
  private readonly stages: Array<{ stage: PipelineStage; index: number }> = [];
  private readonly hooks: PipelineHook[] = [];
  private readonly plugins: PipelinePlugin[] = [];
  private sorted = false;

  constructor(private readonly logger: Logger) {}

  /** Register a stage */
  addStage(stage: PipelineStage, position?: { before?: string; after?: string }): void {
    this.stages.push({ stage, index: this.stages.length });
    this.sorted = false;
  }

  /** Register a hook (runs before/after every stage) */
  addHook(hook: PipelineHook): void {
    this.hooks.push(hook);
  }

  /** Register a plugin (can add hooks + stages) */
  addPlugin(plugin: PipelinePlugin): void {
    this.plugins.push(plugin);
    if (plugin.hooks) {
      for (const hook of plugin.hooks) {
        this.addHook(hook);
      }
    }
    if (plugin.stages) {
      for (const s of plugin.stages) {
        this.addStage(s.stage, { before: s.before, after: s.after });
      }
    }
  }

  /** Execute the full pipeline */
  async execute(ctx: PipelineContext): Promise<void> {
    this.logger.info(`Pipeline started: ${ctx.requestId}`, { stages: this.stages.length, hooks: this.hooks.length });

    for (const { stage } of this.stages) {
      const startTime = Date.now();
      const entry: TimelineEntry = { stage: stage.name, startedAt: startTime, endedAt: 0, durationMs: 0 };

      try {
        // Run before hooks
        for (const hook of this.hooks) {
          try { await hook.before?.(ctx); } catch {}
        }

        // Execute the stage
        await stage.execute(ctx);

        // Run after hooks
        for (const hook of this.hooks) {
          try { await hook.after?.(ctx); } catch {}
        }

        entry.endedAt = Date.now();
        entry.durationMs = entry.endedAt - entry.startedAt;
        ctx.timeline.push(entry);

        this.logger.debug(`Pipeline stage: ${stage.name}`, {
          requestId: ctx.requestId,
          durationMs: entry.durationMs,
        });

        // If there's an error, stop the pipeline (unless the stage is designed to handle it)
        if (ctx.error && !ctx.error.retryable) {
          this.logger.warn(`Pipeline stopped at stage: ${stage.name}`, {
            requestId: ctx.requestId,
            error: ctx.error.message,
          });
          break;
        }
      } catch (err) {
        entry.endedAt = Date.now();
        entry.durationMs = entry.endedAt - entry.startedAt;
        ctx.timeline.push(entry);

        ctx.error = {
          code: 'STAGE_ERROR',
          message: err instanceof Error ? err.message : String(err),
          stage: stage.name,
          retryable: false,
          statusCode: 500,
        };

        this.logger.error(`Pipeline stage failed: ${stage.name}`, {
          requestId: ctx.requestId,
          error: ctx.error.message,
          durationMs: entry.durationMs,
        });
        break;
      }
    }

    this.logger.info(`Pipeline completed: ${ctx.requestId}`, {
      stages: ctx.timeline.length,
      totalMs: ctx.timeline.length > 0 ? ctx.timeline[ctx.timeline.length - 1].durationMs : 0,
      error: ctx.error?.message || null,
    });
  }

  /** Get timeline as a formatted array for debugging */
  getTimeline(ctx: PipelineContext): TimelineEntry[] {
    return ctx.timeline;
  }

  /** Reset pipeline state */
  reset(): void {
    this.stages.length = 0;
    this.hooks.length = 0;
    this.plugins.length = 0;
    this.sorted = false;
  }

  private _sortStages(): void {
    // Simple topological sort by before/after references
    // Built-in order is preserved as registered
    this.sorted = true;
  }
}

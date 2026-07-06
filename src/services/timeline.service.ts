import { type Logger } from '../types/logger.types.js';
import { type PipelineContext } from '../pipline/pipeline.types.js';
import { type TimelineRecord, type TimelineFilter, type TimelineListResult, type TimelineStats } from '../types/timeline.types.js';
import { TimelineRepository } from '../repositories/timeline-repository.js';

export class TimelineService {
  constructor(
    private readonly repository: TimelineRepository,
    private readonly logger: Logger,
  ) {}

  /**
   * Capture a completed pipeline execution as a timeline record.
   * Call this after the pipeline finishes (in the analytics stage or response handler).
   */
  capture(ctx: PipelineContext): void {
    try {
      const clientInfo = ctx.clientInfo;
      const sharedReq = ctx.sharedRequest;
      if (!clientInfo || !sharedReq) return;

      const stages = ctx.timeline;
      const totalLatency = stages.reduce((sum, s) => sum + s.durationMs, 0);
      const comboSelection = ctx.comboSelection;

      // Extract provider chain
      const providerChain = comboSelection?.providers || [];
      const failedProviders: string[] = [];

      // Check retry metadata
      const retryMeta = ctx.metadata['retry'] as Record<string, unknown> | undefined;
      const fallbackMeta = ctx.metadata['fallback'] as Record<string, unknown> | undefined;

      // Build prompt preview
      const messages = sharedReq.messages || [];
      const preview = messages
        .map(m => typeof m.content === 'string' ? m.content.slice(0, 100) : '')
        .filter(Boolean)
        .join(' ')
        .slice(0, 200);

      const record: TimelineRecord = {
        requestId: ctx.requestId,
        timestamp: new Date().toISOString(),
        client: clientInfo.type,
        protocol: clientInfo.protocol,
        model: sharedReq.model,
        resolvedModel: ctx.resolvedModel,
        aliased: ctx.isAliased || false,
        aliasName: ctx.resolvedAlias?.name,
        combo: comboSelection?.name,
        providers: providerChain.join(', '),
        finalProvider: providerChain[0],
        latencyMs: totalLatency,
        success: !ctx.error,
        streamed: ctx.stream || false,
        retries: ((retryMeta?.maxRetries as number) || 0) - (retryMeta?.remainingRetries as number || 0),
        fallbacks: comboSelection?.fallbackChain?.length || 0,
        statusCode: ctx.error?.statusCode || 200,
        error: ctx.error?.message,
        tokens: ctx.responseData?.usage?.totalTokens || ctx.metadata['tokens'] as number || 0,
        cost: ctx.metadata['cost'] as number || 0,
        stageTimeline: JSON.stringify(stages.map(s => ({
          stage: s.stage,
          durationMs: s.durationMs,
          data: s.data,
        }))),
        promptPreview: preview,
        responseLength: ctx.responseData?.content?.length || 0,
      };

      this.repository.insert(record);
      this.logger.debug(`Timeline captured: ${ctx.requestId}`, {
        model: sharedReq.model,
        latencyMs: totalLatency,
        success: !ctx.error,
      });
    } catch (err) {
      this.logger.error(`Failed to capture timeline: ${(err as Error).message}`);
    }
  }

  /** List timeline records */
  list(filter: TimelineFilter): TimelineListResult {
    return this.repository.list(filter);
  }

  /** Get a single record */
  get(requestId: string): TimelineRecord | undefined {
    return this.repository.getByRequestId(requestId);
  }

  /** Get stats */
  getStats(filter?: { startDate?: string; endDate?: string }): TimelineStats {
    return this.repository.getStats(filter);
  }

  /** Export records as JSON */
  exportJSON(filter?: TimelineFilter): TimelineRecord[] {
    const result = this.repository.list(filter || { limit: 5000 });
    return result.records;
  }

  /** Export records as CSV string */
  exportCSV(filter?: TimelineFilter): string {
    const result = this.repository.list(filter || { limit: 5000 });
    const records = result.records;

    const headers = ['requestId', 'timestamp', 'client', 'protocol', 'model', 'resolvedModel',
      'aliased', 'aliasName', 'combo', 'providers', 'finalProvider', 'latencyMs', 'success',
      'streamed', 'retries', 'fallbacks', 'statusCode', 'error', 'tokens', 'cost', 'responseLength'];

    const rows = records.map(r => [
      r.requestId, r.timestamp, r.client, r.protocol, r.model, r.resolvedModel || '',
      r.aliased ? 'true' : 'false', r.aliasName || '', r.combo || '', r.providers,
      r.finalProvider || '', r.latencyMs, r.success ? 'true' : 'false',
      r.streamed ? 'true' : 'false', r.retries, r.fallbacks, r.statusCode ?? '',
      r.error || '', r.tokens ?? 0, r.cost ?? 0, r.responseLength ?? 0,
    ]);

    return [
      headers.join(','),
      ...rows.map(row => row.map(v => {
        const s = String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      }).join(',')),
    ].join('\n');
  }

  /** Prune old records */
  prune(days: number): number {
    return this.repository.prune(days);
  }
}

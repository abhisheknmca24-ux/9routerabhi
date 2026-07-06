import type { PipelineContext, PipelineStage } from '../pipeline.types.js';
import type { SharedResponse } from '../../types/api.types.js';
import type { HttpAgent } from '../../performance/http-agent.js';
import { ProviderHealthTracker } from '../../services/provider-health-tracker.js';
import { StreamingFailoverHandler } from '../../services/streaming-failover.js';

/**
 * Stage 10: Execute the request against the provider chain.
 *
 * Non-streaming: Simple single-provider execution.
 * Streaming: Uses StreamingFailoverHandler to transparently handle
 * provider failures mid-stream — the client sees a seamless stream.
 */
export class ProviderExecutionStage implements PipelineStage {
  readonly name = 'provider-execution';
  private readonly failoverHandler: StreamingFailoverHandler;

  constructor(
    private readonly httpAgent: HttpAgent,
    private readonly gatewayUrl: string,
    private readonly healthTracker: ProviderHealthTracker,
  ) {
    this.failoverHandler = new StreamingFailoverHandler(
      httpAgent,
      healthTracker,
      gatewayUrl,
      healthTracker['logger'] as any,
    );
  }

  async execute(ctx: PipelineContext): Promise<void> {
    if (!ctx.sharedRequest) return;
    if (ctx.error) return;

    const request = ctx.sharedRequest;
    const model = ctx.resolvedModel || request.model;
    const messages = request.messages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));

    const bodyFn = (providerId: string) => ({
      model,
      messages,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      stream: ctx.stream,
      provider: providerId,
    });

    // Build provider chain from combo selection
    const providerChain = ctx.comboSelection?.providers?.length
      ? ctx.comboSelection.providers.map(id => ({ id }))
      : [{ id: model.split('/')[0] || model }];

    if (ctx.stream) {
      await this._executeStream(ctx, bodyFn, providerChain);
    } else {
      await this._executeSingle(ctx, bodyFn, providerChain);
    }
  }

  private async _executeSingle(
    ctx: PipelineContext,
    bodyFn: (providerId: string) => Record<string, unknown>,
    providerChain: Array<{ id: string }>,
  ): Promise<void> {
    let lastError: Error | null = null;

    for (const provider of providerChain) {
      try {
        const body = bodyFn(provider.id);
        body.stream = false;

        const response = await this.httpAgent.post(
          `${this.gatewayUrl}/v1/chat/completions`,
          body,
          { timeout: 60000 },
        );

        if (response.status >= 400) {
          this.healthTracker.recordFailure(provider.id, response.status);
          lastError = new Error(`Provider ${provider.id} returned ${response.status}`);

          // Check if this failure should skip or disable
          if (response.status === 401 || response.status === 403) {
            // Auth failure — stop trying
            ctx.error = {
              code: 'AUTH_FAILURE',
              message: lastError.message,
              stage: this.name,
              retryable: false,
              statusCode: response.status,
            };
            return;
          }
          continue; // Try next provider
        }

        // Success
        this.healthTracker.recordSuccess(provider.id, 0);
        const choice = (response.data as any)?.choices?.[0]?.message;
        ctx.responseData = {
          content: choice?.content || '',
          finishReason: (response.data as any)?.choices?.[0]?.finish_reason || 'stop',
          model: (body.model as string),
        };
        ctx.metadata['finalProvider'] = provider.id;
        return;

      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.healthTracker.recordFailure(provider.id, (err as any).code || 'UNKNOWN');
        continue;
      }
    }

    // All providers failed
    ctx.error = {
      code: 'ALL_PROVIDERS_FAILED',
      message: lastError?.message || 'All providers failed',
      stage: this.name,
      retryable: false,
      statusCode: 503,
    };
  }

  private async _executeStream(
    ctx: PipelineContext,
    bodyFn: (providerId: string) => Record<string, unknown>,
    providerChain: Array<{ id: string }>,
  ): Promise<void> {
    ctx.streamChunks = [];
    const model = ctx.resolvedModel || ctx.sharedRequest?.model || '';

    return new Promise<void>((resolve) => {
      this.failoverHandler.execute(
        model,
        providerChain.map(p => ({ id: p.id })),
        (providerId) => bodyFn(providerId),
        // onChunk: each text delta from any provider
        (delta) => {
          ctx.streamChunks!.push({ type: 'text_delta', delta });
        },
        // onDone: stream completed
        (content) => {
          ctx.responseData = { content, model };
          ctx.metadata['streamFailover'] = true;
          resolve();
        },
        // onError: all providers failed
        (error) => {
          // We still have partial content — use it
          const partialContent = ctx.streamChunks!
            .filter(c => c.type === 'text_delta')
            .map(c => c.delta)
            .join('');

          if (partialContent) {
            ctx.responseData = { content: partialContent, model };
            ctx.metadata['streamFailover'] = true;
            ctx.metadata['streamPartial'] = true;
          }

          ctx.error = {
            code: 'STREAM_FAILOVER_EXHAUSTED',
            message: error.message,
            stage: this.name,
            retryable: false,
            statusCode: 502,
          };
          resolve();
        },
      );
    });
  }
}

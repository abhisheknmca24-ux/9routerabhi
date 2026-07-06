import type { PipelineContext, PipelineStage } from '../pipeline.types.js';
import type { SharedResponse, SharedResponseChunk, StreamCallbacks } from '../../types/api.types.js';
import type { HttpAgent } from '../../performance/http-agent.js';

/**
 * Stage 10: Execute the request against the selected provider.
 * This uses the existing HttpAgent and provider infrastructure.
 */
export class ProviderExecutionStage implements PipelineStage {
  readonly name = 'provider-execution';

  constructor(
    private readonly httpAgent: HttpAgent,
    private readonly gatewayUrl: string,
  ) {}

  async execute(ctx: PipelineContext): Promise<void> {
    if (!ctx.sharedRequest) return;
    if (ctx.error) return;

    const model = ctx.resolvedModel || ctx.sharedRequest.model;
    const messages = ctx.sharedRequest.messages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));

    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: ctx.sharedRequest.maxTokens,
      temperature: ctx.sharedRequest.temperature,
      stream: ctx.stream,
    };

    if (ctx.stream) {
      await this._executeStream(ctx, body);
    } else {
      await this._executeSingle(ctx, body);
    }
  }

  private async _executeSingle(ctx: PipelineContext, body: Record<string, unknown>): Promise<void> {
    const response = await this.httpAgent.post(`${this.gatewayUrl}/v1/chat/completions`, body);

    const choice = (response.data as any)?.choices?.[0]?.message;
    ctx.responseData = {
      content: choice?.content || '',
      finishReason: (response.data as any)?.choices?.[0]?.finish_reason || 'stop',
      model: (body.model as string),
    };
  }

  private async _executeStream(ctx: PipelineContext, body: Record<string, unknown>): Promise<void> {
    body.stream = true;
    ctx.streamChunks = [];

    // Use existing streaming mechanism via HTTP Agent
    const response = await this.httpAgent.post(`${this.gatewayUrl}/v1/chat/completions`, body);

    if (response.raw) {
      const lines = response.raw.split('\n');
      let fullContent = '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') break;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            ctx.streamChunks.push({ type: 'text_delta', delta });
          }
        } catch {}
      }

      ctx.responseData = { content: fullContent, model: body.model as string };
    }
  }
}

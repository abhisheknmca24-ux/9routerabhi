import type { PipelineContext, PipelineStage } from '../pipeline.types.js';
import { ProtocolAdapter } from '../../compatibility/protocol-adapter.js';

/** Stage 11: Format the response back to the client's protocol */
export class ResponseFormatterStage implements PipelineStage {
  readonly name = 'response-formatter';
  private readonly adapter = new ProtocolAdapter();

  async execute(ctx: PipelineContext): Promise<void> {
    if (!ctx.responseData || !ctx.clientInfo) return;
    if (ctx.error) return;

    const protocol = ctx.clientInfo.protocol;

    if (ctx.stream) {
      ctx.res.setHeader('Content-Type', this.adapter.getContentType(protocol, true));
      ctx.res.setHeader('Cache-Control', 'no-cache');
      ctx.res.setHeader('Connection', 'keep-alive');
      ctx.res.setHeader('X-Request-Id', ctx.requestId);

      if (protocol === 'anthropic-messages') {
        const msgStart = {
          type: 'message_start',
          message: {
            id: `msg_${Date.now().toString(36)}`,
            type: 'message', role: 'assistant',
            content: [], model: ctx.resolvedModel || ctx.sharedRequest?.model,
            stop_reason: null, stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        };
        ctx.res.write(`event: message_start\ndata: ${JSON.stringify(msgStart)}\n\n`);
      }

      for (const chunk of ctx.streamChunks || []) {
        const formatted = this.adapter.formatStreamChunk(chunk, protocol);
        ctx.res.write(formatted);
      }

      ctx.res.write(this.adapter.formatStreamEnd(protocol));
      ctx.res.end();
    } else {
      const formatted = this.adapter.formatResponse(ctx.responseData, protocol);
      ctx.res.statusCode = 200;
      ctx.res.setHeader('Content-Type', this.adapter.getContentType(protocol, false));
      ctx.res.setHeader('X-Request-Id', ctx.requestId);
      ctx.res.end(JSON.stringify(formatted));
    }
  }
}

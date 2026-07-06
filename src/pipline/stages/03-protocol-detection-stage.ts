import type { PipelineContext, PipelineStage } from '../pipeline.types.js';
import { ProtocolAdapter } from '../../compatibility/protocol-adapter.js';

/** Stage 3: Detect the protocol and parse into SharedRequest */
export class ProtocolParsingStage implements PipelineStage {
  readonly name = 'protocol-parsing';
  private readonly adapter = new ProtocolAdapter();

  async execute(ctx: PipelineContext): Promise<void> {
    if (!ctx.clientInfo) {
      ctx.error = { code: 'NO_CLIENT', message: 'Client detection must run first', stage: this.name, retryable: false, statusCode: 500 };
      return;
    }

    const sharedReq = this.adapter.parseRequest(ctx.req, ctx.body, ctx.clientInfo);
    if (!sharedReq) {
      ctx.error = {
        code: 'UNSUPPORTED_PROTOCOL',
        message: `Unsupported protocol: ${ctx.clientInfo.protocol}`,
        stage: this.name,
        retryable: false,
        statusCode: 400,
      };
      return;
    }

    ctx.sharedRequest = sharedReq;
    ctx.stream = sharedReq.stream;
  }
}

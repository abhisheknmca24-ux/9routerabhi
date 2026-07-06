import type { PipelineContext, PipelineStage } from '../pipeline.types.js';
import { buildClientInfo } from '../../compatibility/client-detector.js';

/** Stage 2: Detect the client type from headers and User-Agent */
export class ClientDetectionStage implements PipelineStage {
  readonly name = 'client-detection';

  async execute(ctx: PipelineContext): Promise<void> {
    ctx.clientInfo = buildClientInfo(ctx.req);
    ctx.metadata['clientType'] = ctx.clientInfo.type;
    ctx.metadata['protocol'] = ctx.clientInfo.protocol;
  }
}

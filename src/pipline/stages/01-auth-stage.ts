import type { PipelineContext, PipelineStage } from '../pipeline.types.js';
import type { SecurityIntegration } from '../../security/security-integration.js';

/** Stage 1: Authenticate the incoming request */
export class AuthStage implements PipelineStage {
  readonly name = 'auth';

  constructor(private readonly security: SecurityIntegration) {}

  async execute(ctx: PipelineContext): Promise<void> {
    return new Promise((resolve) => {
      this.security.middleware(
        ctx.req as Parameters<SecurityIntegration['middleware']>[0],
        ctx.res as Parameters<SecurityIntegration['middleware']>[1],
        () => resolve(),
      );
    });
  }
}

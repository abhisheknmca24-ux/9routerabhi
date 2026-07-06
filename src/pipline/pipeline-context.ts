import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PipelineContext } from './pipeline.types.js';

export function createPipelineContext(
  req: IncomingMessage,
  res: ServerResponse,
  body: Record<string, unknown>,
): PipelineContext {
  return {
    requestId: `req_${crypto.randomUUID().slice(0, 8)}`,
    req,
    res,
    body,
    stream: false,
    timeline: [],
    metadata: {},
  };
}

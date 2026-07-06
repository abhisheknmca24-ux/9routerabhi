import { type IncomingMessage, type ServerResponse } from 'node:http';
import { type Logger } from '../types/logger.types.js';
import {
  type SharedRequest,
  type SharedResponse,
  type SharedResponseChunk,
  type ClientInfo,
  type ProtocolType,
} from '../types/api.types.js';
import { detectClient, buildClientInfo } from './client-detector.js';
import { ProtocolAdapter } from './protocol-adapter.js';

/**
 * CompatibilityLayer — the universal facade that all incoming requests pass through.
 *
 * 1. Detects the client and protocol
 * 2. Parses the request into a SharedRequest
 * 3. Routes through the engine (via callback)
 * 4. Formats the response back to the client's protocol
 *
 * The routing engine, combo executor, provider health, and fallback are
 * completely unchanged. This layer only wraps around them.
 */

export interface RouteHandler {
  (request: SharedRequest): Promise<SharedResponse>;
}

export interface StreamHandler {
  (request: SharedRequest, callbacks: {
    onToken: (chunk: SharedResponseChunk) => void;
    onDone: (response: SharedResponse) => void;
    onError: (error: Error) => void;
  }): Promise<void>;
}

export interface EngineProviders {
  route: RouteHandler;
  stream: StreamHandler;
}

export class CompatibilityLayer {
  public readonly adapter = new ProtocolAdapter();
  private clientSessions = new Map<string, { requestCount: number; lastSeen: number; errors: number }>();

  constructor(
    private readonly logger: Logger,
    private readonly engine: EngineProviders,
  ) {}

  /**
   * Handle an incoming request end-to-end.
   * This is the single entry point for ALL clients.
   */
  async handleRequest(req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>): Promise<void> {
    const clientInfo = buildClientInfo(req);
    this._trackClient(clientInfo);

    // Parse the request into universal format
    const sharedReq = this.adapter.parseRequest(req, body, clientInfo);
    if (!sharedReq) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: { message: `Unsupported protocol: ${clientInfo.protocol}`, type: 'invalid_request_error' } }));
      return;
    }

    this.logger.info(`Request: ${clientInfo.type} → ${sharedReq.model} (${clientInfo.protocol})`, {
      client: clientInfo.type,
      protocol: clientInfo.protocol,
      model: sharedReq.model,
      stream: sharedReq.stream,
    });

    try {
      if (sharedReq.stream) {
        await this._handleStream(req, res, sharedReq, clientInfo);
      } else {
        await this._handleSingle(req, res, sharedReq, clientInfo);
      }
    } catch (err) {
      this._handleError(res, clientInfo, err);
    }
  }

  /** Get client session stats for the dashboard */
  getClientStats(): Array<{
    type: string;
    protocol: string;
    requestCount: number;
    errors: number;
    lastSeen: string;
  }> {
    const stats: Array<{
      type: string;
      protocol: string;
      requestCount: number;
      errors: number;
      lastSeen: string;
    }> = [];

    // Aggregate by client type from sessions
    const byType = new Map<string, { requestCount: number; errors: number; lastSeen: number }>();
    for (const [key, session] of this.clientSessions) {
      const type = key;
      const existing = byType.get(type);
      if (existing) {
        existing.requestCount += session.requestCount;
        existing.errors += session.errors;
        existing.lastSeen = Math.max(existing.lastSeen, session.lastSeen);
      } else {
        byType.set(type, { requestCount: session.requestCount, errors: session.errors, lastSeen: session.lastSeen });
      }
    }

    for (const [type, data] of byType) {
      stats.push({
        type,
        protocol: '',
        requestCount: data.requestCount,
        errors: data.errors,
        lastSeen: new Date(data.lastSeen).toISOString(),
      });
    }

    return stats;
  }

  /** Reset client stats */
  resetClientStats(): void {
    this.clientSessions.clear();
  }

  // ─── Private ───

  private async _handleSingle(
    req: IncomingMessage,
    res: ServerResponse,
    sharedReq: SharedRequest,
    clientInfo: ClientInfo,
  ): Promise<void> {
    const response = await this.engine.route(sharedReq);
    const formatted = this.adapter.formatResponse(response, clientInfo.protocol);

    res.statusCode = 200;
    res.setHeader('Content-Type', this.adapter.getContentType(clientInfo.protocol, false));
    res.setHeader('X-Gateway-Client', clientInfo.type);
    res.end(JSON.stringify(formatted));
  }

  private async _handleStream(
    req: IncomingMessage,
    res: ServerResponse,
    sharedReq: SharedRequest,
    clientInfo: ClientInfo,
  ): Promise<void> {
    res.statusCode = 200;
    res.setHeader('Content-Type', this.adapter.getContentType(clientInfo.protocol, true));
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Gateway-Client', clientInfo.type);
    res.setHeader('X-Accel-Buffering', 'no');

    const protocol = clientInfo.protocol;

    // Send protocol-appropriate preamble for SSE
    if (protocol === 'anthropic-messages') {
      const messageStart = {
        type: 'message_start',
        message: {
          id: `msg_${Date.now().toString(36)}`,
          type: 'message',
          role: 'assistant',
          content: [],
          model: sharedReq.model,
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      };
      res.write(`event: message_start\ndata: ${JSON.stringify(messageStart)}\n\n`);
    }

    await this.engine.stream(sharedReq, {
      onToken: (chunk: SharedResponseChunk) => {
        const formatted = this.adapter.formatStreamChunk(chunk, protocol);
        res.write(formatted);
      },
      onDone: (response: SharedResponse) => {
        const endMarker = this.adapter.formatStreamEnd(protocol);
        res.write(endMarker);
        res.end();
      },
      onError: (err: Error) => {
        const errorChunk = this.adapter.formatStreamChunk(
          { type: 'error', content: err.message },
          protocol,
        );
        try { res.write(errorChunk); } catch {}
        res.end();
      },
    });
  }

  private _handleError(res: ServerResponse, clientInfo: ClientInfo, err: unknown): void {
    const message = err instanceof Error ? err.message : 'Internal error';
    this.logger.error('Request failed', { client: clientInfo.type, error: message });

    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { message, type: 'server_error' } }));
  }

  private _trackClient(clientInfo: ClientInfo): void {
    const key = clientInfo.type;
    const existing = this.clientSessions.get(key);
    if (existing) {
      existing.requestCount++;
      existing.lastSeen = Date.now();
    } else {
      this.clientSessions.set(key, { requestCount: 1, lastSeen: Date.now(), errors: 0 });
    }
  }
}

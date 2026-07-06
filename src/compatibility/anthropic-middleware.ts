/**
 * AnthropicMiddleware
 *
 * Express middleware that makes the gateway speak exact Anthropic protocol.
 * Handles everything Claude Desktop expects:
 *   - Authorization: Bearer <token>
 *   - anthropic-version header validation
 *   - CORS headers
 *   - Request logging in Anthropic format
 *   - Correct error status codes (401, 429, 529, etc.)
 *   - Rate limiting headers
 *
 * No routing logic. No provider logic. Pure protocol compatibility.
 */

import type { Request, Response, NextFunction } from 'express';

export interface AnthropicMiddlewareOptions {
  /** Whether to require authentication */
  requireAuth?: boolean;
  /** API key to accept (Bearer token) */
  apiKey?: string;
  /** Anthropic version to advertise */
  anthropicVersion?: string;
  /** Rate limit: max requests per window */
  maxRequests?: number;
  /** Rate limit: window in ms */
  windowMs?: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export class AnthropicMiddleware {
  private readonly requireAuth: boolean;
  private readonly apiKey?: string;
  private readonly anthropicVersion: string;
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly rateLimitMap = new Map<string, RateLimitEntry>();

  constructor(options: AnthropicMiddlewareOptions = {}) {
    this.requireAuth = options.requireAuth ?? true;
    this.apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY ?? process.env.API_KEY_SECRET;
    this.anthropicVersion = options.anthropicVersion ?? '2023-06-01';
    this.maxRequests = options.maxRequests ?? 200;
    this.windowMs = options.windowMs ?? 60000;
  }

  /**
   * Main middleware handler — applies all Anthropic compatibility checks.
   */
  handle = (req: Request, res: Response, next: NextFunction): void => {
    // ── 1. Set Anthropic response headers ──
    res.setHeader('anthropic-version', this.anthropicVersion);
    res.setHeader('x-request-id', `req_${Date.now().toString(36)}`);

    // ── 2. CORS ──
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type, authorization, anthropic-version, x-api-key');
    res.setHeader('access-control-expose-headers', 'x-request-id, request-id');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    // ── 3. Validate anthropic-version header ──
    const clientVersion = req.headers['anthropic-version'] as string | undefined;
    if (clientVersion && clientVersion !== this.anthropicVersion) {
      this._sendError(res, 400, 'invalid_request_error',
        `Unsupported anthropic-version: ${clientVersion}. Supported: ${this.anthropicVersion}`);
      return;
    }

    // ── 4. Authentication (Bearer token) ──
    if (this.requireAuth && this.apiKey) {
      const authHeader = req.headers['authorization'] as string | undefined;
      if (!authHeader) {
        this._sendError(res, 401, 'authentication_error', 'Authorization header required');
        return;
      }

      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
      if (token !== this.apiKey) {
        this._sendError(res, 401, 'authentication_error', 'Invalid API key');
        return;
      }
    }

    // ── 5. Rate limiting ──
    const clientIp = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const now = Date.now();
    let entry = this.rateLimitMap.get(clientIp);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.rateLimitMap.set(clientIp, entry);
    }

    entry.count++;
    res.setHeader('x-ratelimit-limit', String(this.maxRequests));
    res.setHeader('x-ratelimit-remaining', String(Math.max(0, this.maxRequests - entry.count)));
    res.setHeader('x-ratelimit-reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > this.maxRequests) {
      this._sendError(res, 429, 'rate_limit_error', 'Too many requests');
      return;
    }

    // ── 6. Validate content-type for POST ──
    if (req.method === 'POST') {
      const ct = req.headers['content-type'] || '';
      if (!ct.includes('application/json')) {
        this._sendError(res, 400, 'invalid_request_error', 'Content-Type must be application/json');
        return;
      }
    }

    next();
  };

  /**
   * Send an error in exact Anthropic format.
   */
  private _sendError(res: Response, statusCode: number, type: string, message: string): void {
    const errorBody = {
      type: 'error',
      error: { type, message },
    };

    res.statusCode = statusCode;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(errorBody));
  }
}

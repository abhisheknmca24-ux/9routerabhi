import crypto from 'node:crypto';
import { type Logger } from '../types/logger.types.js';

export interface AuthMiddlewareOptions {
  apiKeySecret?: string;
  jwtSecret?: string;
  requireAuth?: boolean;
  sessionTimeout?: number;
  logger?: Logger;
}

interface SessionEntry {
  user: string;
  expires: number;
  createdAt: number;
}

export class AuthMiddleware {
  private readonly apiKeySecret?: string;
  private readonly jwtSecret?: string;
  public readonly requireAuth: boolean;
  private readonly sessionTimeout: number;
  private readonly logger?: Logger;
  private readonly sessions = new Map<string, SessionEntry>();
  private warned = false;

  constructor(options?: AuthMiddlewareOptions) {
    this.apiKeySecret = options?.apiKeySecret ?? process.env.API_KEY_SECRET;
    this.jwtSecret = options?.jwtSecret ?? process.env.JWT_SECRET;
    this.requireAuth = options?.requireAuth ?? process.env.REQUIRE_API_KEY !== 'false';
    this.sessionTimeout = options?.sessionTimeout ?? 3600000;
    this.logger = options?.logger;
  }

  authenticate(req: { headers: Record<string, string | string[] | undefined> }, res: { statusCode: number; setHeader(name: string, value: string): void; end(data: string): void; json?(data: unknown): void; status?(code: number): { json(data: unknown): void } }, next: () => void): void {
    if (!this.requireAuth) {
      if (!this.warned) {
        this.logger?.warn('Authentication is DISABLED. Set REQUIRE_API_KEY=true in production.');
        this.warned = true;
      }
      return next();
    }

    const authHeader = req.headers['authorization'];
    let apiKey = req.headers['x-api-key'];

    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      apiKey = apiKey || authHeader.slice(7);
    } else if (typeof authHeader === 'string' && !apiKey) {
      apiKey = authHeader;
    }

    if (!apiKey || Array.isArray(apiKey)) {
      this._sendUnauthorized(res, 'API key required');
      return;
    }

    if (this._validateApiKey(apiKey)) return next();

    if (this._validateJWT(apiKey)) return next();

    this._sendUnauthorized(res, 'Invalid API key');
  }

  private _sendUnauthorized(res: { statusCode: number; setHeader(name: string, value: string): void; end(data: string): void; json?(data: unknown): void; status?(code: number): { json(data: unknown): void } }, message: string): void {
    const body = JSON.stringify({ error: { message, type: 'authentication_error' } });
    if (typeof res.status === 'function' && typeof res.json === 'function') {
      res.status(401).json({ error: { message, type: 'authentication_error' } });
    } else {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(body);
    }
  }

  private _validateApiKey(key: string): boolean {
    if (!this.apiKeySecret) return false;
    try {
      const keyBuf = Buffer.from(key);
      const secretBuf = Buffer.from(this.apiKeySecret);
      if (keyBuf.length !== secretBuf.length) return false;
      return crypto.timingSafeEqual(keyBuf, secretBuf);
    } catch {
      return false;
    }
  }

  private _validateJWT(token: string): boolean {
    if (!this.jwtSecret) return false;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return false;

      const [header, payload, signature] = parts;

      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (decoded.exp && Date.now() >= decoded.exp * 1000) return false;

      const expectedSig = crypto.createHmac('sha256', this.jwtSecret)
        .update(`${header}.${payload}`)
        .digest('base64url');

      const sigBuf = Buffer.from(signature);
      const expectedBuf = Buffer.from(expectedSig);
      if (sigBuf.length !== expectedBuf.length) return false;
      return crypto.timingSafeEqual(sigBuf, expectedBuf);
    } catch {
      return false;
    }
  }

  generateSession(user: string, ttl?: number): { sessionId: string; expires: number } {
    const sessionId = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + (ttl ?? this.sessionTimeout);
    this.sessions.set(sessionId, { user, expires, createdAt: Date.now() });
    return { sessionId, expires };
  }

  validateSession(sessionId: string): { user: string; expires: number; createdAt: number } | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (Date.now() > session.expires) {
      this.sessions.delete(sessionId);
      return null;
    }
    return session;
  }

  revokeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}

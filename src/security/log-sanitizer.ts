import { type Logger } from '../types/logger.types.js';

export interface SanitizerPattern {
  regex: RegExp;
  replacement: string;
}

const SENSITIVE_PATTERNS: SanitizerPattern[] = [
  { regex: /api[_\-]?key[=:]["']?[^"'\s,}]+/gi, replacement: 'api_key=[REDACTED]' },
  { regex: /(secret)[=:]\s*["']?[^"'\s,}]+/gi, replacement: 'secret=[REDACTED]' },
  { regex: /(password)[=:]\s*["']?[^"'\s,}]+/gi, replacement: 'password=[REDACTED]' },
  { regex: /(token)[=:]\s*["']?[^"'\s,}]+/gi, replacement: 'token=[REDACTED]' },
  { regex: /(bearer\s+)[a-zA-Z0-9._\-]+/gi, replacement: 'bearer [REDACTED]' },
  { regex: /(authorization:\s*)[^\s,]+/gi, replacement: 'authorization: [REDACTED]' },
  { regex: /x-api-key:\s*\S+/gi, replacement: 'x-api-key: [REDACTED]' },
  { regex: /sk-[a-zA-Z0-9]{20,}/g, replacement: 'sk-[REDACTED]' },
];

const SENSITIVE_KEYS = [
  'api_key', 'apikey', 'api-key', 'secret', 'password',
  'token', 'authorization', 'x-api-key', 'jwt', 'privatekey', 'private_key',
];

export class LogSanitizer {
  private readonly patterns: SanitizerPattern[];

  constructor(
    private readonly logger?: Logger,
    customPatterns: SanitizerPattern[] = [],
  ) {
    this.patterns = [...SENSITIVE_PATTERNS, ...customPatterns];
  }

  sanitize(obj: unknown, depth = 0): unknown {
    if (depth > 10) return '[MAX_DEPTH]';
    if (typeof obj === 'string') return this._sanitizeString(obj);
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'number' || typeof obj === 'boolean') return obj;
    if (Array.isArray(obj)) return obj.map(item => this.sanitize(item, depth + 1));
    if (typeof obj === 'object') {
      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (this._isSensitiveKey(key)) {
          sanitized[key] = '[REDACTED]';
        } else {
          sanitized[key] = this.sanitize(value, depth + 1);
        }
      }
      return sanitized;
    }
    return obj;
  }

  sanitizeHeaders(headers: Record<string, unknown>): Record<string, unknown> {
    const sanitized = { ...headers };
    for (const key of Object.keys(sanitized)) {
      if (this._isSensitiveKey(key)) sanitized[key] = '[REDACTED]';
    }
    return sanitized;
  }

  sanitizeBody(body: unknown): unknown {
    return this.sanitize(body);
  }

  sanitizeQuery(query: Record<string, unknown>): Record<string, unknown> {
    const sanitized = { ...query };
    for (const key of Object.keys(sanitized)) {
      if (this._isSensitiveKey(key)) sanitized[key] = '[REDACTED]';
    }
    return sanitized;
  }

  sanitizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.password) parsed.password = '[REDACTED]';
      for (const [key] of parsed.searchParams) {
        if (this._isSensitiveKey(key)) parsed.searchParams.set(key, '[REDACTED]');
      }
      return parsed.toString();
    } catch {
      return this._sanitizeString(url);
    }
  }

  private _sanitizeString(str: string): string {
    let result = str;
    for (const { regex, replacement } of this.patterns) {
      result = result.replace(regex, replacement);
    }
    return result;
  }

  private _isSensitiveKey(key: string): boolean {
    const lower = key.toLowerCase();
    return SENSITIVE_KEYS.some(s => lower.includes(s.toLowerCase()));
  }
}

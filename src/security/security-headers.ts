import type { IncomingMessage, ServerResponse } from 'node:http';

export interface SecurityHeadersConfig {
  customHeaders?: Record<string, string>;
}

export class SecurityHeaders {
  private readonly headers: Record<string, string>;

  constructor(config?: SecurityHeadersConfig) {
    this.headers = {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Content-Security-Policy': "default-src 'self'",
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-DNS-Prefetch-Control': 'off',
      'X-Permitted-Cross-Domain-Policies': 'none',
      ...config?.customHeaders,
    };
  }

  apply(_req: IncomingMessage, res: ServerResponse, next?: () => void): void {
    for (const [key, value] of Object.entries(this.headers)) {
      res.setHeader(key, value);
    }
    if (typeof next === 'function') {
      next();
    }
  }

  addHeader(key: string, value: string): void {
    this.headers[key] = value;
  }

  removeHeader(key: string): void {
    delete this.headers[key];
  }

  allowCaching(maxAge = 3600): void {
    this.headers['Cache-Control'] = `public, max-age=${maxAge}`;
    delete this.headers['Pragma'];
  }
}

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { type Logger } from '../types/logger.types.js';

export interface HttpAgentConfig {
  timeout?: number;
  maxRetries?: number;
  keepAlive?: boolean;
  maxSockets?: number;
  logger?: Logger;
}

export interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  data: unknown;
  raw: string;
}

export class HttpAgent {
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly logger?: Logger;
  private readonly httpAgent: http.Agent;
  private readonly httpsAgent: https.Agent;

  constructor(config?: HttpAgentConfig) {
    this.timeout = config?.timeout ?? 30000;
    this.maxRetries = config?.maxRetries ?? 3;
    this.logger = config?.logger;

    const keepAlive = config?.keepAlive !== false;
    const maxSockets = config?.maxSockets ?? 100;

    this.httpAgent = new http.Agent({
      keepAlive,
      maxSockets,
      maxFreeSockets: Math.max(10, Math.floor(maxSockets / 2)),
      timeout: this.timeout,
    });
    this.httpsAgent = new https.Agent({
      keepAlive,
      maxSockets,
      maxFreeSockets: Math.max(10, Math.floor(maxSockets / 2)),
      timeout: this.timeout,
    });
  }

  async request(url: string, options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    timeout?: number;
    signal?: AbortSignal;
    retries?: number;
  }): Promise<HttpResponse> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }

    const useHttps = parsedUrl.protocol === 'https:';
    const method = (options?.method || 'GET').toUpperCase();
    const headers = { 'Content-Type': 'application/json', ...options?.headers };
    const body = options?.body;
    const timeout = options?.timeout ?? this.timeout;
    const signal = options?.signal;
    const retries = options?.retries ?? this.maxRetries;

    const doRequest = async (_attempt: number): Promise<HttpResponse> => {
      return new Promise((resolve, reject) => {
        const req = (useHttps ? https : http).request(
          parsedUrl,
          { method, headers, agent: useHttps ? this.httpsAgent : this.httpAgent, timeout },
          (res) => {
            let data = '';
            res.on('data', (chunk: string) => data += chunk);
            res.on('end', () => {
              let parsedData: unknown = null;
              try {
                parsedData = data ? JSON.parse(data) : null;
              } catch {
                parsedData = null;
              }
              resolve({ status: res.statusCode ?? 0, headers: res.headers, data: parsedData, raw: data });
            });
          },
        );

        req.on('error', (err) => reject(err));
        req.on('timeout', () => { req.destroy(); reject(Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' })); });

        if (signal) {
          if (signal.aborted) {
            req.destroy();
            return reject(Object.assign(new Error('ABORTED'), { code: 'ABORTED' }));
          }
          signal.addEventListener('abort', () => { req.destroy(); reject(Object.assign(new Error('ABORTED'), { code: 'ABORTED' })); }, { once: true });
        }

        if (body) req.write(JSON.stringify(body));
        req.end();
      });
    };

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await doRequest(attempt);
        if (result.status === 429 && attempt < retries) {
          const backoff = Math.min(1000 * Math.pow(2, attempt), 10000);
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }
        return result;
      } catch (err) {
        lastError = err as Error;
        if ((err as Error & { code?: string }).code === 'ABORTED' || (err as Error & { code?: string }).code === 'ETIMEDOUT') {
          throw err;
        }
        if (attempt < retries) {
          const backoff = Math.min(1000 * Math.pow(2, attempt), 10000);
          await new Promise(r => setTimeout(r, backoff));
        }
      }
    }
    throw lastError;
  }

  async get(url: string, options?: { headers?: Record<string, string>; timeout?: number; signal?: AbortSignal }): Promise<HttpResponse> {
    return this.request(url, { ...options, method: 'GET' });
  }

  async post(url: string, body?: unknown, options?: { headers?: Record<string, string>; timeout?: number; signal?: AbortSignal }): Promise<HttpResponse> {
    return this.request(url, { ...options, method: 'POST', body });
  }

  destroy(): void {
    this.httpAgent.destroy();
    this.httpsAgent.destroy();
  }
}

/**
 * StreamingFailoverHandler — maintains the SSE stream across provider failures
 *
 * When a streaming provider fails mid-stream, this handler:
 * 1. Classifies the failure (429, 502, timeout, auth, etc.)
 * 2. Preserves partial output already streamed to the client
 * 3. Takes the correct action (skip, retry same, failover to next, disable)
 * 4. Continues the stream with the next provider if possible
 * 5. Updates provider health
 * 6. Records streaming analytics
 *
 * The client sees a seamless stream — they never know a provider failed.
 */

import { type Logger } from '../types/logger.types.js';
import { type HttpAgent, type HttpResponse } from '../performance/http-agent.js';
import {
  type FailureAction,
  FAILURE_TO_ACTION,
  STATUS_TO_FAILURE,
  ERROR_CODE_TO_FAILURE,
} from '../types/routing.types.js';
import { type ProviderConfig } from '../types/provider.types.js';
import { ProviderHealthTracker } from './provider-health-tracker.js';

export interface StreamingFailoverConfig {
  /** URL of the upstream OpenAI-compatible gateway */
  gatewayUrl: string;
  /** Max providers to try before giving up */
  maxFailoverAttempts?: number;
  /** Whether to include a note in the stream when failover occurs */
  transparentFailover?: boolean;
}

export interface FailoverEvent {
  provider: string;
  statusOrError: number | string;
  failureType: string;
  action: FailureAction;
  partialContent: string;
  failoverTo?: string;
  timestamp: number;
  durationMs: number;
}

export interface StreamResult {
  content: string;
  failoverEvents: FailoverEvent[];
  finalProvider: string;
  totalRetries: number;
  totalFallbacks: number;
  perProviderLatency: Record<string, number>;
}

/**
 * Options for streaming to a single provider.
 */
interface StreamProviderOptions {
  model: string;
  messages: Array<{ role: string; content: string }>;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export class StreamingFailoverHandler {
  private readonly maxFailoverAttempts: number;
  private readonly transparentFailover: boolean;

  constructor(
    private readonly httpAgent: HttpAgent,
    private readonly healthTracker: ProviderHealthTracker,
    private readonly gatewayUrl: string,
    private readonly logger: Logger,
    config?: StreamingFailoverConfig,
  ) {
    this.maxFailoverAttempts = config?.maxFailoverAttempts ?? 3;
    this.transparentFailover = config?.transparentFailover ?? true;
  }

  /**
   * Execute a streaming request with failover across multiple providers.
   *
   * @param model — the resolved model name
   * @param providerChain — ordered list of providers to try
   * @param buildBody — callback to build request body for a provider
   * @param onChunk — called for each text delta received from any provider
   * @param onDone — called when the stream completes successfully
   * @param onError — called if all providers fail
   */
  async execute(
    model: string,
    providerChain: Array<{ id: string; endpoint?: string }>,
    buildBody: (providerId: string) => Record<string, unknown>,
    onChunk: (delta: string) => void,
    onDone: (content: string) => void,
    onError: (error: Error) => void,
  ): Promise<void> {
    const failoverEvents: FailoverEvent[] = [];
    let fullContent = '';
    let attemptCount = 0;
    let fallbackCount = 0;
    const perProviderLatency: Record<string, number> = {};
    const attemptedProviders: string[] = [];

    for (let i = 0; i < providerChain.length && attemptCount < this.maxFailoverAttempts; i++) {
      const provider = providerChain[i];
      const prevContent = fullContent; // Capture what we have so far
      const providerStartTime = Date.now();

      this.logger.info(`Stream failover: trying ${provider.id}`, {
        attempt: attemptCount + 1,
        partialContentLength: fullContent.length,
        provider: provider.id,
      });

      try {
        const body = buildBody(provider.id);
        body.stream = true;

        // Record start time before request
        const startTime = Date.now();

        // Send the request
        const response = await this.httpAgent.post(
          provider.endpoint || `${this.gatewayUrl}/v1/chat/completions`,
          body,
          { timeout: 30000 },
        );

        const latencyMs = Date.now() - startTime;
        perProviderLatency[provider.id] = latencyMs;

        // If we got a non-200 response, treat as a failure
        if (response.status >= 400) {
          const statusCode = response.status;
          const failureType = STATUS_TO_FAILURE[statusCode] || 'unknown';
          const action = FAILURE_TO_ACTION[failureType];

          const fe: FailoverEvent = {
            provider: provider.id,
            statusOrError: statusCode,
            failureType,
            action,
            partialContent: fullContent,
            timestamp: Date.now(),
            durationMs: latencyMs,
          };

          // Update health tracker
          this.healthTracker.recordFailure(provider.id, statusCode);

          // Handle specific failure actions
          if (action === 'disable_provider') {
            this.logger.error(`Stream failover: ${provider.id} disabled due to auth failure`);
            // Don't retry this provider
            fe.failoverTo = this._getNextProvider(providerChain, i + 1);
            failoverEvents.push(fe);
            fallbackCount++;
            continue; // Try next provider
          }

          if (action === 'skip_provider' || action === 'next_provider') {
            fe.failoverTo = this._getNextProvider(providerChain, i + 1);
            failoverEvents.push(fe);
            fallbackCount++;
            continue; // Try next provider
          }

          if (action === 'retry_once' || action === 'retry_with_backoff') {
            // Retry same provider with backoff
            const backoffMs = Math.min(1000 * Math.pow(2, attemptCount), 5000);
            fe.failoverTo = provider.id; // Retry same
            failoverEvents.push(fe);
            await new Promise(r => setTimeout(r, backoffMs));
            attemptCount++;
            i--; // Retry same index
            continue;
          }

          if (action === 'retry_different' || action === 'retry_another') {
            fe.failoverTo = this._getNextProvider(providerChain, i + 1);
            failoverEvents.push(fe);
            fallbackCount++;
            continue; // Try next provider
          }

          // Unknown action — try next
          fe.failoverTo = this._getNextProvider(providerChain, i + 1);
          failoverEvents.push(fe);
          fallbackCount++;
          continue;
        }

        // Success — parse the SSE stream
        this.healthTracker.recordSuccess(provider.id, latencyMs);

        if (response.raw) {
          const lines = response.raw.split('\n');
          let finishedNormally = false;

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') {
              finishedNormally = true;
              break;
            }

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              const finishReason = parsed.choices?.[0]?.finish_reason;

              if (delta) {
                fullContent += delta;
                onChunk(delta);
              }

              if (finishReason) {
                finishedNormally = true;
                break;
              }
            } catch {}
          }

          if (finishedNormally) {
            attemptedProviders.push(provider.id);
            onDone(fullContent);
            return; // Success!
          }

          // Stream ended without [DONE] or finish_reason — probably incomplete
          this.logger.warn(`Stream failover: ${provider.id} stream ended unexpectedly`, {
            contentLength: fullContent.length,
          });

          // Fall through to try next provider
          attemptedProviders.push(provider.id);
          const fe: FailoverEvent = {
            provider: provider.id,
            statusOrError: 'INCOMPLETE_STREAM',
            failureType: 'unknown',
            action: 'retry_different',
            partialContent: fullContent,
            timestamp: Date.now(),
            durationMs: latencyMs,
            failoverTo: this._getNextProvider(providerChain, i + 1),
          };
          failoverEvents.push(fe);
          fallbackCount++;
          continue;
        }

        // No raw data — try next
        const fe: FailoverEvent = {
          provider: provider.id,
          statusOrError: 'NO_DATA',
          failureType: 'unknown',
          action: 'retry_different',
          partialContent: fullContent,
          timestamp: Date.now(),
          durationMs: latencyMs,
          failoverTo: this._getNextProvider(providerChain, i + 1),
        };
        failoverEvents.push(fe);
        fallbackCount++;
        continue;

      } catch (err) {
        const error = err as Error & { code?: string };
        const durationMs = Date.now() - providerStartTime;
        perProviderLatency[provider.id] = durationMs;

        const errorCode = error.code || error.message;
        const failureType = ERROR_CODE_TO_FAILURE[errorCode] || 'unknown';
        const action = FAILURE_TO_ACTION[failureType] || 'retry_different';

        // Record failure in health tracker
        this.healthTracker.recordFailure(provider.id, errorCode);

        const fe: FailoverEvent = {
          provider: provider.id,
          statusOrError: errorCode,
          failureType,
          action,
          partialContent: fullContent,
          timestamp: Date.now(),
          durationMs,
        };

        if (action === 'disable_provider') {
          this.logger.error(`Stream failover: ${provider.id} disabled`);
          fe.failoverTo = this._getNextProvider(providerChain, i + 1);
          failoverEvents.push(fe);
          fallbackCount++;
          continue;
        }

        if (action === 'retry_once' || action === 'retry_with_backoff') {
          const backoffMs = Math.min(1000 * Math.pow(2, attemptCount), 5000);
          fe.failoverTo = provider.id;
          failoverEvents.push(fe);
          await new Promise(r => setTimeout(r, backoffMs));
          attemptCount++;
          i--;
          continue;
        }

        // Default: try next provider
        fe.failoverTo = this._getNextProvider(providerChain, i + 1);
        failoverEvents.push(fe);
        fallbackCount++;
        continue;
      }
    }

    // All providers exhausted
    this.logger.error(`Stream failover exhausted: tried ${attemptedProviders.join(', ')}`, {
      partialContentLength: fullContent.length,
      failoverEvents: failoverEvents.length,
    });

    onError(new Error(`All providers failed after ${fallbackCount} fallbacks. Partial content: ${fullContent.length} chars`));
  }

  /** Stream a transparent failover note to inform the client */
  formatFailoverNote(event: FailoverEvent): string {
    return `\n\n[Gateway: ${event.provider} returned ${event.statusOrError} (${event.failureType}), continuing with ${event.failoverTo || 'next provider'}]\n\n`;
  }

  private _getNextProvider(chain: Array<{ id: string }>, fromIndex: number): string | undefined {
    return chain[fromIndex]?.id;
  }
}

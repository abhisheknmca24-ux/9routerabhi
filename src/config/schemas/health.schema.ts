import { z } from 'zod';
import { CircuitBreakerSchema } from './routing.schema.js';

export const HttpCheckSchema = z.object({
  enabled: z.boolean(),
  method: z.string(),
  expectedStatus: z.number().int(),
  expectedResponseTime: z.number().int(),
});

export const LatencyCheckSchema = z.object({
  enabled: z.boolean(),
  warningThreshold: z.number().int(),
  criticalThreshold: z.number().int(),
  samplesPerWindow: z.number().int(),
});

export const RateLimitCheckSchema = z.object({
  enabled: z.boolean(),
  warningThreshold: z.number(),
  criticalThreshold: z.number(),
  windowMs: z.number().int(),
});

export const HealthConfigSchema = z.object({
  checkInterval: z.number().int().positive(),
  requestTimeout: z.number().int().positive(),
  unhealthyThreshold: z.number().int().positive(),
  healthyThreshold: z.number().int().positive(),
  cooldownPeriod: z.number().int().positive(),
  circuitBreaker: CircuitBreakerSchema,
  checks: z.object({
    http: HttpCheckSchema,
    latency: LatencyCheckSchema,
    rateLimit: RateLimitCheckSchema,
  }),
  endpoints: z.object({
    status: z.string(),
    metrics: z.string(),
  }),
});

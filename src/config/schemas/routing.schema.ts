import { z } from 'zod';

export const TierConditionSchema = z.object({
  minHealthScore: z.number().min(0).max(1).optional(),
  maxLatency: z.number().int().positive().optional(),
  requiredModels: z.array(z.string()).optional(),
});

export const RoutingTierSchema = z.object({
  name: z.string().min(1),
  providers: z.array(z.string()),
  conditions: TierConditionSchema.optional(),
});

export const CircuitBreakerSchema = z.object({
  enabled: z.boolean(),
  failureThreshold: z.number().int().positive(),
  resetTimeout: z.number().int().positive(),
  halfOpenMaxRequests: z.number().int().positive(),
  monitoredStatusCodes: z.array(z.number().int()).optional(),
});

export const LoadBalancingSchema = z.object({
  enabled: z.boolean(),
  algorithm: z.string(),
});

export const RoutingPolicySchema = z.object({
  strategy: z.string(),
  tiers: z.array(RoutingTierSchema),
  defaultTier: z.string().min(1),
  failoverTimeout: z.number().int().positive(),
  maxFailoverAttempts: z.number().int().positive(),
  circuitBreaker: CircuitBreakerSchema.optional(),
  stickySession: z.boolean(),
  loadBalancing: LoadBalancingSchema,
});

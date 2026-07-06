import { z } from 'zod';

export const ProviderAuthSchema = z.object({
  apiKey: z.string().min(1).optional(),
  endpoint: z.string().optional(),
  accountId: z.string().optional(),
});

export const ProviderConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string(),
  enabled: z.boolean(),
  models: z.array(z.string()),
  auth: ProviderAuthSchema,
  headers: z.record(z.string()).optional(),
  rateLimit: z.number().int().positive().optional(),
  timeout: z.number().int().positive().optional(),
  priority: z.number().int().min(1).max(100),
});

export const ProvidersFileSchema = z.object({
  providers: z.array(ProviderConfigSchema),
  defaultProvider: z.string().min(1),
  fallbackProvider: z.string().min(1),
  providerOrder: z.array(z.string()),
});

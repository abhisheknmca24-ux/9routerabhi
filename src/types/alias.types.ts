/** Gateway Alias — maps a friendly name to a combo-profile or a direct model ID */

export type AliasTargetType = 'combo' | 'model';

export interface AliasConfig {
  /** Unique alias name (e.g. "claude-sonnet-4-5") */
  name: string;
  /** What this alias maps to — either a combo profile name or a raw model ID */
  target: string;
  /** 'combo' = maps to a combo profile (e.g. "Coding"), 'model' = maps to a provider model */
  targetType: AliasTargetType;
  /** Whether this alias is active */
  enabled: boolean;
  /** Priority order (lower = higher priority, applied first) */
  priority: number;
  /** Optional description */
  description?: string;
  /** ISO timestamp when created */
  createdAt: string;
  /** ISO timestamp when last updated */
  updatedAt: string;
  /** Usage statistics */
  stats?: AliasStats;
  /** ID for database storage */
  id?: number;
}

export interface AliasStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  lastUsed: string | null;
}

export interface AliasFile {
  version: number;
  aliases: AliasConfig[];
}

export interface CreateAliasRequest {
  name: string;
  target: string;
  targetType: AliasTargetType;
  enabled?: boolean;
  priority?: number;
  description?: string;
}

export interface UpdateAliasRequest {
  target?: string;
  targetType?: AliasTargetType;
  enabled?: boolean;
  priority?: number;
  description?: string;
}

export interface AliasValidationError {
  field: string;
  message: string;
}

export interface AliasImportResult {
  imported: number;
  skipped: number;
  errors: Array<{ name: string; reason: string }>;
}

export interface AliasFilterParams {
  search?: string;
  targetType?: AliasTargetType;
  enabled?: boolean;
  sortBy?: 'name' | 'priority' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface AliasListResult {
  aliases: AliasConfig[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

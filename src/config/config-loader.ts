import fs from 'node:fs';
import path from 'node:path';
import { type Logger } from '../types/logger.types.js';
import { type AllConfigs } from '../types/config.types.js';
import { ProvidersFileSchema } from './schemas/provider.schema.js';
import { RoutingPolicySchema } from './schemas/routing.schema.js';
import { HealthConfigSchema } from './schemas/health.schema.js';

export class ConfigValidationError extends Error {
  public readonly file: string;
  public readonly zodErrors: string[];

  constructor(file: string, message: string, zodErrors: string[] = []) {
    super(`Config validation failed in ${file}: ${message}`);
    this.name = 'ConfigValidationError';
    this.file = file;
    this.zodErrors = zodErrors;
  }
}

function readJsonFile<T>(filePath: string): T {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new ConfigValidationError(filePath, `Invalid JSON: ${err.message}`);
    }
    throw err;
  }
}

function resolveEnvVars(obj: unknown): unknown {
  if (typeof obj === 'string') {
    const match = obj.match(/^\$\{([^:}]+)(?::([^}]+))?\}$/);
    if (match) {
      return process.env[match[1]] ?? match[2] ?? '';
    }
    return obj;
  }
  if (Array.isArray(obj)) return obj.map(item => resolveEnvVars(item));
  if (obj !== null && typeof obj === 'object') {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      resolved[key] = resolveEnvVars(value);
    }
    return resolved;
  }
  return obj;
}

export class ConfigLoader {
  private readonly configDir: string;

  constructor(
    private readonly logger: Logger,
    configDir?: string,
  ) {
    this.configDir = configDir || path.resolve(process.env.CONFIG_DIR || path.join(process.cwd(), 'config'));
  }

  loadProviders(): AllConfigs['providers'] {
    const filePath = path.join(this.configDir, 'providers', 'providers.json');
    this.logger.info('Loading providers config', { file: filePath });

    const raw = readJsonFile<unknown>(filePath);
    const resolved = resolveEnvVars(raw);
    const result = ProvidersFileSchema.safeParse(resolved);

    if (!result.success) {
      throw new ConfigValidationError(
        filePath,
        'Providers config validation failed',
        result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`),
      );
    }

    return result.data as AllConfigs['providers'];
  }

  loadRoutingPolicy(): AllConfigs['routing'] {
    const filePath = path.join(this.configDir, 'routing', 'routing-policy.json');
    this.logger.info('Loading routing policy', { file: filePath });

    const raw = readJsonFile<unknown>(filePath);
    const result = RoutingPolicySchema.safeParse(raw);

    if (!result.success) {
      throw new ConfigValidationError(
        filePath,
        'Routing policy validation failed',
        result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`),
      );
    }

    return result.data as AllConfigs['routing'];
  }

  loadHealthConfig(): AllConfigs['health'] {
    const filePath = path.join(this.configDir, 'health', 'health-config.json');
    this.logger.info('Loading health config', { file: filePath });

    const raw = readJsonFile<unknown>(filePath);
    const result = HealthConfigSchema.safeParse(raw);

    if (!result.success) {
      throw new ConfigValidationError(
        filePath,
        'Health config validation failed',
        result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`),
      );
    }

    return result.data as AllConfigs['health'];
  }

  loadAll(): AllConfigs {
    return {
      providers: this.loadProviders(),
      routing: this.loadRoutingPolicy(),
      health: this.loadHealthConfig(),
      retry: this.loadGeneric('retry', 'retry-config.json') as AllConfigs['retry'],
      fallback: this.loadGeneric('fallback', 'fallback-config.json') as AllConfigs['fallback'],
      logging: this.loadGeneric('logging', 'logging-config.json') as AllConfigs['logging'],
      server: this.loadGeneric('server', 'server-config.json') as AllConfigs['server'],
      profile: this.loadGeneric('profiles', 'default.json') as AllConfigs['profile'],
    };
  }

  private loadGeneric(dir: string, file: string): unknown {
    const filePath = path.join(this.configDir, dir, file);
    this.logger.info(`Loading ${dir} config`, { file: filePath });
    const raw = readJsonFile<unknown>(filePath);
    return resolveEnvVars(raw);
  }
}

export { readJsonFile, resolveEnvVars };

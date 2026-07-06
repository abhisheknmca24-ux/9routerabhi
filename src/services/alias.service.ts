import { type Logger } from '../types/logger.types.js';
import {
  type AliasConfig,
  type CreateAliasRequest,
  type UpdateAliasRequest,
  type AliasImportResult,
} from '../types/alias.types.js';
import { AliasRepository } from '../repositories/alias-repository.js';
import { AliasValidator } from './alias-validator.js';

export class AliasService {
  private readonly validator: AliasValidator;

  constructor(
    private readonly repository: AliasRepository,
    private readonly logger: Logger,
  ) {
    this.validator = new AliasValidator({
      exists: (name: string) => this.repository.exists(name),
    });
  }

  list(search?: string): AliasConfig[] {
    if (search && search.trim().length > 0) {
      return this.repository.search(search);
    }
    return this.repository.getAll();
  }

  get(name: string): AliasConfig | null {
    return this.repository.getByName(name) ?? null;
  }

  create(req: CreateAliasRequest): { alias?: AliasConfig; errors?: Array<{ field: string; message: string }> } {
    const errors = this.validator.validateCreate(req);
    if (errors.length > 0) return { errors };

    const now = new Date().toISOString();
    const alias: AliasConfig = {
      name: req.name.trim(),
      target: req.target.trim(),
      targetType: req.targetType,
      enabled: req.enabled !== false,
      description: req.description?.trim(),
      createdAt: now,
      updatedAt: now,
    };

    this.repository.add(alias);
    this.logger.info(`Alias created: ${alias.name} → ${alias.target} (${alias.targetType})`);
    return { alias };
  }

  update(name: string, req: UpdateAliasRequest): { alias?: AliasConfig; errors?: Array<{ field: string; message: string }> } {
    const errors = this.validator.validateUpdate(name, req);
    if (errors.length > 0) return { errors };

    const updated = this.repository.update(name, {
      ...(req.target !== undefined ? { target: req.target.trim() } : {}),
      ...(req.targetType !== undefined ? { targetType: req.targetType } : {}),
      ...(req.enabled !== undefined ? { enabled: req.enabled } : {}),
      ...(req.description !== undefined ? { description: req.description.trim() } : {}),
    });

    if (!updated) return { errors: [{ field: 'name', message: `Alias "${name}" not found` }] };
    this.logger.info(`Alias updated: ${name}`);
    return { alias: updated };
  }

  delete(name: string): boolean {
    const result = this.repository.delete(name);
    if (result) this.logger.info(`Alias deleted: ${name}`);
    return result;
  }

  toggle(name: string, enabled: boolean): AliasConfig | null {
    return this.repository.update(name, { enabled });
  }

  importAliases(data: unknown, overwrite: boolean): { result?: AliasImportResult; errors?: Array<{ field: string; message: string }> } {
    const validationErrors = this.validator.validateImport(Array.isArray(data) ? data : []);
    if (validationErrors.length > 0) return { errors: validationErrors };

    const aliases = data as Array<Record<string, unknown>>;
    const now = new Date().toISOString();
    const mapped = aliases.map(a => ({
      name: String(a.name ?? '').trim(),
      target: String(a.target ?? '').trim(),
      targetType: (a.targetType as 'combo' | 'model') || 'combo',
      enabled: a.enabled !== false,
      description: a.description ? String(a.description).trim() : undefined,
      createdAt: (a.createdAt as string) || now,
      updatedAt: now,
    })) as AliasConfig[];

    const result = this.repository.importAliases(mapped, overwrite);
    return { result };
  }

  exportAliases(): AliasConfig[] {
    return this.repository.exportAliases();
  }

  resolveAlias(name: string): { target: string; targetType: string } | null {
    const alias = this.repository.getByName(name);
    if (!alias || !alias.enabled) return null;
    return { target: alias.target, targetType: alias.targetType };
  }
}

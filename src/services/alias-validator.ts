import { type CreateAliasRequest, type UpdateAliasRequest, type AliasValidationError, type AliasTargetType } from '../types/alias.types.js';

const COMBO_PROFILES = ['Coding', 'Reasoning', 'Chat', 'Balanced', 'Vision', 'Research', 'Fast', 'Long_Context', 'Planning'];

export interface AliasValidatorDeps {
  exists(name: string): boolean;
  isValidModel?(model: string): boolean;
}

export class AliasValidator {
  private readonly deps: AliasValidatorDeps;

  constructor(deps: AliasValidatorDeps) {
    this.deps = deps;
  }

  validateCreate(req: CreateAliasRequest): AliasValidationError[] {
    const errors: AliasValidationError[] = [];

    if (!req.name || req.name.trim().length === 0) {
      errors.push({ field: 'name', message: 'Alias name is required' });
    } else if (req.name.length > 64) {
      errors.push({ field: 'name', message: 'Alias name must be 64 characters or fewer' });
    } else if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(req.name)) {
      errors.push({ field: 'name', message: 'Alias name must start with a letter or number and contain only letters, numbers, dots, hyphens, and underscores' });
    } else if (this.deps.exists(req.name)) {
      errors.push({ field: 'name', message: `Alias "${req.name}" already exists` });
    }

    if (!req.target || req.target.trim().length === 0) {
      errors.push({ field: 'target', message: 'Target is required' });
    } else if (req.targetType === 'combo' && !COMBO_PROFILES.includes(req.target)) {
      errors.push({ field: 'target', message: `Invalid combo profile "${req.target}". Valid: ${COMBO_PROFILES.join(', ')}` });
    }

    if (!req.targetType || !['combo', 'model'].includes(req.targetType)) {
      errors.push({ field: 'targetType', message: 'Target type must be "combo" or "model"' });
    }

    return errors;
  }

  validateUpdate(name: string, req: UpdateAliasRequest): AliasValidationError[] {
    const errors: AliasValidationError[] = [];

    if (req.target !== undefined && req.target.trim().length === 0) {
      errors.push({ field: 'target', message: 'Target cannot be empty' });
    }

    if (req.target !== undefined && req.targetType === 'combo' && !COMBO_PROFILES.includes(req.target)) {
      errors.push({ field: 'target', message: `Invalid combo profile "${req.target}". Valid: ${COMBO_PROFILES.join(', ')}` });
    }

    if (req.targetType !== undefined && !['combo', 'model'].includes(req.targetType)) {
      errors.push({ field: 'targetType', message: 'Target type must be "combo" or "model"' });
    }

    return errors;
  }

  validateImport(aliases: unknown[]): AliasValidationError[] {
    const errors: AliasValidationError[] = [];
    if (!Array.isArray(aliases)) {
      errors.push({ field: 'root', message: 'Import data must be an array of aliases' });
      return errors;
    }
    for (let i = 0; i < aliases.length; i++) {
      const a = aliases[i] as Record<string, unknown>;
      if (!a.name || typeof a.name !== 'string') {
        errors.push({ field: `[${i}].name`, message: 'Name is required and must be a string' });
      }
      if (!a.target || typeof a.target !== 'string') {
        errors.push({ field: `[${i}].target`, message: 'Target is required and must be a string' });
      }
    }
    return errors;
  }
}

export { COMBO_PROFILES };

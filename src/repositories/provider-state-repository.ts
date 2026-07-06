import { type Repository } from '../types/repository.types.js';
import { type ProviderHealthState } from '../types/provider.types.js';

export class ProviderStateRepository implements Repository<ProviderHealthState> {
  private readonly states = new Map<string, ProviderHealthState>();

  get(id: string): ProviderHealthState | undefined {
    return this.states.get(id);
  }

  getAll(): ProviderHealthState[] {
    return Array.from(this.states.values());
  }

  exists(id: string): boolean {
    return this.states.has(id);
  }

  set(id: string, value: ProviderHealthState): void {
    this.states.set(id, value);
  }

  delete(id: string): boolean {
    return this.states.delete(id);
  }

  clear(): void {
    this.states.clear();
  }

  entries(): Map<string, ProviderHealthState> {
    return new Map(this.states);
  }
}

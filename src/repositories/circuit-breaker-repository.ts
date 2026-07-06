import { type Repository } from '../types/repository.types.js';
import { type CircuitBreakerState, type CircuitBreakerStateValue } from '../types/health.types.js';

export interface CircuitBreakerRepository extends Repository<CircuitBreakerState> {
  transitionTo(providerId: string, state: CircuitBreakerStateValue): void;
  advanceHalfOpen(cooldownPeriod: number): void;
  entries(): Map<string, CircuitBreakerState>;
}

export class InMemoryCircuitBreakerRepository implements CircuitBreakerRepository {
  private readonly states = new Map<string, CircuitBreakerState>();

  get(id: string): CircuitBreakerState | undefined {
    return this.states.get(id);
  }

  getAll(): CircuitBreakerState[] {
    return Array.from(this.states.values());
  }

  exists(id: string): boolean {
    return this.states.has(id);
  }

  set(id: string, value: CircuitBreakerState): void {
    this.states.set(id, value);
  }

  delete(id: string): boolean {
    return this.states.delete(id);
  }

  clear(): void {
    this.states.clear();
  }

  transitionTo(providerId: string, state: CircuitBreakerStateValue): void {
    const current = this.states.get(providerId);
    this.states.set(providerId, {
      state,
      lastFailure: current?.lastFailure ?? null,
      openedAt: state === 'open' ? Date.now() : current?.openedAt,
    });
  }

  advanceHalfOpen(cooldownPeriod: number): void {
    const now = Date.now();
    for (const [providerId, state] of this.states) {
      if (state.state === 'open' && state.openedAt && (now - state.openedAt) > cooldownPeriod) {
        this.states.set(providerId, { state: 'half-open', lastFailure: state.lastFailure, openedAt: state.openedAt });
      }
    }
  }

  entries(): Map<string, CircuitBreakerState> {
    return new Map(this.states);
  }
}

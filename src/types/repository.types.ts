export interface ReadOnlyRepository<T, K = string> {
  get(id: K): T | undefined;
  getAll(): T[];
  exists(id: K): boolean;
}

export interface Repository<T, K = string> extends ReadOnlyRepository<T, K> {
  set(id: K, value: T): void;
  delete(id: K): boolean;
  clear(): void;
}

export interface ConfigRepository<T> {
  load(): T;
  reload(): T;
  getAll(): T;
}

import { type Logger, type LogContext, type LogLevel } from '../types/logger.types.js';

const LEVEL_NUMBERS: Record<LogLevel, number> = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

export class ConsoleLogger implements Logger {
  private readonly _level: number;
  private readonly _context: LogContext;

  constructor(level: LogLevel = 'info', context: LogContext = {}) {
    this._level = LEVEL_NUMBERS[level] ?? 3;
    this._context = context;
  }

  fatal(message: string, context?: LogContext): void {
    this._log('fatal', message, context);
  }

  error(message: string, context?: LogContext): void {
    this._log('error', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this._log('warn', message, context);
  }

  info(message: string, context?: LogContext): void {
    this._log('info', message, context);
  }

  debug(message: string, context?: LogContext): void {
    this._log('debug', message, context);
  }

  trace(message: string, context?: LogContext): void {
    this._log('trace', message, context);
  }

  child(context: LogContext): Logger {
    return new ConsoleLogger(
      this._getLevelName(),
      { ...this._context, ...context },
    );
  }

  setLevel(level: LogLevel): void {
    // Allow changing level at runtime via the class prototype
    (this as unknown as { _level: number })._level = LEVEL_NUMBERS[level] ?? 3;
  }

  private _log(level: LogLevel, message: string, context?: LogContext): void {
    if (LEVEL_NUMBERS[level] > this._level) return;

    const merged = { ...this._context, ...context };
    const timestamp = new Date().toISOString();

    if (Object.keys(merged).length > 0) {
      console[level === 'fatal' ? 'error' : level](`[${timestamp}] [${level.toUpperCase()}] ${message}`, merged);
    } else {
      console[level === 'fatal' ? 'error' : level](`[${timestamp}] [${level.toUpperCase()}] ${message}`);
    }
  }

  private _getLevelName(): LogLevel {
    for (const [name, num] of Object.entries(LEVEL_NUMBERS)) {
      if (num === this._level) return name as LogLevel;
    }
    return 'info';
  }
}

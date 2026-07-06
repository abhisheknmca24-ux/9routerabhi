export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

export interface LogContext {
  service?: string;
  requestId?: string;
  provider?: string;
  model?: string;
  latency?: number;
  statusCode?: number;
  [key: string]: unknown;
}

export interface Logger {
  fatal(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;
  trace(message: string, context?: LogContext): void;
  child(context: LogContext): Logger;
  setLevel(level: LogLevel): void;
}

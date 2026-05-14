/**
 * Logger interface and factory.
 *
 * Thin abstraction over pino. Consumers depend on the Logger interface,
 * not pino directly — swap the underlying impl without touching call sites.
 *
 * Implementation populated in Phase 2 (Transport / Backend Core).
 */

import type { Severity } from '@pulse/types/telemetry';

export interface Logger {
  trace(obj: Record<string, unknown>, msg?: string): void;
  debug(obj: Record<string, unknown>, msg?: string): void;
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
  fatal(obj: Record<string, unknown>, msg?: string): void;
  child(bindings: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  readonly name: string;
  readonly level: Severity;
  readonly pretty?: boolean;
}

// Factory implemented in Phase 5 (Backend Core)
export declare function createLogger(options: LoggerOptions): Logger;

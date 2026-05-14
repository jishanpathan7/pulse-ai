/**
 * REST API request/response contracts.
 *
 * All responses follow the envelope pattern:
 *   Success: { data: T, meta?: Meta }
 *   Error:   { error: ApiError }
 *
 * Pagination uses cursor-based pagination for stream-safe traversal.
 */

// ─── Envelope ─────────────────────────────────────────────────────────────────

export interface ApiSuccess<T> {
  readonly data: T;
  readonly meta?: ResponseMeta;
}

export interface ApiError {
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
  readonly traceId?: string;
}

export interface ResponseMeta {
  readonly cursor?: string;
  readonly hasMore?: boolean;
  readonly total?: number;
  readonly requestId: string;
  readonly durationMs: number;
}

export type ApiResponse<T> = ApiSuccess<T> | { readonly error: ApiError };

// ─── Health ───────────────────────────────────────────────────────────────────

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthCheckResponse {
  readonly status: HealthStatus;
  readonly version: string;
  readonly uptime: number;
  readonly checks: Record<string, ServiceHealth>;
}

export interface ServiceHealth {
  readonly status: HealthStatus;
  readonly latencyMs?: number;
  readonly message?: string;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface CursorPaginationParams {
  readonly cursor?: string;
  readonly limit?: number;
}

export interface CursorPaginationResult<T> {
  readonly items: ReadonlyArray<T>;
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

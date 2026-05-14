/**
 * Type-safe assertion utilities.
 * Assertions are stripped in production builds via dead-code elimination.
 */

export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

export function assertDefined<T>(value: T | null | undefined, message: string): asserts value is T {
  assert(value !== null && value !== undefined, message);
}

export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${String(value)}`);
}

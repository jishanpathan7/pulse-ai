/**
 * Branded/nominal type helpers.
 * Prevent primitive type confusion at compile time with zero runtime cost.
 */

declare const __brand: unique symbol;
type Brand<B> = { readonly [__brand]: B };
export type Branded<T, B> = T & Brand<B>;

export function brand<T extends Branded<unknown, unknown>>(value: T extends Branded<infer V, unknown> ? V : never): T {
  return value as T;
}

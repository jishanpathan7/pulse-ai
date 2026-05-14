# TypeScript Architecture Conventions

## Project References

TypeScript project references enforce build order and prevent circular imports.
Each package has a `tsconfig.json` with explicit `references` to its dependencies.

```
root tsconfig.json
  references → [packages/types, packages/utils, packages/logger,
                packages/telemetry, packages/transport, packages/ui,
                apps/web, apps/api]
```

Build with `tsc -b` at root for incremental compilation across the graph.

## Module Resolution

All packages use `"moduleResolution": "Bundler"` (apps/web — Vite)
or `"moduleResolution": "NodeNext"` (apps/api — Node.js ESM).

Internal package imports resolve via pnpm workspace + TypeScript `paths`:
```json
{ "@/*": ["./src/*"] }   // within an app
```

Package exports use source TypeScript paths directly (no build step for dev):
```json
{ ".": "./src/index.ts" }
```

## Type Guards

Write explicit type guards for all `unknown` inputs from:
- WebSocket message payloads
- HTTP request bodies (even after Fastify schema validation)
- `localStorage` / `sessionStorage` reads
- Environment variables

```typescript
// Pattern for WS message parsing
function isServerMessage(value: unknown): value is ServerMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as Record<string, unknown>).type === 'string'
  );
}
```

## Immutability

All contract types use `readonly` on every property and `ReadonlyArray<T>` for arrays.
This catches accidental mutation at compile time and signals intent.

Mutable state lives only in Zustand stores and RAF queues — never in contract types.

## Discriminated Unions

Use discriminated unions (via `type` literal field) for all message types.
TypeScript narrows automatically in `switch` statements:

```typescript
switch (message.type) {
  case 'token': // narrowed to ServerTokenMessage
  case 'stream_end': // narrowed to ServerStreamEndMessage
  // exhaustiveness via assertNever in default branch
}
```

Always add `default: assertNever(message)` to catch unhandled message types
when new message types are added.

## Strictness Config

The `base.json` tsconfig enables:
- `noUncheckedIndexedAccess` — array/object access returns `T | undefined`
- `exactOptionalPropertyTypes` — `{ a?: string }` cannot be `{ a: undefined }`
- `noImplicitOverride` — subclass overrides must use `override` keyword
- `noUnusedLocals` / `noUnusedParameters` — dead code caught at compile time

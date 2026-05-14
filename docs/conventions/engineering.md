# Engineering Conventions

## TypeScript

- **Strict mode always.** `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride` enabled.
- **`verbatimModuleSyntax`** — all type-only imports use `import type { ... }`.
- **Branded types** for domain primitives (`SequenceNumber`, `StreamId`, etc). Use `@pulse/utils` brand helpers.
- **`Result<T, E>`** for functions that can fail at subsystem boundaries. Never throw across module boundaries.
- **No `any`.** ESLint `@typescript-eslint/no-explicit-any` set to `error`. Use `unknown` + narrowing.
- **No non-null assertions** (`!`) except in test setup code.
- **`const` enums prohibited** — use `as const` objects. Const enums break with isolated modules.

## Naming

| Thing | Convention | Example |
|---|---|---|
| Files | `kebab-case` | `sequence-buffer.ts` |
| Interfaces | `PascalCase` | `TransportClient` |
| Types | `PascalCase` | `ConnectionState` |
| Enums (as const) | `PascalCase` key, `SCREAMING_SNAKE` value | `TransportErrorCode.CONNECTION_REFUSED` |
| Functions | `camelCase` | `createLogger` |
| React components | `PascalCase` | `MessageList` |
| Store names | `use*Store` | `useTransportStore` |
| Constants | `SCREAMING_SNAKE_CASE` | `DEFAULT_BACKOFF_CONFIG` |
| CSS classes | Tailwind utilities only, `cn()` for composition | — |

## Comments

- Write comments for **why**, not what. Code expresses what; comments explain constraints.
- Non-obvious invariants, workarounds, and performance reasons warrant comments.
- No JSDoc for internal functions. JSDoc only for public package API surfaces.

## Error Handling

- All errors at subsystem boundaries: typed `PulseError` objects with `domain`, `code`, `retryable`.
- Console logging only in `@pulse/logger` — never raw `console.log` in feature code.
- `unhandledRejection` and `uncaughtException` handlers in `apps/api/src/main.ts` and `apps/web/src/main.tsx`.

## Imports

- Internal packages: `import type` for types, `import` for values.
- No barrel re-exports within an app (only in packages). Barrels in apps cause bundler to load unused code.
- Import order: 1) Node built-ins, 2) external packages, 3) `@pulse/*` packages, 4) local `@/`.

## Testing (Phase 2+)

- Unit tests: Vitest. Co-located with source as `*.test.ts`.
- Integration tests: separate `tests/integration/` directory.
- No mocking of `@pulse/transport` in integration tests — use real WebSocket server.
- Transport tested with mock server; store tested with mock transport.

## Performance

- Never call `setState` in a WebSocket `onmessage` handler directly — always via rAF queue.
- Zustand selectors must be stable references. Use primitive selectors or `useShallowEqual`.
- `useMemo` / `useCallback` only when profiler shows re-render cost, not preemptively.
- No inline object/array literals as component props when component is in a render hot path.

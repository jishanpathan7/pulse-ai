# Git Conventions

## Branch Model

```
main          — production-ready, protected
  └── feat/   — feature branches
  └── fix/    — bug fixes
  └── chore/  — tooling, deps, docs
  └── perf/   — performance improvements
  └── refactor/ — non-functional changes
```

Branches merge to `main` via PR. No direct pushes to `main`.

## Commit Format

Conventional Commits. Format: `<type>(<scope>): <description>`

**Types:** `feat` | `fix` | `chore` | `docs` | `perf` | `refactor` | `test` | `ci`

**Scopes:** `transport` | `state` | `render` | `api` | `types` | `telemetry` | `ui` | `infra`

**Examples:**
```
feat(transport): add sequence gap detection and replay request
fix(render): prevent duplicate RAF schedule on rapid token arrival
perf(state): replace object selector with primitive in useStreamStore
docs(adr): add ADR-0005 for rAF batching strategy
chore(deps): bump turbo to 2.3.3
```

Subject line: ≤72 chars, imperative mood, no period.
Body: explain *why*, not *what*. Include invariants or constraints that motivated the change.

## PR Rules

- PRs require passing: `typecheck`, `lint`, `test`
- One concern per PR — no "while I was here" changes bundled in
- Performance-sensitive changes include before/after profiler data in PR description
- ADRs accompany architectural decisions (not implementation PRs)

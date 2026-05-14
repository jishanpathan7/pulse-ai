# Runbooks

Operational runbooks for Pulse AI. Each runbook describes how to respond
to a specific production scenario.

## Index

Runbooks added as each system comes online (Phase 5+).

| Runbook | Scenario |
|---|---|
| `ws-mass-disconnect.md` | Mass WebSocket disconnect event |
| `redis-eviction.md` | Redis replay buffer eviction under memory pressure |
| `stream-latency-spike.md` | P99 token latency exceeds threshold |
| `db-pool-exhaustion.md` | PostgreSQL connection pool exhausted |
| `replay-gap-storm.md` | High rate of sequence gap detections (network partition) |

## Runbook Template

Each runbook covers:
1. **Symptom** — what alerts fire, what users see
2. **Likely cause** — ranked by probability
3. **Diagnosis** — specific queries/commands to identify root cause
4. **Mitigation** — steps to reduce immediate impact
5. **Resolution** — permanent fix
6. **Post-mortem trigger** — when to write a post-mortem

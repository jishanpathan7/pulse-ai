# ADR-0009: Pure Reducer State Machine for Transport

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-04-29 |

## Context

The WebSocket transport passes through a well-defined set of states:
`idle → connecting → handshaking → connected → reconnecting → failed/disconnected`.
Transitions are driven by socket events and internal timeouts.

Without a formal state machine, transport code devolves into flag soup:
`isConnected`, `isReconnecting`, `handshakeComplete`, `wasIntentional` —
each combination representing an implicit state that is hard to reason about
and easy to get wrong. Invalid transitions (e.g., sending while handshaking)
become runtime bugs instead of compile-time errors.

## Decision

Model the transport lifecycle as a pure reducer state machine.

- **State** is a discriminated union of `MachineState` variants, each carrying
  only the data relevant to that state
- **Events** are a discriminated union of `MachineEvent` variants
- **Reducer** `reduce(state, event): MachineState` is a pure function with no side effects
- `TransportStateMachine` wraps the reducer, holds current state, notifies listeners
- All side effects (socket creation, timers) live outside the machine

## Rationale

**Pure function = testable without mocks.**
The reducer can be tested exhaustively by enumerating (state, event) pairs.
No WebSocket, no timers, no async needed in tests.

**Discriminated union = exhaustiveness checking.**
TypeScript's `switch` over `state.status` forces handling of every state.
Adding a new state forces updating every `switch` in the codebase — the
compiler catches missing cases.

**Rich states carry exactly the right data.**
`connected` state carries `sessionId` and `connectedAt` — not available
in other states. `reconnecting` carries `lastSessionId` (for replay).
Callers never need to null-check fields that "might not be set yet."

**No invalid transitions compile.**
`failed` and `disconnected` are terminal: the reducer returns the same
state for any event. This is enforced by structure, not runtime checks.

## Consequences

**Positive:** Transport lifecycle is a single source of truth. Side effects
are pushed to the edges — the machine is a pure function that's easy to test
and audit. New states/transitions are added in one place.

**Negative:** Pure reducer pattern requires some discipline to maintain:
callers must not embed state machine logic locally. The `TransportStateMachine`
class must be the only entity that calls `reduce()`.

## Alternatives Considered

### XState
Full-featured hierarchical state machine library. Rejected: adds 15kb bundle
size and significant API complexity. Our machine is simple enough that a
hand-written reducer is more readable and has zero dependencies.

### Flags and conditionals (`isConnecting`, `isConnected`, etc.)
Rejected: exponential complexity as states multiply. Hidden invalid state
combinations become runtime bugs.

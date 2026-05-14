# State Store Architecture

Zustand stores are organized by domain subsystem. Each store owns exactly one concern.

## Store Boundaries (implemented in Phase 3)

| Store | File | Concern |
|---|---|---|
| `useTransportStore` | `transport.ts` | Connection state, metrics, seq tracking |
| `useStreamStore` | `stream.ts` | Active streams, token buffers, stream lifecycle |
| `useConversationStore` | `conversation.ts` | Conversation list, message history |
| `useUIStore` | `ui.ts` | Scroll position, panel state, viewport metrics |

## Rules

- Stores are **never** imported by `@pulse/ui` components
- Stores **never** contain rendering logic (no refs, no DOM)
- Cross-store communication via explicit selectors, not store-to-store imports
- All async actions return `Result<T, E>` — no unhandled promise rejections in stores
- rAF batching lives **outside** stores — stores hold state, not scheduling logic

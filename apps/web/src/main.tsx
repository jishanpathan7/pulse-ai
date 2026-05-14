/**
 * Application entry point.
 *
 * Boot sequence:
 *   1. Create RenderPipeline singleton (already done — module-level singleton)
 *   2. Create WsTransportClient with config
 *   3. Connect pipeline to transport (subscribes to events before WS opens)
 *   4. Mount React app (stores are now populated as transport events arrive)
 *   5. Initiate WS connection (async — React renders optimistically)
 *
 * Transport is NOT connected in Phase 4 (no backend yet).
 * WS connection happens in Phase 5/6. This file sets up the wiring so
 * Phase 5 just needs to call transport.connect(wsUrl).
 *
 * StrictMode:
 *   Enabled in development. Components must handle double-mount/unmount
 *   correctly (effects fire twice). renderPipeline.connect() is idempotent
 *   (calling with the same transport twice is a no-op after disconnect).
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@pulse/ui/globals.css';

import { App } from './app.js';
import { renderPipeline } from './render/pipeline.js';

// ── Transport initialization (Phase 5+) ──────────────────────────────────────
// WsTransportClient imported and connected here when backend is ready.
// For now: pipeline exists, stores exist, components can render empty state.
//
// Phase 5 activation:
//   import { WsTransportClient } from './transport/ws-client.js';
//   const transport = new WsTransportClient({ ... });
//   renderPipeline.connect(transport);
//   transport.connect(import.meta.env.VITE_WS_URL).catch(console.error);

// Expose pipeline on window for development debugging
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>)['__pulsePipeline'] = renderPipeline;
}

// ── Mount ─────────────────────────────────────────────────────────────────────

const rootEl = document.getElementById('root');
if (rootEl === null) throw new Error('Root element #root not found in document');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

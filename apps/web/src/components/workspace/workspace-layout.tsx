import { useEffect, useRef } from 'react';
import { useByokStore } from '../../store/byok-store.js';
import { BYOKAdapter } from '../../ai/byok-adapter.js';
import type { AIProvider } from '../../ai/provider.js';
import { TopNav } from './top-nav.js';
import { Sidebar } from './sidebar/sidebar.js';
import { ReconnectBanner } from './status/reconnect-banner.js';
import { ReplayIndicator } from './status/replay-indicator.js';
import { SystemStatusBar } from './status/system-status-bar.js';
import { ChaosPanel } from '../controls/chaos-panel.js';
import { SettingsPanel } from './settings/settings-panel.js';
import { TelemetryDock } from '../controls/telemetry-dock.js';
import { BenchmarkPanel } from '../controls/benchmark-panel.js';
import { MessageList } from '../conversation/message-list.js';
import { EmptyWorkspace } from './empty-workspace.js';
import { InputBar } from './input-bar.js';
import { WorkspaceErrorBoundary } from './error-boundary.js';
import { useConversationStore, selectMessages } from '../../store/conversation-store.js';
import { useStreamStore, selectStreamCount } from '../../store/stream-store.js';
import {
  selectDockPanel,
  selectActiveSessionId,
  selectMobileSidebarOpen,
} from '../../workspace/workspace-store.js';
import { StreamSimulator } from '../../telemetry/stress/simulator.js';
import { scenarios } from '../../telemetry/stress/scenarios.js';
import type { ScenarioName } from '../../telemetry/stress/scenarios.js';
import type { RenderPipeline } from '../../render/pipeline.js';
import { renderPipeline } from '../../render/pipeline.js';
import { StreamInjector } from '../../ai/stream-injector.js';
import { aiProviderRegistry } from '../../ai/provider.js';
import { DemoAdapter } from '../../ai/demo-adapter.js';
import { AnthropicAdapter } from '../../ai/anthropic-adapter.js';
import { WsAIProvider } from '../../ai/ws-ai-provider.js';
import { OllamaAdapter } from '../../ai/ollama-adapter.js';
import { WsTransportClient } from '../../transport/ws-client.js';
import { DEFAULT_TRANSPORT_CONFIG } from '@pulse/transport';
import { createMessageSnapshot } from '../../render/snapshot.js';
import type { ConversationId, StreamId } from '@pulse/types/transport';
import type { SendMessageEvent } from './input-bar.js';
import { createConversation, listConversations, getMessages, renameConversation, saveMessages } from '../../api/conversations-client.js';
import { useWorkspaceStore } from '../../workspace/workspace-store.js';
import type { WorkspaceSession } from '../../workspace/workspace-store.js';
import { useUIStore } from '../../store/ui-store.js';

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Pulse, an AI assistant built into the Pulse AI workspace — a realtime AI infrastructure platform for engineers.

You help engineers with:
- Streaming pipeline design and debugging (token decode, append, render, commit stages)
- WebSocket transport, reconnect logic, and sequence-aware replay recovery
- Frontend performance: rAF batching, virtual scrolling, render budgets
- State management patterns (Zustand, selector optimization, re-render isolation)
- Backpressure, buffering, and rate-limiting for streaming systems
- Any software engineering, architecture, or debugging question

The workspace delivers your responses in real time using a rAF-batched render pipeline with 60fps token streaming. You're talking to engineers who value precision and directness.

Be concise and technically precise. Lead with the answer. Skip preamble and pleasantries. When you show code, make it production-ready.`;

// ─── AI provider initialization ───────────────────────────────────────────────

const demoAdapter = new DemoAdapter();
const anthropicAdapter = new AnthropicAdapter();
const ollamaAdapter = new OllamaAdapter({ model: 'llama3.2' });

aiProviderRegistry.register('demo', demoAdapter);
aiProviderRegistry.register('anthropic', anthropicAdapter);
aiProviderRegistry.register('ollama', ollamaAdapter);

// Probe Ollama in background — takes effect before user sends first message
void ollamaAdapter.probe().then((ok) => {
  if (ok) {
    console.info('[Pulse] Ollama available — llama3.2 active');
    useWorkspaceStore.getState().setActiveProvider('ollama');
  } else {
    console.warn('[Pulse] Ollama not reachable — falling back to demo');
  }
});

// ─── WebSocket transport ──────────────────────────────────────────────────────
// Connect to the backend WS and register WsAIProvider as the preferred provider.
// Falls back to AnthropicAdapter (SSE) → DemoAdapter if WS is unavailable.

const WS_URL = (() => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
})();

const wsTransport = new WsTransportClient({
  ...DEFAULT_TRANSPORT_CONFIG,
  clientId: `browser-${Math.random().toString(36).slice(2, 10)}` as import('@pulse/types/transport').ClientId,
});

const wsAIProvider = new WsAIProvider(wsTransport);
aiProviderRegistry.register('ws-anthropic', wsAIProvider);

// Always probe SSE backend at startup — parallel to WS, not conditional on WS failure.
// This ensures anthropicAdapter.isAvailable is set before user sends first message,
// and that BYOK has a real delegate even when WS is unavailable.
void anthropicAdapter.probe().then((available) => {
  console.info(`[Pulse] SSE backend ${available ? 'available' : 'unavailable'}`);
});

// Connect WS in background — don't block workspace render
wsTransport.connect(WS_URL).then((result) => {
  if (result.ok) {
    console.info('[Pulse] WS connected — using WsAIProvider');
  } else {
    console.warn('[Pulse] WS connection failed:', result.error.message);
  }
}).catch((err: unknown) => {
  console.warn('[Pulse] WS connect error:', err);
});

// ─── Workspace bootstrap ──────────────────────────────────────────────────────
// Load or create conversations from backend, hydrate local store with history.

function useWorkspaceBootstrap() {
  const setActiveSession = useWorkspaceStore((s) => s.setActiveSession);
  const setSessions = useWorkspaceStore((s) => s.setSessions);
  const loadMessages = useConversationStore((s) => s.loadMessages);
  const loadByokKeys = useByokStore((s) => s.loadKeys);
  const loadByokProviders = useByokStore((s) => s.loadProviders);

  useEffect(() => {
    // Load BYOK keys and provider catalogue in parallel (non-blocking)
    void loadByokKeys();
    void loadByokProviders();
  }, [loadByokKeys, loadByokProviders]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Load existing conversations
      const convs = await listConversations();

      let activeId: string;

      if (convs.length > 0 && !cancelled) {
        // Replace stubs with real sessions
        const sessions: WorkspaceSession[] = convs.map((c) => ({
          id: c.id as ConversationId,
          title: c.title,
          createdAt: new Date(c.created_at).getTime(),
          messageCount: parseInt(c.message_count, 10),
          isStreaming: false,
          pinned: c.pinned,
        }));
        setSessions(sessions);
        activeId = convs[0]!.id;
      } else if (!cancelled) {
        // First login — create conversation
        const created = await createConversation('New session');
        if (!created || cancelled) return;
        setSessions([{
          id: created.id as ConversationId,
          title: created.title,
          createdAt: new Date(created.created_at).getTime(),
          messageCount: 0,
          isStreaming: false,
          pinned: false,
        }]);
        activeId = created.id;
      } else {
        return;
      }

      if (cancelled) return;
      setActiveSession(activeId as ConversationId);

      // Hydrate message history for active conversation
      const msgs = await getMessages(activeId);
      if (!cancelled && msgs.length > 0) {
        const snapshots = msgs.map((m) =>
          createMessageSnapshot({
            role: m.role,
            content: m.content,
            tokenCount: m.token_count,
            errorCode: null,
            completedAt: m.completed_at ? new Date(m.completed_at).getTime() : Date.now(),
            createdAt: new Date(m.created_at).getTime(),
            streamId: null,
            conversationId: activeId as ConversationId,
          }),
        );
        loadMessages(activeId as ConversationId, snapshots);
      }
    })();

    return () => { cancelled = true; };
  }, [setActiveSession, setSessions, loadMessages]);
}

// ─── AI message controller ────────────────────────────────────────────────────

let _activeInjection: { abort: () => void } | null = null;

function useAIController(conversationId: ConversationId) {
  const addMessage = useConversationStore((s) => s.addMessage);
  const dispatchScrollEvent = useUIStore((s) => s.dispatchScrollEvent);
  const renameSessionStore = useWorkspaceStore((s) => s.renameSession);
  const setActiveProvider = useWorkspaceStore((s) => s.setActiveProvider);
  // activeKeyId/activeModelId read via useByokStore.getState() inside handleSend to avoid stale closure

  useEffect(() => {
    const handleSend = (e: Event) => {
      const event = e as SendMessageEvent;
      const content = event.detail.content.trim();
      if (!content) return;

      _activeInjection?.abort();
      _activeInjection = null;

      // Re-engage auto-scroll so the AI response is visible even if user scrolled up
      dispatchScrollEvent({ type: 'LOCK_BOTTOM' });

      // Capture message count before this turn (used to slice new messages for DB save)
      const msgsBefore = (useConversationStore.getState().conversations[conversationId as string]?.messages ?? []).length;

      const now = Date.now();
      const userMsg = createMessageSnapshot({
        role: 'user',
        content,
        tokenCount: 0,
        errorCode: null,
        completedAt: now,
        createdAt: now,
        streamId: null,
        conversationId,
      });
      addMessage(conversationId, userMsg);

      // Provider priority: BYOK key → Ollama (local) → WS Anthropic → SSE Anthropic → Demo (offline)
      const _byokKeyId = useByokStore.getState().activeKeyId;
      const _byokModelId = useByokStore.getState().activeModelId;

      // BYOK delegate must be a real backend transport — never Demo.
      // Demo as delegate would silently return pre-canned responses instead of calling the user's key.
      const resolveByokDelegate = (): AIProvider | null =>
        wsAIProvider.isAvailable
          ? aiProviderRegistry.get('ws-anthropic') ?? null
          : anthropicAdapter.isAvailable
            ? aiProviderRegistry.get('anthropic') ?? null
            : null; // No real backend reachable → BYOK unavailable

      const byokDelegate = _byokKeyId ? resolveByokDelegate() : null;

      const provider = (_byokKeyId && byokDelegate)
        ? new BYOKAdapter({
            keyId: _byokKeyId,
            providerId: useByokStore.getState().keys.find((k) => k.id === _byokKeyId)?.providerId ?? 'byok',
            modelId: _byokModelId,
            delegate: byokDelegate,
          })
        : ollamaAdapter.isAvailable
          ? aiProviderRegistry.get('ollama')
          : wsAIProvider.isAvailable
            ? aiProviderRegistry.get('ws-anthropic')
            : anthropicAdapter.isAvailable
              ? aiProviderRegistry.get('anthropic')
              : aiProviderRegistry.get('demo');

      // Guard: if BYOK key is active but no real backend is reachable, show error instead of Demo fallback
      if (_byokKeyId && !byokDelegate) {
        const errNow = Date.now();
        const errMsg = createMessageSnapshot({
          role: 'assistant',
          content: '⚠ No backend connection available. Your API key is active but the server is unreachable. Check that the backend is running.',
          tokenCount: 0,
          errorCode: 'backend_unavailable',
          completedAt: errNow,
          createdAt: errNow,
          streamId: null,
          conversationId,
        });
        addMessage(conversationId, errMsg);
        // Dispatch abort so InputBar's submitting flag clears (no stream was started)
        window.dispatchEvent(new CustomEvent('pulse:abort-stream', { bubbles: true }));
        return;
      }

      setActiveProvider(provider!.name);

      // Build full conversation history for multi-turn context.
      // Read after addMessage so the new user msg is included.
      // Truncate to last 40 messages (~20 turns) to stay within context budget.
      const MAX_HISTORY = 40;
      const allMessages = useConversationStore.getState().conversations[conversationId as string]?.messages ?? [];
      const historySlice = allMessages.length > MAX_HISTORY
        ? allMessages.slice(allMessages.length - MAX_HISTORY)
        : allMessages;
      const messages = historySlice.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      const streamId = `ai-${Date.now()}` as StreamId;

      const injector = new StreamInjector(renderPipeline, provider!);
      const injection = injector.inject({
        messages,
        streamId,
        conversationId,
        options: { conversationId: conversationId as string, systemPrompt: SYSTEM_PROMPT },
      });

      _activeInjection = injection;
      injection.completion.then(async () => {
        // Persist messages for browser-side providers (Ollama, Demo, SSE).
        // WS path saves server-side in ai-stream-handler — skip to avoid duplicates.
        if (provider.name !== 'ws-anthropic') {
          const allMsgs = useConversationStore.getState().conversations[conversationId as string]?.messages ?? [];
          const newMsgs = allMsgs.slice(msgsBefore);
          if (newMsgs.length > 0) {
            void saveMessages(
              conversationId as string,
              newMsgs.map((m) => ({
                role: m.role as 'user' | 'assistant',
                content: m.content,
                token_count: m.tokenCount,
              })),
            );
          }
        }

        // Auto-title: if this is the first message in a new session, derive title
        const session = useWorkspaceStore.getState().sessions.find((s) => s.id === conversationId);
        if (session && session.title === 'New session') {
          const autoTitle = content.slice(0, 60).replace(/\s+/g, ' ').trim();
          if (autoTitle.length > 0) {
            renameSessionStore(conversationId, autoTitle);
            void renameConversation(conversationId as string, autoTitle);
          }
        }
      }).finally(() => {
        if (_activeInjection === injection) _activeInjection = null;
      });
    };

    const handleAbort = () => {
      _activeInjection?.abort();
      _activeInjection = null;
    };

    const handleRegenerate = (e: Event) => {
      const event = e as CustomEvent<{ upToMessageId: string }>;
      const { upToMessageId } = event.detail;

      const allMessages = useConversationStore.getState().conversations[conversationId as string]?.messages ?? [];
      const targetIdx = allMessages.findIndex((m) => (m.id as string) === upToMessageId);
      if (targetIdx <= 0) return;

      const historyBeforeRegen = allMessages.slice(0, targetIdx);
      if (historyBeforeRegen.length === 0) return;

      const lastMsg = historyBeforeRegen[historyBeforeRegen.length - 1];
      if (!lastMsg || lastMsg.role !== 'user') return;

      _activeInjection?.abort();
      _activeInjection = null;
      dispatchScrollEvent({ type: 'LOCK_BOTTOM' });

      const regenMsgsBefore = (useConversationStore.getState().conversations[conversationId as string]?.messages ?? []).length;

      const messages = historyBeforeRegen.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      const streamId = `ai-regen-${Date.now()}` as StreamId;
      const _regenByokKeyId = useByokStore.getState().activeKeyId;
      const _regenByokModelId = useByokStore.getState().activeModelId;
      const resolveRegenDelegate = () =>
        wsAIProvider.isAvailable ? aiProviderRegistry.get('ws-anthropic')
        : anthropicAdapter.isAvailable ? aiProviderRegistry.get('anthropic')
        : aiProviderRegistry.get('demo');
      const provider = _regenByokKeyId
        ? new BYOKAdapter({
            keyId: _regenByokKeyId,
            providerId: useByokStore.getState().keys.find((k) => k.id === _regenByokKeyId)?.providerId ?? 'byok',
            modelId: _regenByokModelId,
            delegate: resolveRegenDelegate(),
          })
        : ollamaAdapter.isAvailable
          ? aiProviderRegistry.get('ollama')
          : wsAIProvider.isAvailable
            ? aiProviderRegistry.get('ws-anthropic')
            : anthropicAdapter.isAvailable
              ? aiProviderRegistry.get('anthropic')
              : aiProviderRegistry.get('demo');
      setActiveProvider(provider.name);

      const injector = new StreamInjector(renderPipeline, provider!);
      const injection = injector.inject({
        messages,
        streamId,
        conversationId,
        options: { conversationId: conversationId as string, systemPrompt: SYSTEM_PROMPT },
      });

      _activeInjection = injection;
      injection.completion.then(async () => {
        if (provider.name !== 'ws-anthropic') {
          const allMsgs = useConversationStore.getState().conversations[conversationId as string]?.messages ?? [];
          const newMsgs = allMsgs.slice(regenMsgsBefore);
          if (newMsgs.length > 0) {
            void saveMessages(
              conversationId as string,
              newMsgs.map((m) => ({
                role: m.role as 'user' | 'assistant',
                content: m.content,
                token_count: m.tokenCount,
              })),
            );
          }
        }
      }).finally(() => {
        if (_activeInjection === injection) _activeInjection = null;
      });
    };

    window.addEventListener('pulse:send-message', handleSend as EventListener);
    window.addEventListener('pulse:abort-stream', handleAbort);
    window.addEventListener('pulse:regenerate', handleRegenerate as EventListener);

    return () => {
      window.removeEventListener('pulse:send-message', handleSend as EventListener);
      window.removeEventListener('pulse:abort-stream', handleAbort);
      window.removeEventListener('pulse:regenerate', handleRegenerate as EventListener);
      _activeInjection?.abort();
    };
  }, [conversationId, addMessage, dispatchScrollEvent, renameSessionStore, setActiveProvider]);
}

// ─── Right dock ───────────────────────────────────────────────────────────────

const DOCK_WIDTH = 320;

function RightDock() {
  const panel = useWorkspaceStore(selectDockPanel);

  return (
    <aside
      className="pane"
      aria-label={
        panel === 'chaos' ? 'Chaos simulation controls'
        : panel === 'telemetry' ? 'Telemetry'
        : panel === 'benchmark' ? 'Benchmark runner'
        : undefined
      }
      style={{
        width: panel !== null ? DOCK_WIDTH : 0,
        flexShrink: 0,
        borderLeft: panel !== null ? '1px solid var(--border)' : 'none',
        borderRight: 'none',
        overflow: 'hidden',
        transition: 'width 150ms ease-out',
      }}
    >
      <div style={{ width: DOCK_WIDTH, height: '100%', overflow: 'hidden' }}>
        {panel === 'chaos' && <ChaosPanel />}
        {panel === 'telemetry' && <TelemetryDock />}
        {panel === 'benchmark' && <BenchmarkPanel />}
      </div>
    </aside>
  );
}

// ─── Conversation pane ────────────────────────────────────────────────────────

function ConversationPane({ conversationId }: { conversationId: ConversationId }) {
  const messages = useConversationStore(selectMessages(conversationId));
  const streamCount = useStreamStore(selectStreamCount);
  const dispatchScrollEvent = useUIStore((s) => s.dispatchScrollEvent);

  // Lock to bottom whenever the active conversation changes
  useEffect(() => {
    dispatchScrollEvent({ type: 'LOCK_BOTTOM' });
  }, [conversationId, dispatchScrollEvent]);

  useAIController(conversationId);

  const isEmpty = messages.length === 0 && streamCount === 0;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
      <ReconnectBanner />
      <ReplayIndicator />
      <WorkspaceErrorBoundary name="conversation-pane">
        {isEmpty ? (
          <EmptyWorkspace />
        ) : (
          <MessageList conversationId={conversationId} style={{ flex: 1 }} />
        )}
      </WorkspaceErrorBoundary>
      <InputBar />
    </div>
  );
}

// ─── Simulation controller ────────────────────────────────────────────────────

function useSimulationController() {
  const simulatorRef = useRef<StreamSimulator | null>(null);
  const setRunning = useWorkspaceStore((s) => s.setSimulationRunning);
  const setProgress = useWorkspaceStore((s) => s.setSimulationProgress);

  useEffect(() => {
    const handleRun = async (e: Event) => {
      const event = e as CustomEvent<{ scenario: ScenarioName }>;
      const scenario = scenarios[event.detail.scenario];
      if (!scenario) return;

      const pipeline = (window as unknown as Record<string, unknown>)['__pulsePipeline'] as RenderPipeline | undefined;
      if (!pipeline) return;

      const sim = new StreamSimulator(scenario.simulator);
      simulatorRef.current = sim;
      const transport = sim.createTransport();

      setRunning(true, event.detail.scenario);
      await transport.connect('sim://');
      pipeline.connect(transport);

      const startAt = Date.now();
      const ticker = setInterval(() => {
        setProgress(Math.min(0.99, (Date.now() - startAt) / scenario.expectedDurationMs));
      }, 200);

      try {
        await sim.run();
      } finally {
        clearInterval(ticker);
        setProgress(1);
        pipeline.disconnect();
        setRunning(false);
        simulatorRef.current = null;
        setTimeout(() => setProgress(0), 500);
      }
    };

    const handleStop = () => simulatorRef.current?.stop();

    window.addEventListener('pulse:run-simulation', handleRun as EventListener);
    window.addEventListener('pulse:stop-simulation', handleStop);

    return () => {
      window.removeEventListener('pulse:run-simulation', handleRun as EventListener);
      window.removeEventListener('pulse:stop-simulation', handleStop);
      simulatorRef.current?.stop();
    };
  }, [setRunning, setProgress]);
}

// ─── Global keyboard shortcuts ────────────────────────────────────────────────

function useGlobalKeyboardShortcuts() {
  const dispatchScrollEvent = useUIStore((s) => s.dispatchScrollEvent);
  const toggleDockPanel = useWorkspaceStore((s) => s.toggleDockPanel);
  const streamCount = useStreamStore(selectStreamCount);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      // ⌘ shortcuts work everywhere
      if (e.metaKey || e.ctrlKey) {
        if (e.key === 'k') {
          e.preventDefault();
          document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message input"]')?.focus();
          return;
        }
        if (e.key === 'd') {
          e.preventDefault();
          toggleDockPanel('telemetry');
          return;
        }
        if (e.shiftKey && e.key === 'C') {
          e.preventDefault();
          toggleDockPanel('chaos');
          return;
        }
        if (e.shiftKey && e.key === 'B') {
          e.preventDefault();
          toggleDockPanel('benchmark');
          return;
        }
        return;
      }

      // Non-⌘ shortcuts: skip if in input
      if (inInput) return;

      if (e.key === 'j' || e.key === 'J') {
        dispatchScrollEvent({ type: 'LOCK_BOTTOM' });
        return;
      }
      if (e.key === 'Escape' && streamCount > 0) {
        window.dispatchEvent(new CustomEvent('pulse:abort-stream', { bubbles: true }));
        return;
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [dispatchScrollEvent, toggleDockPanel, streamCount]);
}

// ─── WorkspaceLayout ──────────────────────────────────────────────────────────

export function WorkspaceLayout() {
  const activeSessionId = useWorkspaceStore(selectActiveSessionId);
  const dockPanel = useWorkspaceStore(selectDockPanel);
  const mobileSidebarOpen = useWorkspaceStore(selectMobileSidebarOpen);
  const setMobileSidebarOpen = useWorkspaceStore((s) => s.setMobileSidebarOpen);

  useWorkspaceBootstrap();
  useSimulationController();
  useGlobalKeyboardShortcuts();

  return (
    <div className="pulse-app">
      <TopNav />

      <div className={`workspace${dockPanel === null ? ' no-right' : ''}`} style={{ flex: 1 }}>
        {/* Mobile sidebar backdrop */}
        {mobileSidebarOpen && (
          <div
            className="mobile-sidebar-backdrop"
            onClick={() => setMobileSidebarOpen(false)}
            aria-hidden
          />
        )}

        {/* Sidebar — normal flow on desktop, overlay on mobile */}
        <div className={`sidebar-wrapper${mobileSidebarOpen ? ' open' : ''}`}>
          <Sidebar onNavigate={() => setMobileSidebarOpen(false)} />
        </div>

        <ConversationPane conversationId={activeSessionId} />
        {dockPanel !== null && <RightDock />}
      </div>

      <SystemStatusBar />
      <SettingsPanel />
    </div>
  );
}

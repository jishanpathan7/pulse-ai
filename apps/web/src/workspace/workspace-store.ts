/**
 * workspaceStore — workspace-level UI state.
 *
 * Strictly presentation state: what panels are open, sidebar collapsed, etc.
 * Does NOT duplicate transport/stream/conversation data — reads come from
 * their respective stores.
 *
 * Invariant: this store has no knowledge of message content or streaming
 * mechanics. It manages layout and panel visibility only.
 *
 * Stub sessions:
 *   sessions[] is seeded with static stubs in Phase 6.
 *   Phase 7 (auth + backend) replaces with real session data.
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { ConversationId } from '@pulse/types/transport';

// ─── Session stub ─────────────────────────────────────────────────────────────

export interface WorkspaceSession {
  readonly id: ConversationId;
  readonly title: string;
  readonly createdAt: number;
  readonly messageCount: number;
  readonly isStreaming: boolean;
  readonly pinned: boolean;
}

// Seeded stubs — replaced by real data in Phase 7.
const STUB_SESSIONS: WorkspaceSession[] = [
  {
    id: 'conv-stub-01' as ConversationId,
    title: 'Realtime pipeline analysis',
    createdAt: Date.now() - 3_600_000,
    messageCount: 0,
    isStreaming: false,
    pinned: false,
  },
];

// ─── Dock panel IDs ───────────────────────────────────────────────────────────

export type DockPanelId = 'chaos' | 'telemetry' | 'benchmark' | null;

// ─── State / Actions ──────────────────────────────────────────────────────────

interface WorkspaceState {
  readonly sessions: ReadonlyArray<WorkspaceSession>;
  readonly activeSessionId: ConversationId;
  readonly sidebarCollapsed: boolean;
  readonly mobileSidebarOpen: boolean;
  readonly dockPanel: DockPanelId;
  /** True while a simulation is running (StreamSimulator). */
  readonly simulationRunning: boolean;
  readonly simulationScenario: string | null;
  readonly simulationProgress: number; // 0–1
  /** Name of the AI provider currently answering (e.g. 'ollama', 'demo'). */
  readonly activeProvider: string;
}

interface WorkspaceActions {
  setActiveSession: (id: ConversationId) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  toggleMobileSidebar: () => void;
  setMobileSidebarOpen: (open: boolean) => void;
  openDockPanel: (panel: DockPanelId) => void;
  closeDockPanel: () => void;
  toggleDockPanel: (panel: Exclude<DockPanelId, null>) => void;
  setSimulationRunning: (running: boolean, scenario?: string) => void;
  setSimulationProgress: (progress: number) => void;
  addSession: (session: WorkspaceSession) => void;
  /** Replace all sessions (used on workspace bootstrap to clear stubs). */
  setSessions: (sessions: WorkspaceSession[]) => void;
  updateSessionStreamingState: (id: ConversationId, isStreaming: boolean) => void;
  renameSession: (id: ConversationId, title: string) => void;
  deleteSession: (id: ConversationId) => void;
  pinSession: (id: ConversationId, pinned: boolean) => void;
  setActiveProvider: (name: string) => void;
}

const INITIAL_STATE: WorkspaceState = {
  sessions: STUB_SESSIONS,
  activeSessionId: STUB_SESSIONS[0]!.id,
  sidebarCollapsed: false,
  mobileSidebarOpen: false,
  dockPanel: null,
  simulationRunning: false,
  simulationScenario: null,
  simulationProgress: 0,
  activeProvider: 'demo',
};

export const useWorkspaceStore = create<WorkspaceState & WorkspaceActions>()(
  subscribeWithSelector((set) => ({
    ...INITIAL_STATE,

    setActiveSession: (id) => set({ activeSessionId: id }),

    toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

    setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),

    toggleMobileSidebar: () => set((s) => ({ mobileSidebarOpen: !s.mobileSidebarOpen })),

    setMobileSidebarOpen: (mobileSidebarOpen) => set({ mobileSidebarOpen }),

    openDockPanel: (panel) => set({ dockPanel: panel }),

    closeDockPanel: () => set({ dockPanel: null }),

    toggleDockPanel: (panel) =>
      set((s) => ({ dockPanel: s.dockPanel === panel ? null : panel })),

    setSimulationRunning: (simulationRunning, scenario) =>
      set({
        simulationRunning,
        simulationScenario: scenario ?? null,
        simulationProgress: simulationRunning ? 0 : 0,
      }),

    setSimulationProgress: (simulationProgress) => set({ simulationProgress }),

    addSession: (session) =>
      set((s) => ({
        sessions: s.sessions.some((x) => x.id === session.id)
          ? s.sessions
          : [...s.sessions, session],
      })),

    setSessions: (sessions) => set({ sessions }),

    updateSessionStreamingState: (id, isStreaming) =>
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === id ? { ...sess, isStreaming } : sess,
        ),
      })),

    renameSession: (id, title) =>
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === id ? { ...sess, title } : sess,
        ),
      })),

    deleteSession: (id) =>
      set((s) => {
        const remaining = s.sessions.filter((sess) => sess.id !== id);
        const newActive = s.activeSessionId === id
          ? (remaining[0]?.id ?? s.activeSessionId)
          : s.activeSessionId;
        return { sessions: remaining, activeSessionId: newActive };
      }),

    pinSession: (id, pinned) =>
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === id ? { ...sess, pinned } : sess,
        ),
      })),

    setActiveProvider: (activeProvider) => set({ activeProvider }),
  })),
);

// ─── Selectors ────────────────────────────────────────────────────────────────

export const selectSidebarCollapsed = (s: WorkspaceState & WorkspaceActions) =>
  s.sidebarCollapsed;

export const selectMobileSidebarOpen = (s: WorkspaceState & WorkspaceActions) =>
  s.mobileSidebarOpen;

export const selectDockPanel = (s: WorkspaceState & WorkspaceActions) =>
  s.dockPanel;

export const selectActiveSessionId = (s: WorkspaceState & WorkspaceActions) =>
  s.activeSessionId;

export const selectSessions = (s: WorkspaceState & WorkspaceActions) =>
  s.sessions;

export const selectSimulationRunning = (s: WorkspaceState & WorkspaceActions) =>
  s.simulationRunning;

export const selectSimulationProgress = (s: WorkspaceState & WorkspaceActions) =>
  s.simulationProgress;

export const selectSimulationScenario = (s: WorkspaceState & WorkspaceActions) =>
  s.simulationScenario;

export const selectActiveProvider = (s: WorkspaceState & WorkspaceActions) =>
  s.activeProvider;

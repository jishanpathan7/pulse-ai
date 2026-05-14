import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  useWorkspaceStore,
  selectSessions,
  selectActiveSessionId,
} from '../../../workspace/workspace-store.js';
import type { WorkspaceSession } from '../../../workspace/workspace-store.js';
import { useStreamStore, selectStreamCount } from '../../../store/stream-store.js';
import { useConversationStore } from '../../../store/conversation-store.js';
import {
  createConversation,
  getMessages,
  renameConversation,
  deleteConversation,
  pinConversation,
} from '../../../api/conversations-client.js';
import { createMessageSnapshot } from '../../../render/snapshot.js';
import type { ConversationId } from '@pulse/types/transport';

// ─── Context menu ──────────────────────────────────────────────────────────────

interface ContextMenuProps {
  session: WorkspaceSession;
  anchor: { x: number; y: number };
  onClose: () => void;
  onRename: () => void;
  onPin: () => void;
  onDelete: () => void;
}

function ContextMenu({ session, anchor, onClose, onRename, onPin, onDelete }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: anchor.x,
        top: anchor.y,
        zIndex: 1000,
        background: 'var(--bg-2)',
        border: '1px solid var(--border-2)',
        borderRadius: 4,
        padding: '4px 0',
        minWidth: 148,
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
      }}
    >
      {([
        { label: 'Rename', action: onRename },
        { label: session.pinned ? 'Unpin' : 'Pin', action: onPin },
        { label: 'Delete', action: onDelete, danger: true },
      ] as Array<{ label: string; action: () => void; danger?: boolean }>).map(({ label, action, danger }) => (
        <button
          key={label}
          onClick={() => { action(); onClose(); }}
          style={{
            display: 'block',
            width: '100%',
            background: 'none',
            border: 'none',
            textAlign: 'left',
            padding: '5px 12px',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.06em',
            color: danger === true ? 'var(--red, #e06060)' : 'var(--text-2)',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--border)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ─── Session row ──────────────────────────────────────────────────────────────

interface SessionRowProps {
  session: WorkspaceSession;
  isActive: boolean;
  isStreaming: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  isRenaming: boolean;
  onRenameCommit: (title: string) => void;
  onRenameCancel: () => void;
}

const SessionRow = React.memo(function SessionRow({
  session,
  isActive,
  isStreaming,
  onClick,
  onContextMenu,
  isRenaming,
  onRenameCommit,
  onRenameCancel,
}: SessionRowProps) {
  const [draft, setDraft] = useState(session.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming) {
      setDraft(session.title);
      setTimeout(() => { inputRef.current?.select(); }, 0);
    }
  }, [isRenaming, session.title]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); onRenameCommit(draft.trim() || session.title); }
    if (e.key === 'Escape') { e.preventDefault(); onRenameCancel(); }
  };

  return (
    <div
      className={`sb-row${isActive ? ' active' : ''}`}
      onClick={isRenaming ? undefined : onClick}
      onContextMenu={onContextMenu}
      role={isRenaming ? undefined : 'button'}
      tabIndex={isRenaming ? undefined : 0}
      onKeyDown={isRenaming ? undefined : (e) => e.key === 'Enter' && onClick()}
    >
      <span
        className="sb-icon"
        aria-hidden
        style={{
          width: 6, height: 6, flexShrink: 0,
          background: isStreaming
            ? 'var(--accent)'
            : session.pinned
              ? 'var(--text-3)'
              : isActive ? 'var(--border-3)' : 'transparent',
          border: `1px solid ${
            isStreaming ? 'var(--accent)' : session.pinned ? 'var(--text-3)' : isActive ? 'var(--border-3)' : 'var(--border-2)'
          }`,
          display: 'inline-block',
          animation: isStreaming ? 'status-pulse 1s ease-in-out infinite' : undefined,
        }}
      />

      {isRenaming ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => onRenameCommit(draft.trim() || session.title)}
          autoFocus
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: '1px solid var(--accent)',
            borderRadius: 2,
            color: 'var(--text)',
            fontFamily: 'var(--font-body)',
            fontSize: 12,
            padding: '1px 3px',
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {session.title}
        </span>
      )}

      {session.messageCount > 0 && !isRenaming && (
        <span className="sb-meta">{session.messageCount}</span>
      )}
    </div>
  );
});

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export const Sidebar = React.memo(function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const sessions = useWorkspaceStore(selectSessions);
  const activeId = useWorkspaceStore(selectActiveSessionId);
  const setActive = useWorkspaceStore((s) => s.setActiveSession);
  const addSession = useWorkspaceStore((s) => s.addSession);
  const streamCount = useStreamStore(selectStreamCount);
  const loadMessages = useConversationStore((s) => s.loadMessages);
  const ensureConversation = useConversationStore((s) => s.ensureConversation);
  const renameSessionStore = useWorkspaceStore((s) => s.renameSession);
  const deleteSessionStore = useWorkspaceStore((s) => s.deleteSession);
  const pinSessionStore = useWorkspaceStore((s) => s.pinSession);

  const [creating, setCreating] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ session: WorkspaceSession; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  // Pinned first, then by createdAt desc
  const sorted = [...sessions].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.createdAt - a.createdAt;
  });

  const pinned = sorted.filter((s) => s.pinned);
  const unpinned = sorted.filter((s) => !s.pinned);

  // ── Switch conversation ────────────────────────────────────────────────────

  const handleSwitch = useCallback(async (session: WorkspaceSession) => {
    setActive(session.id);
    onNavigate?.();

    const existing = useConversationStore.getState().conversations[session.id as string];
    if (existing !== undefined && existing.messages.length > 0) return;

    ensureConversation(session.id);

    const msgs = await getMessages(session.id as string);
    if (msgs.length === 0) return;

    const snapshots = msgs.map((m) =>
      createMessageSnapshot({
        role: m.role,
        content: m.content,
        tokenCount: m.token_count,
        errorCode: null,
        completedAt: m.completed_at ? new Date(m.completed_at).getTime() : Date.now(),
        createdAt: new Date(m.created_at).getTime(),
        streamId: null,
        conversationId: session.id,
      }),
    );
    loadMessages(session.id, snapshots);
  }, [setActive, ensureConversation, loadMessages]);

  // ── New conversation ───────────────────────────────────────────────────────

  const handleNew = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const created = await createConversation('New session');
      if (!created) return;

      const session: WorkspaceSession = {
        id: created.id as ConversationId,
        title: created.title,
        createdAt: new Date(created.created_at).getTime(),
        messageCount: 0,
        isStreaming: false,
        pinned: false,
      };

      addSession(session);
      ensureConversation(session.id);
      setActive(session.id);
    } finally {
      setCreating(false);
    }
  }, [creating, addSession, ensureConversation, setActive]);

  // ── Context menu actions ───────────────────────────────────────────────────

  const handleContextMenu = useCallback((e: React.MouseEvent, session: WorkspaceSession) => {
    e.preventDefault();
    setContextMenu({ session, x: e.clientX, y: e.clientY });
  }, []);

  const handleRenameCommit = useCallback(async (id: string, title: string) => {
    setRenamingId(null);
    renameSessionStore(id as ConversationId, title);
    await renameConversation(id, title);
  }, [renameSessionStore]);

  const handlePin = useCallback(async (session: WorkspaceSession) => {
    const newPinned = !session.pinned;
    pinSessionStore(session.id, newPinned);
    await pinConversation(session.id as string, newPinned);
  }, [pinSessionStore]);

  const handleDelete = useCallback(async (session: WorkspaceSession) => {
    const ok = await deleteConversation(session.id as string);
    if (ok) deleteSessionStore(session.id);
  }, [deleteSessionStore]);

  // ── Row renderer ───────────────────────────────────────────────────────────

  const renderRow = (session: WorkspaceSession) => (
    <SessionRow
      key={session.id as string}
      session={session}
      isActive={session.id === activeId}
      isStreaming={session.isStreaming || (session.id === activeId && streamCount > 0)}
      onClick={() => void handleSwitch(session)}
      onContextMenu={(e) => handleContextMenu(e, session)}
      isRenaming={renamingId === (session.id as string)}
      onRenameCommit={(title) => void handleRenameCommit(session.id as string, title)}
      onRenameCancel={() => setRenamingId(null)}
    />
  );

  return (
    <nav
      aria-label="Workspace sessions"
      className="pane"
      style={{ width: 244, flexShrink: 0 }}
    >
      {/* Header */}
      <div className="sb-search">
        <span aria-hidden style={{ color: 'var(--text-4)', fontSize: 11 }}>⌕</span>
        <span style={{ color: 'var(--text-4)' }}>Sessions</span>
        <span style={{ marginLeft: 'auto', color: 'var(--text-4)', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
          {sessions.length}
        </span>
      </div>

      {/* Session list */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>

        {pinned.length > 0 && (
          <div className="sb-section">
            <div className="t-label" style={{ marginBottom: 6 }}>Pinned</div>
            {pinned.map(renderRow)}
          </div>
        )}

        <div className="sb-section">
          {pinned.length > 0 && unpinned.length > 0 && (
            <div className="t-label" style={{ marginBottom: 6 }}>Recent</div>
          )}
          {sessions.length === 0 && (
            <div style={{ color: 'var(--text-4)', fontSize: 12, padding: '8px 6px' }}>
              No sessions yet
            </div>
          )}
          {unpinned.map(renderRow)}
        </div>

        {/* New session button */}
        <div className="sb-section" style={{ paddingTop: 8 }}>
          <div
            className="sb-row"
            style={{
              color: creating ? 'var(--text-4)' : 'var(--text-3)',
              cursor: creating ? 'not-allowed' : 'pointer',
            }}
            role="button"
            tabIndex={0}
            onClick={() => void handleNew()}
            onKeyDown={(e) => e.key === 'Enter' && void handleNew()}
            aria-disabled={creating}
          >
            <span aria-hidden style={{ fontSize: 10, color: 'var(--text-4)' }}>
              {creating ? '…' : '+'}
            </span>
            <span>{creating ? 'Creating…' : 'New session'}</span>
          </div>
        </div>
      </div>

      {/* Footer: WS state */}
      <div style={{
        padding: '8px 12px',
        borderTop: '1px solid var(--border)',
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--text-4)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexShrink: 0,
      }}>
        <span aria-hidden style={{
          width: 5, height: 5,
          background: streamCount > 0 ? 'var(--accent)' : 'var(--green)',
          animation: streamCount > 0 ? 'status-pulse 1s ease-in-out infinite' : undefined,
        }} />
        {streamCount > 0 ? `${streamCount} stream${streamCount !== 1 ? 's' : ''} active` : 'Ready'}
      </div>

      {/* Context menu */}
      {contextMenu !== null && (
        <ContextMenu
          session={contextMenu.session}
          anchor={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          onRename={() => setRenamingId(contextMenu.session.id as string)}
          onPin={() => void handlePin(contextMenu.session)}
          onDelete={() => void handleDelete(contextMenu.session)}
        />
      )}
    </nav>
  );
});

Sidebar.displayName = 'Sidebar';

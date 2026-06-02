import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useStreamStore, selectStreamCount } from '../../store/stream-store.js';
import { useWorkspaceStore, selectActiveProvider, selectActiveSessionId } from '../../workspace/workspace-store.js';
import { useByokStore, selectActiveKeyId, selectActiveModelId, selectByokKeys, selectModelsByKeyId } from '../../store/byok-store.js';
import { useUIStore } from '../../store/ui-store.js';
import { useConversationStore, selectMessages } from '../../store/conversation-store.js';

export interface SendMessageEvent extends CustomEvent {
  detail: { content: string };
}

// ─── Slash commands ───────────────────────────────────────────────────────────

const SLASH_COMMANDS = [
  { cmd: '/profile',   desc: 'Frame-commit profiler',        kbd: '⌘1', prompt: 'Profile the token streaming pipeline. Measure each stage: decode, append, render, and commit. Show frame time budget and where latency is spent.' },
  { cmd: '/replay',    desc: 'Replay from sequence offset',  kbd: '⌘2', prompt: 'Explain how sequence-aware replay recovery works in a WebSocket streaming system. Walk through the reconnect flow step by step.' },
  { cmd: '/snapshot',  desc: 'Telemetry snapshot analysis',  kbd: '⌘3', prompt: 'Analyze a telemetry snapshot from a streaming session. What metrics matter most for diagnosing latency spikes?' },
  { cmd: '/diff',      desc: 'Compare two responses',        kbd: '⌘4', prompt: 'Help me diff two AI response payloads to identify what changed between them.' },
  { cmd: '/trace',     desc: 'Open trace viewer',            kbd: '⌘5', prompt: 'Walk me through reading a distributed trace from an AI streaming request. What spans should I look for?' },
  { cmd: '/benchmark', desc: 'Run stress scenarios',         kbd: '⌘B', prompt: 'Design a benchmark suite for a token streaming pipeline. What scenarios should I stress test?' },
] as const;

type SlashCommand = typeof SLASH_COMMANDS[number];

function filterCommands(value: string): SlashCommand[] {
  if (!value.startsWith('/')) return [];
  const query = value.slice(1).toLowerCase();
  if (query === '') return [...SLASH_COMMANDS];
  return SLASH_COMMANDS.filter(
    (c) => c.cmd.slice(1).startsWith(query) || c.desc.toLowerCase().includes(query),
  );
}

// ─── SlashMenu ────────────────────────────────────────────────────────────────

interface SlashMenuProps {
  commands: SlashCommand[];
  selectedIndex: number;
  onSelect: (cmd: SlashCommand) => void;
}

function SlashMenu({ commands, selectedIndex, onSelect }: SlashMenuProps) {
  if (commands.length === 0) return null;
  return (
    <div className="slash-menu">
      <div className="sm-head">Commands</div>
      {commands.map((c, i) => (
        <div
          key={c.cmd}
          className={`sm-row${i === selectedIndex ? ' selected' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); onSelect(c); }}
        >
          <span className="sm-cmd">{c.cmd}</span>
          <span className="sm-desc">{c.desc}</span>
          <span className="sm-kbd">{c.kbd}</span>
        </div>
      ))}
    </div>
  );
}

// ─── InputBar ─────────────────────────────────────────────────────────────────

export function InputBar() {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streamCount = useStreamStore(selectStreamCount);
  const isStreaming = streamCount > 0;
  const activeProvider = useWorkspaceStore(selectActiveProvider);
  const activeKeyId = useByokStore(selectActiveKeyId);
  const activeModelId = useByokStore(selectActiveModelId);
  const byokKeys = useByokStore(selectByokKeys);
  const activeKey = byokKeys.find((k) => k.id === activeKeyId);
  const openSettings = useUIStore((s) => s.openPanel);

  // Clear local submitting flag once streamStore picks up the stream
  useEffect(() => {
    if (isStreaming) setSubmitting(false);
  }, [isStreaming]);

  // Also clear submitting if abort is dispatched externally (e.g. BYOK early-error path)
  useEffect(() => {
    const onAbort = () => setSubmitting(false);
    window.addEventListener('pulse:abort-stream', onAbort);
    return () => window.removeEventListener('pulse:abort-stream', onAbort);
  }, []);

  const blocked = isStreaming || submitting;

  // Context window usage
  const activeSessionId = useWorkspaceStore(selectActiveSessionId);
  const modelsByKeyId = useByokStore(selectModelsByKeyId);
  const messages = useConversationStore(selectMessages(activeSessionId as string));
  const usedTokens = messages.reduce((sum, m) => sum + (m.tokenCount ?? 0), 0);
  const activeModel = activeKeyId ? (modelsByKeyId[activeKeyId] ?? []).find((m) => m.id === activeModelId) : null;
  const maxTokens = activeModel?.contextWindow ?? 128_000;
  const ctxPct = Math.min(usedTokens / maxTokens, 1);
  const ctxColor = ctxPct >= 0.95 ? 'var(--red)' : ctxPct >= 0.8 ? 'var(--yellow)' : 'var(--green-dim)';

  const slashCommands = value.startsWith('/') && focused ? filterCommands(value) : [];
  const showMenu = slashCommands.length > 0;

  // Reset selected index when filtered commands change
  useEffect(() => {
    setSelectedIndex(0);
  }, [slashCommands.length]);

  const selectSlashCommand = useCallback((cmd: SlashCommand) => {
    setValue(cmd.prompt);
    setSelectedIndex(0);
    // Resize textarea after value change
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
        el.focus();
      }
    });
  }, []);

  const submit = useCallback(() => {
    const content = value.trim();
    if (!content || isStreaming || submitting) return;
    setSubmitting(true);  // immediately block re-sends before streamStore updates
    window.dispatchEvent(new CustomEvent('pulse:send-message', { detail: { content }, bubbles: true }) as SendMessageEvent);
    setValue('');
    textareaRef.current?.focus();
  }, [value, isStreaming, submitting]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, slashCommands.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = slashCommands[selectedIndex];
        if (cmd) selectSlashCommand(cmd);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setValue('');
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    if (e.key === 'Escape' && blocked) window.dispatchEvent(new CustomEvent('pulse:abort-stream', { bubbles: true }));
  }, [submit, isStreaming, showMenu, slashCommands, selectedIndex, selectSlashCommand]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  return (
    <div className="composer" role="form" aria-label="Send a message">
      <div className={`composer-shell${focused ? ' focused' : ''}`} style={{ position: 'relative' }}>
        {/* Slash command menu */}
        {showMenu && (
          <SlashMenu
            commands={slashCommands}
            selectedIndex={selectedIndex}
            onSelect={selectSlashCommand}
          />
        )}

        {/* Text area */}
        <div className="composer-input">
          {value.length === 0 && !focused && (
            <span className="placeholder" style={{ position: 'absolute', pointerEvents: 'none' }}>
              {blocked
                ? 'Waiting for response…'
                : activeKey
                  ? <span>Ask anything… <span style={{ color: 'var(--text-4)' }}>/ for commands</span></span>
                  : <span style={{ color: 'var(--text-4)' }}>Connect an API key to start chatting →</span>
              }
            </span>
          )}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            disabled={blocked}
            aria-label="Message input"
            rows={1}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              resize: 'none',
              fontFamily: 'var(--font-body)',
              fontWeight: 300,
              fontSize: 14,
              lineHeight: '22px',
              color: 'var(--text)',
              padding: 0,
              overflowY: 'auto',
              maxHeight: 160,
              opacity: blocked ? 0.5 : 1,
              cursor: blocked ? 'not-allowed' : 'text',
            }}
          />
        </div>

        {/* Bottom bar */}
        <div className="composer-bottom">
          <div className="left">
            {blocked ? (
              <span className="stream-chip">
                <span className="chip-bar" />
                <span>Streaming</span>
              </span>
            ) : (
              <>
                {activeKey ? (
                  /* BYOK active — clickable to open settings and change key/model */
                  <button
                    className="composer-tag"
                    onClick={() => openSettings('settings')}
                    title="Click to manage API keys"
                    style={{
                      background: 'rgba(255,74,28,0.08)',
                      border: '1px solid var(--accent)',
                      borderRadius: 3,
                      color: 'var(--accent)',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      letterSpacing: '0.05em',
                      padding: '2px 8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <span style={{ fontSize: 8 }}>◉</span>
                    {activeKey.nickname ?? activeKey.providerName}
                    {activeModelId && (
                      <span style={{ opacity: 0.7 }}>· {activeModelId.split('/').pop()}</span>
                    )}
                  </button>
                ) : (
                  <>
                    {/* Provider tag — clickable, opens settings */}
                    <button
                      className="composer-tag"
                      onClick={() => openSettings('settings')}
                      title="Click to connect an API key"
                      style={{
                        background: 'none',
                        border: '1px solid var(--border)',
                        borderRadius: 3,
                        color: 'var(--text-4)',
                        cursor: 'pointer',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        letterSpacing: '0.05em',
                        padding: '2px 8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 3,
                        transition: 'color 120ms, border-color 120ms',
                      }}
                      onMouseEnter={(e) => {
                        const el = e.currentTarget;
                        el.style.color = 'var(--text-2)';
                        el.style.borderColor = 'var(--border-2)';
                      }}
                      onMouseLeave={(e) => {
                        const el = e.currentTarget;
                        el.style.color = 'var(--text-4)';
                        el.style.borderColor = 'var(--border)';
                      }}
                    >
                      <span style={{ fontSize: 8 }}>
                        {activeProvider === 'demo' ? '⚡' : '◉'}
                      </span>
                      {activeProvider === 'ollama'
                        ? 'llama3.2 · local'
                        : activeProvider === 'anthropic' || activeProvider === 'ws-anthropic'
                          ? 'Claude · 128k'
                          : 'Demo · offline'}
                    </button>
                    {/* "Connect key" nudge — only shown in demo/offline mode */}
                    {(activeProvider === 'demo') && (
                      <button
                        onClick={() => openSettings('settings')}
                        title="Connect your own API key"
                        style={{
                          background: 'none',
                          border: '1px dashed var(--accent)',
                          borderRadius: 3,
                          color: 'var(--accent)',
                          cursor: 'pointer',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10,
                          letterSpacing: '0.05em',
                          padding: '2px 8px',
                          opacity: 0.75,
                          transition: 'opacity 120ms',
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.75'; }}
                      >
                        + connect key
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </div>
          <div className="right">
            {blocked ? (
              <button
                className="send-btn cancel"
                onClick={() => window.dispatchEvent(new CustomEvent('pulse:abort-stream', { bubbles: true }))}
                aria-label="Stop generating"
              >
                ✕ Stop
              </button>
            ) : (
              <>
                <span style={{ color: 'var(--text-4)', fontSize: 9, letterSpacing: '0.1em' }}>Enter ↵</span>
                <button
                  className="send-btn"
                  onClick={submit}
                  disabled={value.trim().length === 0}
                  aria-label="Send message"
                  style={{ opacity: value.trim().length === 0 ? 0.4 : 1 }}
                >
                  Send ↑
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      {/* Context window bar — only shown when tokens are used */}
      {usedTokens > 0 && (
        <div style={{ height: 2, background: 'var(--border)', marginTop: 4, borderRadius: 1 }}>
          <div style={{
            height: '100%',
            width: `${ctxPct * 100}%`,
            background: ctxColor,
            borderRadius: 1,
            transition: 'width 300ms, background 300ms',
          }} />
        </div>
      )}
    </div>
  );
}

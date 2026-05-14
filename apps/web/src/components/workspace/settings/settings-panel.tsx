/**
 * SettingsPanel — slide-in panel for BYOK key management.
 *
 * Triggered by the gear icon in TopNav → openPanel('settings').
 * Shows one card per provider_definitions entry.
 *   Connected: key hint, validate, remove, model selector.
 *   Not connected: "Add key" button opens AddKeyForm inline.
 */

import React, { useState, useCallback } from 'react';
import { useByokStore, selectByokKeys, selectByokProviders, selectActiveKeyId, selectActiveModelId, selectModelsByKeyId } from '../../../store/byok-store.js';
import { useUIStore } from '../../../store/ui-store.js';
import { AddKeyForm } from './add-key-form.js';
import type { ConnectedKey, ProviderDefinition } from '../../../api/byok-client.js';

// ─── Provider card ─────────────────────────────────────────────────────────────

function ProviderCard({ provider, connectedKey }: { provider: ProviderDefinition; connectedKey: ConnectedKey | undefined }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [validating, setValidating] = useState(false);
  const deleteKey = useByokStore((s) => s.deleteKey);
  const validateKey = useByokStore((s) => s.validateKey);
  const loadModels = useByokStore((s) => s.loadModels);
  const setActiveKey = useByokStore((s) => s.setActiveKey);
  const setActiveModel = useByokStore((s) => s.setActiveModel);
  const activeKeyId = useByokStore(selectActiveKeyId);
  const activeModelId = useByokStore(selectActiveModelId);
  const modelsByKeyId = useByokStore(selectModelsByKeyId);

  const isActive = connectedKey && activeKeyId === connectedKey.id;
  const models = connectedKey ? (modelsByKeyId[connectedKey.id] ?? []) : [];

  const handleValidate = useCallback(async () => {
    if (!connectedKey) return;
    setValidating(true);
    await validateKey(connectedKey.id);
    setValidating(false);
  }, [connectedKey, validateKey]);

  const handleDelete = useCallback(async () => {
    if (!connectedKey) return;
    if (!window.confirm(`Remove ${provider.display_name} key (...${connectedKey.keyHint})?`)) return;
    await deleteKey(connectedKey.id);
  }, [connectedKey, deleteKey, provider.display_name]);

  const handleToggleActive = useCallback(async () => {
    if (!connectedKey) return;
    if (isActive) {
      setActiveKey(null);
      setActiveModel(null);
    } else {
      setActiveKey(connectedKey.id);
      // Load models on first activation
      if (models.length === 0) {
        await loadModels(connectedKey.id);
      }
    }
  }, [connectedKey, isActive, setActiveKey, setActiveModel, loadModels, models.length]);

  const dot = connectedKey
    ? connectedKey.isValid ? '#4caf50' : '#f44336'
    : 'var(--border)';

  return (
    <div
      style={{
        border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 6,
        padding: '10px 12px',
        marginBottom: 8,
        background: isActive ? 'rgba(255,74,28,0.04)' : 'var(--surface-1)',
        transition: 'border-color 150ms',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            aria-hidden
            style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }}
          />
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
            {provider.display_name}
          </span>
          {connectedKey && (
            <span style={{ fontSize: 11, color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>
              …{connectedKey.keyHint}
            </span>
          )}
          {connectedKey?.nickname && (
            <span style={{ fontSize: 10, color: 'var(--text-4)' }}>({connectedKey.nickname})</span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {connectedKey ? (
            <>
              <button
                onClick={() => { void handleToggleActive(); }}
                title={isActive ? 'Deactivate' : 'Use this key'}
                style={chipStyle(isActive ? 'var(--accent)' : undefined)}
              >
                {isActive ? '◉ active' : 'use'}
              </button>
              <button
                onClick={() => { void handleValidate(); }}
                disabled={validating}
                style={chipStyle()}
              >
                {validating ? '…' : 'validate'}
              </button>
              <button
                onClick={() => { void handleDelete(); }}
                style={chipStyle('var(--error, #f44)')}
              >
                remove
              </button>
            </>
          ) : (
            <button onClick={() => setShowAddForm((v) => !v)} style={chipStyle()}>
              {showAddForm ? 'cancel' : '+ add key'}
            </button>
          )}
        </div>
      </div>

      {/* Last used / validated */}
      {connectedKey && (connectedKey.lastUsedAt || connectedKey.lastValidatedAt) && (
        <p style={{ fontSize: 10, color: 'var(--text-4)', margin: '4px 0 0', fontFamily: 'var(--font-mono)' }}>
          {connectedKey.lastUsedAt
            ? `Last used ${new Date(connectedKey.lastUsedAt).toLocaleDateString()}`
            : connectedKey.lastValidatedAt
              ? `Validated ${new Date(connectedKey.lastValidatedAt).toLocaleDateString()}`
              : ''}
        </p>
      )}

      {/* Add key form */}
      {showAddForm && !connectedKey && (
        <AddKeyForm provider={provider} onDone={() => setShowAddForm(false)} />
      )}

      {/* Model selector (when active) */}
      {isActive && models.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <p style={{ fontSize: 11, color: 'var(--text-4)', margin: '0 0 4px', fontFamily: 'var(--font-mono)' }}>
            MODEL
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {models.map((m) => (
              <button
                key={m.id}
                onClick={() => setActiveModel(m.id)}
                style={{
                  ...chipStyle(activeModelId === m.id ? 'var(--accent)' : undefined),
                  fontSize: 10,
                }}
              >
                {m.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function chipStyle(color?: string): React.CSSProperties {
  return {
    background: 'none',
    border: `1px solid ${color ?? 'var(--border)'}`,
    borderRadius: 3,
    color: color ?? 'var(--text-4)',
    cursor: 'pointer',
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    letterSpacing: '0.05em',
    padding: '2px 7px',
    textTransform: 'uppercase',
    transition: 'color 100ms, border-color 100ms',
  };
}

// ─── Panel ─────────────────────────────────────────────────────────────────────

export function SettingsPanel() {
  const isOpen = useUIStore((s) => s.panels['settings'].isOpen);
  const closePanel = useUIStore((s) => s.closePanel);
  const keys = useByokStore(selectByokKeys);
  const providers = useByokStore(selectByokProviders);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={() => closePanel('settings')}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.4)',
          zIndex: 400,
        }}
      />

      {/* Panel */}
      <aside
        role="dialog"
        aria-label="Settings"
        style={{
          position: 'fixed',
          top: 0, right: 0, bottom: 0,
          width: 'min(420px, 100vw)',
          background: 'var(--surface)',
          borderLeft: '1px solid var(--border)',
          zIndex: 401,
          overflowY: 'auto',
          padding: '24px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: 'var(--text)' }}>
            API Keys
          </h2>
          <button
            onClick={() => closePanel('settings')}
            aria-label="Close settings"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-4)',
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: 1,
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        <p style={{ fontSize: 12, color: 'var(--text-4)', marginBottom: 16, lineHeight: 1.5 }}>
          Connect your own API keys. Keys are encrypted at rest and never exposed to the browser after submission.
        </p>

        {/* Provider cards */}
        {providers.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--text-4)' }}>Loading providers…</p>
        ) : (
          providers.map((p) => (
            <ProviderCard
              key={p.id}
              provider={p}
              connectedKey={keys.find((k) => k.providerId === p.id)}
            />
          ))
        )}
      </aside>
    </>
  );
}

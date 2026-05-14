/**
 * AddKeyForm — inline form to add a new BYOK API key.
 * Validates immediately on submit, shows spinner → success/error inline.
 */

import React, { useState, useRef } from 'react';
import type { ProviderDefinition } from '../../../api/byok-client.js';
import { useByokStore } from '../../../store/byok-store.js';

interface Props {
  provider: ProviderDefinition;
  onDone: () => void;
}

export function AddKeyForm({ provider, onDone }: Props) {
  const addKey = useByokStore((s) => s.addKey);
  const setActiveKey = useByokStore((s) => s.setActiveKey);
  const loadModels = useByokStore((s) => s.loadModels);
  const [rawKey, setRawKey] = useState('');
  const [nickname, setNickname] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = rawKey.trim();
    if (!key) return;

    setStatus('loading');
    setErrorMsg('');

    const result = await addKey(provider.id, key, nickname.trim() || undefined);

    if (result.ok) {
      // Auto-activate: user just added this key, make it the active one
      const newKeyId = result.key.id;
      setActiveKey(newKeyId);
      void loadModels(newKeyId); // pre-fetch models in background
      onDone();
    } else {
      setStatus('error');
      setErrorMsg(result.error ?? 'Validation failed');
    }
  };

  return (
    <form onSubmit={(e) => { void handleSubmit(e); }} style={{ marginTop: 8 }}>
      <div style={{ marginBottom: 6 }}>
        <input
          ref={inputRef}
          type="password"
          value={rawKey}
          onChange={(e) => setRawKey(e.target.value)}
          placeholder={provider.key_prefix ? `${provider.key_prefix}...` : 'Paste API key'}
          autoComplete="off"
          spellCheck={false}
          disabled={status === 'loading'}
          style={{
            width: '100%',
            background: 'var(--surface-1)',
            border: `1px solid ${status === 'error' ? 'var(--error, #f44)' : 'var(--border)'}`,
            borderRadius: 4,
            color: 'var(--text)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            padding: '6px 10px',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>
      <div style={{ marginBottom: 6 }}>
        <input
          type="text"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="Nickname (optional)"
          disabled={status === 'loading'}
          style={{
            width: '100%',
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            color: 'var(--text)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            padding: '6px 10px',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>
      {status === 'error' && (
        <p style={{ fontSize: 11, color: 'var(--error, #f44)', margin: '0 0 6px' }}>
          {errorMsg}
        </p>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="submit"
          disabled={status === 'loading' || !rawKey.trim()}
          style={{
            background: 'var(--accent)',
            border: 'none',
            borderRadius: 4,
            color: '#fff',
            cursor: status === 'loading' || !rawKey.trim() ? 'not-allowed' : 'pointer',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            opacity: status === 'loading' || !rawKey.trim() ? 0.5 : 1,
            padding: '5px 12px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          {status === 'loading' ? 'Testing…' : 'Test & Save'}
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={status === 'loading'}
          style={{
            background: 'none',
            border: '1px solid var(--border)',
            borderRadius: 4,
            color: 'var(--text-4)',
            cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            padding: '5px 12px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Cancel
        </button>
      </div>
      {provider.docs_url && (
        <p style={{ fontSize: 10, color: 'var(--text-4)', margin: '6px 0 0' }}>
          Get your key:{' '}
          <a
            href={provider.docs_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--accent)' }}
          >
            {provider.display_name} console
          </a>
        </p>
      )}
    </form>
  );
}

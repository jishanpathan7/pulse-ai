/**
 * conversations-client — REST calls for conversation + message persistence.
 */

const BASE = '/api';

export interface ConversationSummary {
  id: string;
  title: string;
  created_at: string;
  message_count: string; // pg returns bigint as string
  pinned: boolean;
}

export interface PersistedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  token_count: number;
  created_at: string;
  completed_at: string | null;
}

export async function createConversation(title?: string): Promise<ConversationSummary | null> {
  const res = await fetch(`${BASE}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ title: title ?? 'New session' }),
  });
  if (!res.ok) return null;
  const json = await res.json() as { conversation: ConversationSummary };
  return json.conversation;
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const res = await fetch(`${BASE}/conversations`, { credentials: 'include' });
  if (!res.ok) return [];
  const json = await res.json() as { conversations: ConversationSummary[] };
  return json.conversations;
}

export async function getMessages(conversationId: string): Promise<PersistedMessage[]> {
  const res = await fetch(`${BASE}/conversations/${conversationId}/messages`, {
    credentials: 'include',
  });
  if (!res.ok) return [];
  const json = await res.json() as { messages: PersistedMessage[] };
  return json.messages;
}

export async function renameConversation(id: string, title: string): Promise<boolean> {
  const res = await fetch(`${BASE}/conversations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ title }),
  });
  return res.ok;
}

export async function pinConversation(id: string, pinned: boolean): Promise<boolean> {
  const res = await fetch(`${BASE}/conversations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ pinned }),
  });
  return res.ok;
}

export async function deleteConversation(id: string): Promise<boolean> {
  const res = await fetch(`${BASE}/conversations/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  return res.ok;
}

/**
 * Bulk-save messages for browser-side AI providers (Ollama, Demo, SSE Anthropic).
 * WS path saves server-side in ai-stream-handler — call this only for other providers.
 * Non-fatal: returns false on network error rather than throwing.
 */
export async function saveMessages(
  conversationId: string,
  messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string; token_count?: number }>,
): Promise<boolean> {
  if (messages.length === 0) return true;
  try {
    const res = await fetch(`${BASE}/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ messages }),
    });
    return res.ok;
  } catch {
    return false; // non-fatal — turn history won't persist but app continues
  }
}

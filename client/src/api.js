import { getIdToken } from './firebase';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

async function authHeaders() {
  const token = await getIdToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export async function fetchConversations() {
  const res = await fetch(`${API_BASE}/chat/conversations`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json();
  return data.conversations || [];
}

export async function createConversation(model) {
  const res = await fetch(`${API_BASE}/chat/conversations`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ model }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json();
  return data.conversation;
}

export async function fetchMessages(conversationId) {
  const res = await fetch(`${API_BASE}/chat/conversations/${conversationId}/messages`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json();
  return data;
}

export async function sendMessage(conversationId, content, onChunk, imageBase64) {
  const token = await getIdToken();
  const body = { content };
  if (imageBase64) body.image = imageBase64;

  const res = await fetch(`${API_BASE}/chat/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `API error: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value);
    const lines = text.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          if (parsed.content) onChunk(parsed.content);
          if (parsed.error) throw new Error(parsed.error);
        } catch (e) {
          if (e.message !== 'Unexpected end of JSON input') {
            console.error('Parse error:', e);
          }
        }
      }
    }
  }
}

export async function deleteConversation(conversationId) {
  await fetch(`${API_BASE}/chat/conversations/${conversationId}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
}

export async function fetchModels() {
  const res = await fetch(`${API_BASE}/models`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json();
  return data.models || [];
}

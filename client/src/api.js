import { getIdToken } from './firebase';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

async function authHeaders() {
  const token = await getIdToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function authBearer() {
  const token = await getIdToken();
  return { Authorization: `Bearer ${token}` };
}

export async function fetchMe() {
  const res = await fetch(`${API_BASE}/auth/me`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function fetchUsage() {
  const res = await fetch(`${API_BASE}/chat/usage`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
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
  return res.json();
}

export async function sendMessage(conversationId, content, onEvent, imageBase64) {
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
    const err = new Error(errData.error || `API error: ${res.status}`);
    err.status = res.status;
    err.data = errData;
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        onEvent(parsed);
      } catch (e) {
        if (e.message !== 'Unexpected end of JSON input') {
          console.error('Parse error:', e, 'line:', line);
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

// -------- APK tools --------

export async function apkList() {
  const res = await fetch(`${API_BASE}/apk/projects`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json();
  return data.projects || [];
}

export async function apkUpload(file, onProgress) {
  const headers = await authBearer();
  const form = new FormData();
  form.append('apk', file);
  form.append('name', file.name);

  // Use XMLHttpRequest for progress
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/apk/upload`);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && typeof onProgress === 'function') {
        onProgress(ev.loaded / ev.total);
      }
    };
    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300) resolve(json.project);
        else reject(new Error(json.error || `Upload failed (${xhr.status})`));
      } catch (e) {
        reject(e);
      }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(form);
  });
}

export async function apkDecompile(projectId) {
  const res = await fetch(`${API_BASE}/apk/projects/${projectId}/decompile`, {
    method: 'POST',
    headers: await authHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Decompile failed (${res.status})`);
  return data;
}

export async function apkTree(projectId) {
  const res = await fetch(`${API_BASE}/apk/projects/${projectId}/tree`, {
    headers: await authHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Tree failed (${res.status})`);
  return data.tree || [];
}

export async function apkReadFile(projectId, filePath) {
  const url = `${API_BASE}/apk/projects/${projectId}/file?path=${encodeURIComponent(filePath)}`;
  const res = await fetch(url, { headers: await authHeaders() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Read failed (${res.status})`);
  return data;
}

export async function apkWriteFile(projectId, filePath, content) {
  const res = await fetch(`${API_BASE}/apk/projects/${projectId}/file`, {
    method: 'PUT',
    headers: await authHeaders(),
    body: JSON.stringify({ path: filePath, content }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
  return data;
}

export async function apkRecompile(projectId) {
  const res = await fetch(`${API_BASE}/apk/projects/${projectId}/recompile`, {
    method: 'POST',
    headers: await authHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Recompile failed (${res.status})`);
  return data;
}

export async function apkDownloadUrl(projectId) {
  // Returned URL is signed via Bearer header — caller fetches it themselves.
  return `${API_BASE}/apk/projects/${projectId}/download`;
}

export async function apkDelete(projectId) {
  const res = await fetch(`${API_BASE}/apk/projects/${projectId}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}

/**
 * Download the recompiled APK as a Blob (so we can attach the auth header).
 */
export async function apkDownloadBlob(projectId, filename) {
  const url = `${API_BASE}/apk/projects/${projectId}/download`;
  const res = await fetch(url, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const a = document.createElement('a');
  const objUrl = URL.createObjectURL(blob);
  a.href = objUrl;
  a.download = filename || 'modded.apk';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
}

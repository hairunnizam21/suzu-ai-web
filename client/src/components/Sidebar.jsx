import { useState } from 'react';

function formatNumber(n) {
  if (n == null) return '—';
  return n.toLocaleString();
}

function UsageBar({ usage }) {
  if (!usage) return null;
  const used = usage.tokens_used_today ?? 0;
  const limit = usage.tokens_limit_daily ?? 0;
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const dangerous = pct >= 90;
  return (
    <div className="usage-card" title={`Resets at ${usage.tokens_reset_at || '—'}`}>
      <div className="usage-label">
        <span>Tokens hari ini</span>
        <span className="usage-numbers">
          {formatNumber(used)} / {formatNumber(limit)}
        </span>
      </div>
      <div className="usage-bar">
        <div className={`usage-bar-fill ${dangerous ? 'danger' : ''}`} style={{ width: pct + '%' }} />
      </div>
    </div>
  );
}

export default function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  user,
  onLogout,
  models,
  selectedModel,
  onModelChange,
  view,
  onViewChange,
  usage,
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <>
      <button className="sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
        ☰
      </button>
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <span className="logo-icon">⚡</span>
            <span>Suzu AI</span>
          </div>
          {view === 'chat' && (
            <button className="new-chat-btn" onClick={onNew} title="New chat">
              +
            </button>
          )}
        </div>

        <div className="view-tabs">
          <button
            className={`view-tab ${view === 'chat' ? 'active' : ''}`}
            onClick={() => onViewChange?.('chat')}
          >
            💬 Chat
          </button>
          <button
            className={`view-tab ${view === 'apk' ? 'active' : ''}`}
            onClick={() => onViewChange?.('apk')}
          >
            📦 APK Tools
          </button>
        </div>

        <UsageBar usage={usage} />

        {view === 'chat' && (
          <>
            <div className="model-selector">
              <label>Model</label>
              <select value={selectedModel} onChange={(e) => onModelChange(e.target.value)}>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="conversation-list">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`conversation-item ${conv.id === activeId ? 'active' : ''}`}
                  onClick={() => {
                    onSelect(conv.id);
                    setSidebarOpen(false);
                  }}
                >
                  <span className="conv-title">{conv.title}</span>
                  <button
                    className="delete-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(conv.id);
                    }}
                    title="Delete"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {view === 'apk' && (
          <div className="apk-sidebar-hint">
            <p>Drop APK di kanan, atau minta AI dalam chat untuk decompile/edit/recompile APK.</p>
          </div>
        )}

        <div className="sidebar-footer">
          <div className="user-info">
            {user?.photoURL && (
              <img src={user.photoURL} alt="" className="user-avatar" />
            )}
            <span className="user-name">{user?.displayName || user?.email}</span>
          </div>
          <button className="logout-btn" onClick={onLogout}>
            Logout
          </button>
        </div>
      </aside>
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}
    </>
  );
}

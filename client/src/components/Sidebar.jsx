import { useState } from 'react';

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
          <button className="new-chat-btn" onClick={onNew} title="New chat">
            +
          </button>
        </div>

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

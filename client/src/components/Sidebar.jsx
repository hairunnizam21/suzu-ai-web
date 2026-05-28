import { useState, useRef, useEffect } from 'react';

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
  plan,
  planExpiresAt,
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
                <ConversationItem
                  key={conv.id}
                  conv={conv}
                  active={conv.id === activeId}
                  onSelect={() => {
                    onSelect(conv.id);
                    setSidebarOpen(false);
                  }}
                  onDelete={() => onDelete(conv.id)}
                />
              ))}
              {conversations.length === 0 && (
                <div className="conv-empty">Belum ada chat. Tekan + untuk mula.</div>
              )}
            </div>
          </>
        )}

        {view === 'apk' && (
          <div className="apk-sidebar-hint">
            <p>Drop APK di kanan, atau minta AI dalam chat untuk decompile/edit/recompile APK.</p>
          </div>
        )}

        <ProfileCard
          user={user}
          plan={plan}
          planExpiresAt={planExpiresAt}
          usage={usage}
          onLogout={onLogout}
        />
      </aside>
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}
    </>
  );
}

function formatRemaining(iso) {
  if (!iso) return '';
  const target = new Date(iso);
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return 'expired';
  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  if (months >= 2) return `${months} bulan lagi`;
  if (days >= 2) return `${days} hari lagi`;
  if (hours >= 2) return `${hours} jam lagi`;
  if (minutes >= 1) return `${minutes} min lagi`;
  return 'expired';
}

function ProfileCard({ user, plan, planExpiresAt, usage, onLogout }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const isPremium = plan === 'premium';
  const userId = user?.uid || '';
  const displayName = user?.displayName || user?.email || 'You';
  const remaining = isPremium ? formatRemaining(planExpiresAt) : '';

  const copyUid = async () => {
    if (!userId) return;
    try {
      await navigator.clipboard.writeText(userId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {/* ignore */}
  };

  return (
    <div className={`profile-card ${open ? 'open' : ''} ${isPremium ? 'premium' : ''}`}>
      <button className="profile-card-header" onClick={() => setOpen((v) => !v)}>
        <div className={`profile-avatar-wrap ${isPremium ? 'premium-ring' : ''}`}>
          {user?.photoURL ? (
            <img src={user.photoURL} alt="" className="profile-avatar" />
          ) : (
            <div className="profile-avatar fallback">{displayName[0]?.toUpperCase()}</div>
          )}
        </div>
        <div className="profile-id">
          <span className="profile-name">{displayName}</span>
          <span className={`profile-plan-badge ${isPremium ? 'premium' : 'free'}`} title={remaining}>
            {isPremium ? `★ Premium${remaining ? ' · ' + remaining : ''}` : 'Free'}
          </span>
        </div>
        <span className={`profile-caret ${open ? 'rot' : ''}`}>▾</span>
      </button>

      {open && (
        <div className="profile-card-body">
          <div className="profile-row">
            <span className="profile-row-label">Email</span>
            <span className="profile-row-value" title={user?.email || ''}>{user?.email || '—'}</span>
          </div>
          <div className="profile-row">
            <span className="profile-row-label">User ID</span>
            <button className="profile-uid" onClick={copyUid} title="Klik untuk salin">
              <code>{userId.length > 14 ? userId.slice(0, 6) + '…' + userId.slice(-6) : userId}</code>
              <span className="profile-uid-copy">{copied ? '✓ disalin' : '⧉ salin'}</span>
            </button>
          </div>
          <div className="profile-row">
            <span className="profile-row-label">Plan</span>
            <span className={`profile-plan-badge ${isPremium ? 'premium' : 'free'}`}>
              {isPremium ? '★ Premium' : 'Free'}
            </span>
          </div>
          {isPremium && planExpiresAt && (
            <div className="profile-row">
              <span className="profile-row-label">Berakhir</span>
              <span className="profile-row-value">{remaining}</span>
            </div>
          )}
          {usage && (
            <div className="profile-row">
              <span className="profile-row-label">Tokens hari ini</span>
              <span className="profile-row-value">
                {(usage.tokens_used_today || 0).toLocaleString()} / {(usage.tokens_limit_daily || 0).toLocaleString()}
              </span>
            </div>
          )}
          <button className="logout-btn" onClick={onLogout}>Logout</button>
        </div>
      )}
    </div>
  );
}

function ConversationItem({ conv, active, onSelect, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copyState, setCopyState] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
    };
  }, [menuOpen]);

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('Disalin!');
      setTimeout(() => setCopyState(''), 1500);
    } catch {
      setCopyState('Gagal salin');
      setTimeout(() => setCopyState(''), 1500);
    }
  };

  const handleDelete = () => {
    setMenuOpen(false);
    const sure = window.confirm(`Padam chat “${conv.title}”? Tindakan ini tidak boleh dibatalkan.`);
    if (sure) onDelete();
  };

  const shareUrl = `${window.location.origin}/?conv=${encodeURIComponent(conv.id)}`;

  return (
    <div
      ref={ref}
      className={`conversation-item ${active ? 'active' : ''}`}
      onClick={onSelect}
    >
      <span className="conv-title">{conv.title}</span>
      <button
        className="conv-menu-btn"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
        aria-label="Open chat menu"
        title="More options"
      >
        ⋮
      </button>
      {menuOpen && (
        <div className="conv-menu" onClick={(e) => e.stopPropagation()}>
          <button
            className="conv-menu-item"
            onClick={() => {
              copy(conv.id);
            }}
          >
            📋 Salin Chat ID
          </button>
          <button
            className="conv-menu-item"
            onClick={() => {
              copy(shareUrl);
            }}
          >
            🔗 Salin link kongsi
          </button>
          <div className="conv-menu-hint">
            Hanya anda boleh baca chat ini bila buka link.
          </div>
          {copyState && <div className="conv-menu-hint" style={{ color: 'var(--accent)' }}>{copyState}</div>}
          <hr className="conv-menu-sep" />
          <button className="conv-menu-item danger" onClick={handleDelete}>
            🗑️ Padam chat
          </button>
        </div>
      )}
    </div>
  );
}

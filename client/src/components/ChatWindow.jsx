import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

export default function ChatWindow({ messages, onSend, onSendApk, isLoading, streamingContent, streamingTool, selectedModel, models, user }) {
  const [input, setInput] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [apkFile, setApkFile] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const apkInputRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [input]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if ((!input.trim() && !imageFile && !apkFile) || isLoading) return;
    if (apkFile) {
      onSendApk?.(apkFile, input.trim());
      setApkFile(null);
      if (apkInputRef.current) apkInputRef.current.value = '';
    } else {
      onSend(input.trim(), imageFile);
    }
    setInput('');
    setImageFile(null);
    setImagePreview(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleImageSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setImagePreview(reader.result);
    reader.readAsDataURL(file);
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleApkSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const lower = (file.name || '').toLowerCase();
    if (!lower.endsWith('.apk') && !lower.endsWith('.xapk')) {
      alert('Sila pilih fail .apk atau .xapk');
      e.target.value = '';
      return;
    }
    setApkFile(file);
    setImageFile(null);
    setImagePreview(null);
  };

  const removeApk = () => {
    setApkFile(null);
    if (apkInputRef.current) apkInputRef.current.value = '';
  };

  const modelName = models?.find(m => m.id === selectedModel)?.name || 'AI';
  const userInitial = (user?.displayName || user?.email || 'U')[0]?.toUpperCase();
  const aiStatus = computeAiStatus({ isLoading, streamingContent, streamingTool });

  return (
    <div className="chat-window">
      <div className="chat-header">
        <div className="chat-header-user" title={user?.email || ''}>
          {user?.photoURL ? (
            <img className="chat-header-avatar" src={user.photoURL} alt="" />
          ) : (
            <div className="chat-header-avatar fallback">{userInitial}</div>
          )}
          <span className="online-dot" />
        </div>
        <div className="chat-header-info">
          <h1 className="chat-header-title">{user?.displayName || user?.email || 'You'}</h1>
          <span className="chat-header-model">
            Chatting with <b>SuzuneiAyano-AI</b> · {modelName}
          </span>
        </div>
        {aiStatus && (
          <div className={`ai-status ${aiStatus.tone}`} title={aiStatus.label}>
            <span className="ai-status-icon">{aiStatus.icon}</span>
            <span className="ai-status-label">{aiStatus.label}</span>
            <span className="ai-dots"><i /><i /><i /></span>
          </div>
        )}
      </div>

      <div className="messages-container">
        {messages.length === 0 && !streamingContent && (
          <div className="empty-chat">
            <div className="empty-logo">SA</div>
            <h2>SuzuneiAyano-AI</h2>
            <p>How can I help you today?</p>
            <div className="empty-suggestions">
              <button className="suggestion-chip" onClick={() => { setInput('Explain quantum computing simply'); }}>
                Explain quantum computing
              </button>
              <button className="suggestion-chip" onClick={() => { setInput('Write a Python function to sort a list'); }}>
                Write Python code
              </button>
              <button className="suggestion-chip" onClick={() => { setInput('What are the best practices for web security?'); }}>
                Web security tips
              </button>
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          const imgSrc = msg.image || msg.imageUrl;
          return (
            <div key={msg.id ?? i} className={`message ${msg.role}`}>
              <div className="message-avatar">
                {msg.role === 'user' ? (
                  user?.photoURL ? (
                    <img className="avatar-user-img" src={user.photoURL} alt="" />
                  ) : (
                    <div className="avatar-user">{userInitial}</div>
                  )
                ) : (
                  <div className="avatar-ai">SA</div>
                )}
              </div>
              <div className="message-body">
                <span className="message-role">{msg.role === 'user' ? (user?.displayName || 'You') : 'SuzuneiAyano-AI'}</span>
                <div className="message-content">
                  {imgSrc && (
                    <div className="message-image">
                      <img src={imgSrc} alt="Uploaded" />
                    </div>
                  )}
                  {msg.content && <ReactMarkdown>{msg.content}</ReactMarkdown>}
                </div>
              </div>
            </div>
          );
        })}

        {streamingTool && (
          <div className="message assistant tool">
            <div className="message-avatar">
              <div className="avatar-ai">SA</div>
            </div>
            <div className="message-body">
              <span className="message-role">Tool</span>
              <div className="message-content tool-call">
                {streamingTool.phase === 'call' ? '↳ calling' : '✓ result from'}{' '}
                <code>{streamingTool.name}</code>
                {streamingTool.phase === 'call' && streamingTool.args && (
                  <pre className="tool-args">{JSON.stringify(streamingTool.args, null, 2)}</pre>
                )}
                {streamingTool.phase === 'result' && (
                  <pre className="tool-args">
                    {(() => {
                      const r = streamingTool.result;
                      if (!r) return '';
                      const s = JSON.stringify(r, null, 2);
                      return s.length > 1500 ? s.slice(0, 1500) + '…' : s;
                    })()}
                  </pre>
                )}
              </div>
            </div>
          </div>
        )}

        {streamingContent && (
          <div className="message assistant streaming">
            <div className="message-avatar">
              <div className="avatar-ai pulse">SA</div>
            </div>
            <div className="message-body">
              <span className="message-role">SuzuneiAyano-AI</span>
              <div className="message-content">
                <ReactMarkdown>{streamingContent}</ReactMarkdown>
                <span className="typing-cursor" />
              </div>
            </div>
          </div>
        )}

        {isLoading && !streamingContent && (
          <div className="message assistant">
            <div className="message-avatar">
              <div className="avatar-ai">SA</div>
            </div>
            <div className="message-body">
              <span className="message-role">SuzuneiAyano-AI</span>
              <div className="message-content">
                <div className="typing-indicator">
                  <span></span><span></span><span></span>
                </div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-wrapper">
        {imagePreview && (
          <div className="image-preview-bar">
            <div className="image-preview-item">
              <img src={imagePreview} alt="Preview" />
              <button className="image-remove-btn" onClick={removeImage}>&times;</button>
            </div>
          </div>
        )}
        {apkFile && (
          <div className="image-preview-bar">
            <div className="apk-attached-chip">
              <span className="apk-attached-icon">📦</span>
              <span className="apk-attached-name">{apkFile.name}</span>
              <span className="apk-attached-size">{(apkFile.size / 1024 / 1024).toFixed(2)} MB</span>
              <button className="image-remove-btn" onClick={removeApk}>&times;</button>
            </div>
          </div>
        )}
        <form className="chat-input-form" onSubmit={handleSubmit}>
          <button
            type="button"
            className="attach-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Upload image"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
          </button>
          <button
            type="button"
            className="attach-btn"
            onClick={() => apkInputRef.current?.click()}
            title="Attach APK for analysis"
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>📦</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageSelect}
            style={{ display: 'none' }}
          />
          <input
            ref={apkInputRef}
            type="file"
            accept=".apk,.xapk,application/vnd.android.package-archive"
            onChange={handleApkSelect}
            style={{ display: 'none' }}
          />
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={apkFile ? `Analisis APK: ${apkFile.name}… (boleh tambah nota)` : 'Message SuzuneiAyano-AI...'}
            rows={1}
            disabled={isLoading}
          />
          <button type="submit" className="send-btn" disabled={(!input.trim() && !imageFile && !apkFile) || isLoading}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}

function computeAiStatus({ isLoading, streamingContent, streamingTool }) {
  if (!isLoading && !streamingContent && !streamingTool) return null;
  if (streamingTool) {
    const map = {
      apk_list_projects: { icon: '📂', label: 'Listing projects' },
      apk_decompile: { icon: '📦', label: 'Decompiling APK' },
      apk_info: { icon: '📋', label: 'Reading manifest' },
      apk_list_files: { icon: '📂', label: 'Listing files' },
      apk_read_file: { icon: '📖', label: 'Reading file' },
      apk_search: { icon: '🔎', label: 'Searching code' },
      apk_edit_file: { icon: '✏️', label: 'Editing file' },
      apk_recompile: { icon: '🔨', label: 'Building APK' },
    };
    const m = map[streamingTool.name] || { icon: '⚙️', label: streamingTool.name };
    return { ...m, tone: streamingTool.phase === 'result' ? 'good' : 'busy' };
  }
  if (streamingContent) return { icon: '⌨️', label: 'Typing', tone: 'busy' };
  return { icon: '💭', label: 'Thinking', tone: 'busy' };
}

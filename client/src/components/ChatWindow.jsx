import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

// Some "thinking-agentic" models leak <thinking>...</thinking> blocks in the stream.
// Hide them from the rendered chat. Works for both finished messages and partial
// streaming content (handles a half-open <thinking> tag at the end of the buffer).
function stripThinking(text) {
  if (!text) return text;
  let out = text.replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, '');
  // If a <thinking> opened but hasn't closed yet (streaming), drop everything from it onward.
  const openIdx = out.search(/<thinking\b[^>]*>/i);
  if (openIdx !== -1) out = out.slice(0, openIdx);
  // Also strip stray tags if the close arrives before the open (defensive).
  out = out.replace(/<\/?thinking\b[^>]*>/gi, '');
  return out.replace(/\n{3,}/g, '\n\n').trimStart();
}

export default function ChatWindow({ messages, onSend, onSendApk, isLoading, streamingContent, streamingTool, selectedModel, models, user }) {
  const [input, setInput] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [apkFile, setApkFile] = useState(null);
  // Generic text-ish attachment (.txt, .json, .md, .smali, source files, logs, etc.)
  const [textAttach, setTextAttach] = useState(null); // { name, size, content }
  const [attachError, setAttachError] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
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
    if (!input.trim() && !imageFile && !apkFile && !textAttach) return;
    if (apkFile) {
      onSendApk?.(apkFile, input.trim());
      setApkFile(null);
    } else if (textAttach) {
      // Inline the text file as a fenced block in the user message so the AI
      // can read it without any extra round trip.
      const note = input.trim();
      const lang = languageFromName(textAttach.name);
      const block = `Attached file: \`${textAttach.name}\` (${formatBytes(textAttach.size)})\n\n\`\`\`${lang}\n${textAttach.content}\n\`\`\``;
      const merged = note ? `${note}\n\n${block}` : block;
      onSend(merged, null);
      setTextAttach(null);
    } else {
      onSend(input.trim(), imageFile);
    }
    setInput('');
    setImageFile(null);
    setImagePreview(null);
    setAttachError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Single attach handler — branches on file type so the chat input accepts
  // anything the user has on their phone/laptop: images, APKs, text/code files.
  const handleAttach = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttachError('');
    const lower = (file.name || '').toLowerCase();
    const isApk = lower.endsWith('.apk') || lower.endsWith('.xapk');
    const isImage = (file.type || '').startsWith('image/');
    const isTextish = isLikelyTextFile(file);

    if (isApk) {
      setApkFile(file);
      setImageFile(null);
      setImagePreview(null);
      setTextAttach(null);
    } else if (isImage) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result);
      reader.readAsDataURL(file);
      setApkFile(null);
      setTextAttach(null);
    } else if (isTextish) {
      const MAX_TEXT_BYTES = 1024 * 1024; // 1 MB cap so we don't blow the context
      if (file.size > MAX_TEXT_BYTES) {
        setAttachError(`Fail teks terlalu besar (${formatBytes(file.size)}). Maksimum ${formatBytes(MAX_TEXT_BYTES)}.`);
        e.target.value = '';
        return;
      }
      const content = await file.text();
      setTextAttach({ name: file.name, size: file.size, content });
      setApkFile(null);
      setImageFile(null);
      setImagePreview(null);
    } else {
      setAttachError(`Jenis fail tidak disokong: ${file.name}. Cuba imej, .apk, atau fail teks (.txt/.json/.xml/.md/.csv/.log/source code).`);
    }
    e.target.value = '';
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview(null);
  };
  const removeApk = () => setApkFile(null);
  const removeTextAttach = () => setTextAttach(null);

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
                  {msg.content && (() => { const cleaned = stripThinking(msg.content); return cleaned ? <ReactMarkdown>{cleaned}</ReactMarkdown> : null; })()}
                </div>
              </div>
            </div>
          );
        })}

        {/* Tool calls hidden from user — internal only */}

        {(() => {
          const visible = stripThinking(streamingContent);
          if (!visible) return null;
          return (
            <div className="message assistant streaming">
              <div className="message-avatar">
                <div className="avatar-ai pulse">SA</div>
              </div>
              <div className="message-body">
                <span className="message-role">SuzuneiAyano-AI</span>
                <div className="message-content">
                  <ReactMarkdown>{visible}</ReactMarkdown>
                  <span className="typing-cursor" />
                </div>
              </div>
            </div>
          );
        })()}

        {isLoading && !stripThinking(streamingContent) && (
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
              <span className="apk-attached-size">{formatBytes(apkFile.size)}</span>
              <button className="image-remove-btn" onClick={removeApk}>&times;</button>
            </div>
          </div>
        )}
        {textAttach && (
          <div className="image-preview-bar">
            <div className="apk-attached-chip">
              <span className="apk-attached-icon">📄</span>
              <span className="apk-attached-name">{textAttach.name}</span>
              <span className="apk-attached-size">{formatBytes(textAttach.size)}</span>
              <button className="image-remove-btn" onClick={removeTextAttach}>&times;</button>
            </div>
          </div>
        )}
        {attachError && <div className="attach-error">{attachError}</div>}
        <form className="chat-input-form" onSubmit={handleSubmit}>
          <button
            type="button"
            className="attach-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Lampir fail (imej, APK, teks, kod)"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.41a2 2 0 0 1-2.83-2.83l8.49-8.49" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.apk,.xapk,application/vnd.android.package-archive,.txt,.md,.json,.xml,.yaml,.yml,.csv,.tsv,.log,.conf,.ini,.toml,.smali,.java,.kt,.kts,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.c,.cc,.cpp,.h,.hpp,.cs,.php,.sh,.bash,.zsh,.ps1,.html,.htm,.css,.scss,.less,.sql,.gradle,.pro,.properties,.env"
            onChange={handleAttach}
            style={{ display: 'none' }}
          />
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              apkFile ? `Analisis APK: ${apkFile.name}… (boleh tambah nota)`
              : textAttach ? `Soalan tentang ${textAttach.name}…`
              : 'Message SuzuneiAyano-AI...'
            }
            rows={1}
          />
          <button type="submit" className="send-btn" disabled={!input.trim() && !imageFile && !apkFile && !textAttach}>
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

function formatBytes(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'json', 'jsonc', 'xml', 'yaml', 'yml',
  'toml', 'ini', 'conf', 'cfg', 'env', 'properties', 'smali', 'java', 'kt', 'kts',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'c', 'cc', 'cpp',
  'cxx', 'h', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'ps1', 'html', 'htm', 'css',
  'scss', 'sass', 'less', 'sql', 'gradle', 'pro', 'lua', 'swift', 'dart', 'm', 'mm',
  'r', 'pl', 'rmd', 'tex', 'svg',
]);
function isLikelyTextFile(file) {
  if ((file.type || '').startsWith('text/')) return true;
  const name = file.name || '';
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return TEXT_EXTS.has(name.slice(dot + 1).toLowerCase());
}
function languageFromName(name) {
  const dot = (name || '').lastIndexOf('.');
  if (dot < 0) return '';
  const ext = name.slice(dot + 1).toLowerCase();
  const map = {
    md: 'markdown', markdown: 'markdown',
    js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'tsx', jsx: 'jsx',
    py: 'python', rb: 'ruby', kt: 'kotlin', kts: 'kotlin',
    sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell',
    yml: 'yaml',
    htm: 'html',
    gradle: 'groovy',
  };
  return map[ext] || ext;
}

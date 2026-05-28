import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

export default function ChatWindow({ messages, onSend, isLoading, streamingContent, selectedModel, models }) {
  const [input, setInput] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
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
    if ((!input.trim() && !imageFile) || isLoading) return;
    onSend(input.trim(), imageFile);
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

  const modelName = models?.find(m => m.id === selectedModel)?.name || 'AI';

  return (
    <div className="chat-window">
      <div className="chat-header">
        <div className="chat-header-info">
          <h1 className="chat-header-title">SuzuneiAyano-AI 1.0</h1>
          <span className="chat-header-model">{modelName}</span>
        </div>
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

        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            <div className="message-avatar">
              {msg.role === 'user' ? (
                <div className="avatar-user">U</div>
              ) : (
                <div className="avatar-ai">SA</div>
              )}
            </div>
            <div className="message-body">
              <span className="message-role">{msg.role === 'user' ? 'You' : 'SuzuneiAyano-AI'}</span>
              <div className="message-content">
                {msg.imageUrl && (
                  <div className="message-image">
                    <img src={msg.imageUrl} alt="Uploaded" />
                  </div>
                )}
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
            </div>
          </div>
        ))}

        {streamingContent && (
          <div className="message assistant">
            <div className="message-avatar">
              <div className="avatar-ai">SA</div>
            </div>
            <div className="message-body">
              <span className="message-role">SuzuneiAyano-AI</span>
              <div className="message-content">
                <ReactMarkdown>{streamingContent}</ReactMarkdown>
                <span className="typing-cursor">|</span>
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
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageSelect}
            style={{ display: 'none' }}
          />
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message SuzuneiAyano-AI..."
            rows={1}
            disabled={isLoading}
          />
          <button type="submit" className="send-btn" disabled={(!input.trim() && !imageFile) || isLoading}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}

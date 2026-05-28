import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

export default function ChatWindow({ messages, onSend, isLoading, streamingContent }) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    onSend(input.trim());
    setInput('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="chat-window">
      <div className="messages-container">
        {messages.length === 0 && !streamingContent && (
          <div className="empty-chat">
            <span className="empty-icon">⚡</span>
            <h2>Suzu AI</h2>
            <p>How can I help you today?</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            <div className="message-avatar">
              {msg.role === 'user' ? '👤' : '⚡'}
            </div>
            <div className="message-content">
              <ReactMarkdown>{msg.content}</ReactMarkdown>
            </div>
          </div>
        ))}
        {streamingContent && (
          <div className="message assistant">
            <div className="message-avatar">⚡</div>
            <div className="message-content">
              <ReactMarkdown>{streamingContent}</ReactMarkdown>
              <span className="typing-cursor">▌</span>
            </div>
          </div>
        )}
        {isLoading && !streamingContent && (
          <div className="message assistant">
            <div className="message-avatar">⚡</div>
            <div className="message-content">
              <div className="typing-indicator">
                <span></span><span></span><span></span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input-form" onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Send a message..."
          rows={1}
          disabled={isLoading}
        />
        <button type="submit" disabled={!input.trim() || isLoading}>
          ➤
        </button>
      </form>
    </div>
  );
}

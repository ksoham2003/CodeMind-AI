import { useRef, useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import './ChatInput.css';

export default function ChatInput({ onSend, loading, disabled }) {
  const [value, setValue] = useState('');
  const textareaRef = useRef(null);

  const handleSubmit = (e) => {
    e?.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || loading || disabled) return;
    onSend(trimmed);
    setValue('');
    textareaRef.current?.focus();
    // Reset height
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e) => {
    setValue(e.target.value);
    // Auto-resize textarea
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
    }
  };

  const canSend = value.trim().length > 0 && !loading && !disabled;

  return (
    <form className="chat-input-wrap glass" onSubmit={handleSubmit} role="search">
      <div className="chat-input-inner">
        <textarea
          id="chat-input-textarea"
          ref={textareaRef}
          className="chat-textarea"
          placeholder={disabled ? 'Repository not ready' : 'Ask anything about this codebase…'}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          disabled={disabled || loading}
          rows={1}
          aria-label="Ask a question about the codebase"
          autoFocus
        />
        <button
          type="submit"
          className={`btn chat-send-btn ${canSend ? 'btn-primary' : 'chat-send-btn--idle'}`}
          disabled={!canSend}
          aria-label={loading ? 'Generating answer...' : 'Send message'}
        >
          {loading ? (
            <Loader2 size={16} className="spin-icon" />
          ) : (
            <Send size={15} strokeWidth={2} />
          )}
        </button>
      </div>
      <p className="chat-hint">Press <kbd>Enter</kbd> to send · <kbd>Shift+Enter</kbd> for new line</p>
    </form>
  );
}

import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check, User, Brain } from 'lucide-react';
import ReactFlow from 'reactflow';
import 'reactflow/dist/style.css';
import './ChatMessage.css';

function CodeBlock({ language, children }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(String(children));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="code-block-wrap">
      <div className="code-block-header">
        <span className="code-block-lang">{language || 'code'}</span>
        <button
          className="btn btn-ghost code-copy-btn"
          onClick={handleCopy}
          aria-label={copied ? 'Copied' : 'Copy code'}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <SyntaxHighlighter
        style={oneDark}
        language={language || 'javascript'}
        PreTag="div"
        customStyle={{
          margin: 0,
          borderRadius: '0 0 10px 10px',
          background: 'rgba(0,0,0,0.5)',
          fontSize: '13px',
          lineHeight: 1.6,
        }}
      >
        {String(children).replace(/\n$/, '')}
      </SyntaxHighlighter>
    </div>
  );
}

export default function ChatMessage({ message }) {
  const isUser = message.role === 'user';
  const navigate = useNavigate();

  return (
    <div className={`chat-message ${isUser ? 'msg-user' : 'msg-ai'} animate-fade-up`}>
      <div className={`msg-avatar ${isUser ? 'avatar-user' : 'avatar-ai'}`} aria-hidden="true">
        {isUser ? <User size={14} /> : <Brain size={14} />}
      </div>

      <div className={`msg-bubble ${isUser ? 'bubble-user' : 'bubble-ai'}`}>
        {isUser ? (
          <p className="msg-text">{message.content}</p>
        ) : (
          <div className="markdown-content">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ inline, className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '');
                  const lang = match?.[1];

                  return !inline ? (
                    <CodeBlock language={lang}>
                      {children}
                    </CodeBlock>
                  ) : (
                    <code className="inline-code" {...props}>
                      {children}
                    </code>
                  );
                },
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}

        {/* Architecture diagrams are no longer shown inline in chat messages. */}

        {message.timestamp && (
          <time className="msg-time" dateTime={message.timestamp}>
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </time>
        )}
      </div>
    </div>
  );
}


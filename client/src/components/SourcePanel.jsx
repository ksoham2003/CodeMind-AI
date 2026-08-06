import { useState } from 'react';
import { FileCode, ChevronRight, Copy, Check, ExternalLink } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import './SourcePanel.css';

function SourceCard({ source, index }) {
  const [expanded, setExpanded] = useState(index === 0);
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(source.content || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const scorePercent = Math.round((source.score || 0) * 100);
  const fileName = source.file?.split('/').pop() || source.file;

  return (
    <div className={`source-card ${expanded ? 'source-card--open' : ''}`}>
      {/* Header */}
      <button
        className="source-card-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} source ${fileName}`}
      >
        <div className="source-header-left">
          <div className="source-file-icon">
            <FileCode size={12} />
          </div>
          <div className="source-meta">
            <span className="source-filename truncate">{fileName}</span>
            <span className="source-details truncate">
              {source.functionName
                ? `fn ${source.functionName}`
                : source.className
                ? `class ${source.className}`
                : source.chunkType}
              {' · '}L{source.startLine}–{source.endLine}
            </span>
          </div>
        </div>
        <div className="source-header-right">
          {/* Similarity score bar */}
          <div
            className="score-badge"
            title={`${scorePercent}% similarity`}
            aria-label={`${scorePercent}% similarity`}
          >
            <div
              className="score-bar-fill"
              style={{ width: `${scorePercent}%` }}
            />
            <span className="score-text">{scorePercent}%</span>
          </div>
          <ChevronRight
            size={13}
            className={`source-chevron ${expanded ? 'chevron-open' : ''}`}
          />
        </div>
      </button>

      {/* File path */}
      <div className="source-path truncate">{source.file}</div>

      {/* Expanded code */}
      {expanded && source.content && (
        <div className="source-code-wrap animate-fade-in">
          <div className="source-code-toolbar">
            <span className="source-code-lang badge badge-gray">{source.language}</span>
            <button
              className="btn btn-ghost code-copy-btn"
              onClick={handleCopy}
              aria-label={copied ? 'Copied' : 'Copy snippet'}
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
          <SyntaxHighlighter
            style={oneDark}
            language={source.language || 'javascript'}
            PreTag="div"
            showLineNumbers
            startingLineNumber={source.startLine || 1}
            customStyle={{
              margin: 0,
              background: 'rgba(0,0,0,0.4)',
              fontSize: '12px',
              lineHeight: 1.5,
              borderRadius: '0 0 10px 10px',
            }}
            lineNumberStyle={{ color: 'rgba(255,255,255,0.2)', minWidth: '2.5em' }}
          >
            {String(source.content)}
          </SyntaxHighlighter>
        </div>
      )}
    </div>
  );
}

export default function SourcePanel({ sources }) {
  if (!sources || sources.length === 0) return null;

  return (
    <div className="source-panel">
      <div className="source-panel-header">
        <h3 className="source-panel-title">
          Relevant Sources
          <span className="source-count badge badge-gray">{sources.length}</span>
        </h3>
      </div>
      <div className="source-list">
        {sources.map((source, i) => (
          <SourceCard key={i} source={source} index={i} />
        ))}
      </div>
    </div>
  );
}

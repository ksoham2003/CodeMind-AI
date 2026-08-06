import { useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import { CheckCircle, Circle, Loader2, XCircle, GitBranch, FileSearch, Braces, Zap, Database, Sparkles } from 'lucide-react';
import './IndexingProgress.css';

const STAGES = [
  { key: 'cloning',   icon: GitBranch,  label: 'Cloning Repository',    desc: 'Downloading source code from GitHub' },
  { key: 'reading',   icon: FileSearch, label: 'Reading Files',          desc: 'Scanning and filtering source files' },
  { key: 'parsing',   icon: Braces,     label: 'AST Parsing',            desc: 'Extracting functions, classes & components' },
  { key: 'chunking',  icon: Sparkles,   label: 'Building Chunks',        desc: 'Creating semantic code units' },
  { key: 'embedding', icon: Zap,        label: 'Generating Embeddings',  desc: 'Converting code to vector representations' },
  { key: 'indexing',  icon: Database,   label: 'Storing in Pinecone',    desc: 'Uploading vectors to the database' },
];

const IndexingProgress = forwardRef(function IndexingProgress({ projectId, onComplete }, ref) {
  const [events, setEvents] = useState([]);
  const [currentStage, setCurrentStage] = useState('');
  const [currentMessage, setCurrentMessage] = useState('Starting...');
  const [percent, setPercent] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  // Accept events from parent via prop (SocketContext is used in parent)
  useEffect(() => {
    // This component receives updates via the `update` prop
  }, []);

  const handleEvent = (event) => {
    setCurrentStage(event.stage);
    setCurrentMessage(event.message);
    if (event.percent !== undefined) setPercent(event.percent);

    setEvents((prev) => {
      // Update or add event for this stage
      const existing = prev.findIndex((e) => e.stage === event.stage);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = event;
        return updated;
      }
      return [...prev, event];
    });

    if (event.stage === 'done') {
      setDone(true);
      setPercent(100);
      onComplete?.();
    }
    if (event.stage === 'error') {
      setError(event.message);
    }
  };

  // Expose handleEvent via ref
  useImperativeHandle(ref, () => ({ handleEvent }));

  const getStageStatus = (stageKey) => {
    const stageOrder = STAGES.map((s) => s.key);
    const currentIdx = stageOrder.indexOf(currentStage);
    const stageIdx = stageOrder.indexOf(stageKey);

    if (done && !error) return 'done';
    if (error && currentStage === stageKey) return 'error';
    if (stageIdx < currentIdx) return 'done';
    if (stageIdx === currentIdx) return 'active';
    return 'pending';
  };

  return (
    <div className="indexing-progress">
      {/* Stages */}
      <div className="stages-list" role="list">
        {STAGES.map((stage, i) => {
          const status = getStageStatus(stage.key);
          const Icon = stage.icon;
          const stageEvent = events.find((e) => e.stage === stage.key);

          return (
            <div
              key={stage.key}
              className={`stage-item stage-${status}`}
              role="listitem"
            >
              {/* Connector line */}
              {i < STAGES.length - 1 && (
                <div className={`stage-line ${status === 'done' ? 'stage-line--done' : ''}`} aria-hidden="true" />
              )}

              {/* Icon */}
              <div className="stage-icon-wrap" aria-hidden="true">
                {status === 'active' ? (
                  <Loader2 size={14} className="spin-icon" />
                ) : status === 'done' ? (
                  <CheckCircle size={14} />
                ) : status === 'error' ? (
                  <XCircle size={14} />
                ) : (
                  <Circle size={14} />
                )}
              </div>

              {/* Content */}
              <div className="stage-content">
                <span className="stage-label">{stage.label}</span>
                <span className="stage-desc">
                  {status === 'active' && stageEvent
                    ? stageEvent.message
                    : stage.desc}
                </span>
                {/* Sub-progress bar */}
                {status === 'active' && stageEvent?.percent !== undefined && (
                  <div className="stage-sub-progress">
                    <div className="progress-bar">
                      <div
                        className="progress-bar-fill"
                        style={{ width: `${stageEvent.percent}%` }}
                      />
                    </div>
                    <span className="stage-pct">{stageEvent.percent}%</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Overall status */}
      <div className={`indexing-status ${done ? 'status-done' : error ? 'status-error' : 'status-running'}`}>
        {done ? (
          <>
            <CheckCircle size={16} />
            <span>Indexing complete — ready to chat!</span>
          </>
        ) : error ? (
          <>
            <XCircle size={16} />
            <span>{error}</span>
          </>
        ) : (
          <>
            <Loader2 size={16} className="spin-icon" />
            <span>{currentMessage}</span>
          </>
        )}
      </div>
    </div>
  );
});

export default IndexingProgress;

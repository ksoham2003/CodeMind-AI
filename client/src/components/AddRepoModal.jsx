import { useState, useRef, useEffect } from 'react';
import { X, Github, ArrowRight, Loader2 } from 'lucide-react';
import { repositoryService, indexService } from '../services';
import './AddRepoModal.css';

const EXAMPLE_REPOS = [
  'https://github.com/expressjs/express',
  'https://github.com/vercel/next.js',
  'https://github.com/facebook/react',
];

export default function AddRepoModal({ onClose, onSuccess }) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const overlayRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const handleOverlayClick = (e) => {
    if (e.target === overlayRef.current) onClose();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!url.trim()) {
      setError('Please enter a GitHub URL');
      return;
    }
    setError('');
    setLoading(true);

    try {
      // 1. Register the repo
      const { project, alreadyExists } = await repositoryService.addGithub(url.trim(), name.trim() || undefined);

      if (alreadyExists) {
        onSuccess(project, false);
        return;
      }

      // 2. Start indexing immediately
      await indexService.start(project._id);
      onSuccess(project, true);
    } catch (err) {
      setError(err.message || 'Failed to add repository');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      ref={overlayRef}
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div className="modal-sheet animate-scale-in">
        {/* Header */}
        <div className="modal-header">
          <div className="modal-header-left">
            <div className="modal-icon">
              <Github size={18} />
            </div>
            <div>
              <h2 id="modal-title" className="modal-title">Add Repository</h2>
              <p className="modal-subtitle">Paste any public GitHub URL to start indexing</p>
            </div>
          </div>
          <button
            className="btn btn-ghost btn-icon"
            onClick={onClose}
            aria-label="Close modal"
          >
            <X size={16} />
          </button>
        </div>

        <div className="modal-divider" />

        {/* Form */}
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-group">
            <label htmlFor="repo-url" className="form-label">GitHub URL</label>
            <input
              id="repo-url"
              ref={inputRef}
              type="url"
              className="input modal-input"
              placeholder="https://github.com/owner/repository"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setError(''); }}
              disabled={loading}
              autoComplete="off"
            />
            {error && (
              <p className="form-error" role="alert">{error}</p>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="repo-name" className="form-label">
              Display Name <span className="form-label-optional">(optional)</span>
            </label>
            <input
              id="repo-name"
              type="text"
              className="input modal-input"
              placeholder="e.g. My Express App"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
            />
          </div>

          {/* Examples */}
          <div className="modal-examples">
            <p className="modal-examples-label">Try an example:</p>
            <div className="modal-examples-list">
              {EXAMPLE_REPOS.map((repo) => (
                <button
                  key={repo}
                  type="button"
                  className="chip"
                  onClick={() => setUrl(repo)}
                  disabled={loading}
                >
                  {repo.replace('https://github.com/', '')}
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg modal-submit"
            disabled={loading || !url.trim()}
            id="modal-submit-btn"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="spin-icon" />
                Adding Repository...
              </>
            ) : (
              <>
                Start Indexing
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

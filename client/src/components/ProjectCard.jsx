import { useNavigate } from 'react-router-dom';
import { GitBranch, FileCode, Database, Trash2, ArrowRight } from 'lucide-react';
import StatusBadge from './StatusBadge';
import './ProjectCard.css';

const LANG_COLORS = {
  JS:  '#f7df1e', TS: '#3178c6', JSX: '#61dafb', TSX: '#3178c6',
};

export default function ProjectCard({ project, onDelete }) {
  const navigate = useNavigate();

  const handleOpen = () => {
    if (project.status === 'ready') {
      navigate(`/project/${project._id}`);
    } else if (['cloning', 'parsing', 'embedding', 'indexing', 'pending'].includes(project.status)) {
      navigate(`/project/${project._id}/indexing`);
    }
  };

  const handleDelete = (e) => {
    e.stopPropagation();
    onDelete(project._id);
  };

  const repoName = project.githubUrl?.replace('https://github.com/', '') || project.name;
  const isActive = project.status === 'ready';
  const isIndexing = ['cloning', 'parsing', 'embedding', 'indexing'].includes(project.status);

  return (
    <article
      className={`project-card ${isActive ? 'project-card--active' : ''}`}
      onClick={handleOpen}
      role="button"
      tabIndex={0}
      aria-label={`Open project ${project.name}`}
      onKeyDown={(e) => e.key === 'Enter' && handleOpen()}
    >
      {/* Card glow for active projects */}
      {isActive && <div className="card-glow" aria-hidden="true" />}

      {/* Header */}
      <div className="card-header">
        <div className="card-icon-wrap">
          <GitBranch size={16} />
        </div>
        <div className="card-header-right">
          <StatusBadge status={project.status} />
          <button
            className="btn btn-ghost btn-icon card-delete-btn"
            onClick={handleDelete}
            aria-label={`Delete ${project.name}`}
            title="Delete project"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Name */}
      <div className="card-body">
        <h3 className="card-name truncate">{project.name}</h3>
        <p className="card-url truncate">{repoName}</p>
      </div>

      {/* Stats */}
      <div className="card-stats">
        <div className="card-stat">
          <FileCode size={12} />
          <span>{project.fileCount ?? '—'} files</span>
        </div>
        <div className="card-stat">
          <Database size={12} />
          <span>{project.chunkCount ?? '—'} chunks</span>
        </div>
      </div>

      {/* Languages */}
      {project.languages?.length > 0 && (
        <div className="card-langs">
          {project.languages.slice(0, 3).map((lang) => (
            <span key={lang} className="lang-dot-wrap">
              <span
                className="lang-dot"
                style={{ background: LANG_COLORS[lang] || 'var(--c-text-tertiary)' }}
              />
              <span className="lang-label">{lang}</span>
            </span>
          ))}
        </div>
      )}

      {/* Footer CTA */}
      <div className="card-footer">
        {isIndexing && (
          <div className="card-indexing-bar">
            <div className="card-indexing-fill" />
          </div>
        )}
        <div className="card-cta">
          <span>{isActive ? 'Open Chat' : isIndexing ? 'View Progress' : 'View'}</span>
          <ArrowRight size={13} />
        </div>
      </div>
    </article>
  );
}

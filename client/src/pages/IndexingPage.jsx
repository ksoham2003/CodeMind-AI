import { useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, GitBranch, CheckCircle } from 'lucide-react';
import { useSocket } from '../context/SocketContext';
import IndexingProgress from '../components/IndexingProgress';
import { projectService } from '../services';
import './IndexingPage.css';

export default function IndexingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { joinProject, leaveProject, onIndexingProgress } = useSocket();
  const progressRef = useRef(null);
  const projectRef = useRef(null);

  useEffect(() => {
    let unsubscribe;

    const init = async () => {
      try {
        const { project } = await projectService.getById(id);
        projectRef.current = project;

        // If already indexed, go straight to chat
        if (project.status === 'ready') {
          navigate(`/project/${id}`, { replace: true });
          return;
        }

        // Join socket room
        joinProject(id);

        // Subscribe to events
        unsubscribe = onIndexingProgress((event) => {
          // Forward event to IndexingProgress component
          if (progressRef.current?.handleEvent) {
            progressRef.current.handleEvent(event);
          }

          // Navigate on completion
          if (event.stage === 'done') {
            setTimeout(() => navigate(`/project/${id}`, { replace: true }), 2500);
          }
        });
      } catch (err) {
        console.error('Failed to init indexing page:', err);
      }
    };

    init();

    return () => {
      leaveProject(id);
      unsubscribe?.();
    };
  }, [id, joinProject, leaveProject, onIndexingProgress, navigate]);

  return (
    <div className="indexing-page">
      {/* Background */}
      <div className="indexing-bg" aria-hidden="true">
        <div className="indexing-orb indexing-orb--1" />
        <div className="indexing-orb indexing-orb--2" />
      </div>

      <div className="indexing-content">
        {/* Back button */}
        <button
          className="btn btn-ghost indexing-back"
          onClick={() => navigate('/')}
        >
          <ArrowLeft size={14} />
          Back
        </button>

        {/* Card */}
        <div className="indexing-card glass animate-scale-in">
          {/* Header */}
          <div className="indexing-card-header">
            <div className="indexing-brain-icon">
              <GitBranch size={20} strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="indexing-title">Indexing Repository</h1>
              <p className="indexing-subtitle">
                Analyzing code structure and building semantic search index
              </p>
            </div>
          </div>

          <div className="divider" />

          {/* Progress component */}
          <div className="indexing-card-body">
            <IndexingProgress
              ref={progressRef}
              projectId={id}
              onComplete={() => {
                // Navigation handled above after delay
              }}
            />
          </div>
        </div>

        {/* Info callout */}
        <div className="indexing-info animate-fade-up delay-3">
          <CheckCircle size={14} />
          <p>
            This is a one-time process. Once indexed, your repository is permanently
            searchable — no re-indexing needed unless you add a new one.
          </p>
        </div>
      </div>
    </div>
  );
}

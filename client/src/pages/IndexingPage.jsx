import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, GitBranch, CheckCircle } from 'lucide-react';
import { useSocket } from '../context/SocketContext';
import IndexingProgress from '../components/IndexingProgress';
import { projectService, indexService } from '../services';
import './IndexingPage.css';

export default function IndexingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { joinProject, leaveProject, onIndexingProgress, connected } = useSocket();
  const progressRef = useRef(null);
  const projectRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const receivedSocketEvent = useRef(false);

  // Map DB status → stage key used by IndexingProgress
  const statusToStage = (status) => ({
    cloning:   'cloning',
    parsing:   'parsing',
    embedding: 'embedding',
    indexing:  'indexing',
    ready:     'done',
    error:     'error',
  }[status] || '');

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

        // Join socket room & listen for live progress events
        joinProject(id);

        unsubscribe = onIndexingProgress((event) => {
          receivedSocketEvent.current = true;
          if (progressRef.current?.handleEvent) {
            progressRef.current.handleEvent(event);
          }
          if (event.stage === 'done') {
            clearInterval(pollIntervalRef.current);
            setTimeout(() => navigate(`/project/${id}`, { replace: true }), 2500);
          }
        });

        // Polling fallback — kicks in immediately and continues until
        // socket events take over or indexing completes
        const poll = async () => {
          try {
            const { project: latest } = await projectService.getById(id);
            const stage = statusToStage(latest.status);

            if (!receivedSocketEvent.current && stage && stage !== 'done') {
              // Synthesise a progress event from the DB status
              progressRef.current?.handleEvent({
                stage,
                message: `${latest.status}…`,
                percent: undefined,
              });
            }

            if (latest.status === 'ready') {
              clearInterval(pollIntervalRef.current);
              progressRef.current?.handleEvent({ stage: 'done', message: 'Indexing complete!' });
              setTimeout(() => navigate(`/project/${id}`, { replace: true }), 2000);
            }
            if (latest.status === 'error') {
              clearInterval(pollIntervalRef.current);
              progressRef.current?.handleEvent({ stage: 'error', message: latest.errorMessage || 'Indexing failed' });
            }
          } catch (_) {
            // ignore poll errors
          }
        };

        // Poll every 4 seconds as fallback
        poll();
        pollIntervalRef.current = setInterval(poll, 4000);

      } catch (err) {
        console.error('Failed to init indexing page:', err);
      }
    };

    init();

    return () => {
      leaveProject(id);
      unsubscribe?.();
      clearInterval(pollIntervalRef.current);
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

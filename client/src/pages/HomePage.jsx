import { useState, useEffect, useCallback } from 'react';
import { Plus, Brain, Folder, Search, Sparkles } from 'lucide-react';
import { useProjects } from '../context/ProjectContext';
import { projectService } from '../services';
import ProjectCard from '../components/ProjectCard';
import AddRepoModal from '../components/AddRepoModal';
import { useNavigate } from 'react-router-dom';
import './HomePage.css';

const HERO_QUESTIONS = [
  'Where is authentication implemented?',
  'How is the database connected?',
  'Explain the payment flow',
  'Find all protected routes',
];

export default function HomePage() {
  const { projects, loading, fetchProjects, removeProject } = useProjects();
  const [showModal, setShowModal] = useState(false);
  const [heroQ, setHeroQ] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Cycle through hero questions
  useEffect(() => {
    const interval = setInterval(() => {
      setHeroQ((prev) => (prev + 1) % HERO_QUESTIONS.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleDelete = async (projectId) => {
    if (!window.confirm('Delete this project and all its data?')) return;
    try {
      await projectService.delete(projectId);
      removeProject(projectId);
    } catch (err) {
      alert('Failed to delete project: ' + err.message);
    }
  };

  const handleRepoSuccess = (project, isNew) => {
    setShowModal(false);
    fetchProjects();
    if (isNew) {
      navigate(`/project/${project._id}/indexing`);
    } else {
      navigate(`/project/${project._id}`);
    }
  };

  return (
    <main className="homepage">
      {/* Hero Section */}
      <section className="hero" aria-label="Hero">
        {/* Background grid */}
        <div className="hero-grid" aria-hidden="true" />

        {/* Orb blobs */}
        <div className="hero-orb hero-orb--blue" aria-hidden="true" />
        <div className="hero-orb hero-orb--purple" aria-hidden="true" />

        <div className="hero-content">
          {/* Badge */}
          <div className="hero-badge animate-fade-up">
            <Sparkles size={12} />
            <span>RAG · Vector Search · AST Parsing</span>
          </div>

          {/* Headline */}
          <h1 className="hero-headline animate-fade-up delay-1">
            Ask anything about
            <br />
            <span className="gradient-text-blue">any repository</span>
          </h1>

          {/* Animated question */}
          <div className="hero-question animate-fade-up delay-2" aria-live="polite">
            <Search size={15} className="hero-q-icon" />
            <span className="hero-q-text" key={heroQ}>
              {HERO_QUESTIONS[heroQ]}
            </span>
          </div>

          <p className="hero-sub animate-fade-up delay-3">
            Paste a GitHub URL. CodeMind clones, parses, embeds, and indexes your
            entire codebase — then lets you ask questions in plain English.
          </p>

          <button
            id="hero-cta-btn"
            className="btn btn-primary btn-lg hero-cta animate-fade-up delay-4"
            onClick={() => setShowModal(true)}
          >
            <Plus size={18} />
            Add Repository
          </button>
        </div>
      </section>

      {/* Projects Section */}
      <section className="projects-section">
        <div className="projects-inner">
          <div className="projects-header">
            <div className="flex-gap-3">
              <Folder size={18} className="projects-folder-icon" />
              <h2 className="projects-title">Your Repositories</h2>
              {projects.length > 0 && (
                <span className="badge badge-gray">{projects.length}</span>
              )}
            </div>
            <button
              id="add-repo-btn"
              className="btn btn-primary"
              onClick={() => setShowModal(true)}
            >
              <Plus size={14} />
              Add Repository
            </button>
          </div>

          {/* Empty state */}
          {!loading && projects.length === 0 && (
            <div className="empty-state animate-fade-up">
              <div className="empty-icon">
                <Brain size={32} strokeWidth={1.25} />
              </div>
              <h3 className="empty-title">No repositories yet</h3>
              <p className="empty-sub">
                Add a GitHub repository to start asking questions about your codebase.
              </p>
              <button
                className="btn btn-primary"
                onClick={() => setShowModal(true)}
              >
                <Plus size={14} />
                Add your first repository
              </button>
            </div>
          )}

          {/* Loading skeleton */}
          {loading && (
            <div className="projects-grid">
              {[1, 2, 3].map((i) => (
                <div key={i} className="skeleton" style={{ height: 220, borderRadius: 20 }} />
              ))}
            </div>
          )}

          {/* Project cards */}
          {!loading && projects.length > 0 && (
            <div className="projects-grid">
              {projects.map((project, i) => (
                <div
                  key={project._id}
                  className={`animate-fade-up delay-${Math.min(i + 1, 5)}`}
                >
                  <ProjectCard project={project} onDelete={handleDelete} />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Modal */}
      {showModal && (
        <AddRepoModal
          onClose={() => setShowModal(false)}
          onSuccess={handleRepoSuccess}
        />
      )}
    </main>
  );
}

import { useNavigate } from 'react-router-dom';
import { ArrowRight, Brain, Code, Database, GitBranch, MessageSquare, Terminal } from 'lucide-react';
import './LandingPage.css';

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="landing-page">
      {/* Background Depth Orbs */}
      <div className="landing-bg" aria-hidden="true">
        <div className="landing-orb landing-orb--1" />
        <div className="landing-orb landing-orb--2" />
      </div>

      <div className="landing-container">
        {/* Hero Section */}
        <header className="landing-hero" role="banner">
          <div className="landing-badge animate-fade-up">
            <Brain size={12} />
            <span>AI Code Assistant</span>
          </div>

          <h1 className="landing-headline animate-fade-up delay-1">
            Understand your <span className="gradient-text-blue">entire codebase</span> in seconds
          </h1>

          <p className="landing-sub animate-fade-up delay-2">
            CodeMind is a self-hostable, RAG-powered Q&A tool. Index any public or private GitHub repository, parse structural nodes via AST, generate high-quality vector embeddings, and search them in real-time.
          </p>

          <div className="landing-actions animate-fade-up delay-3">
            <button
              onClick={() => navigate('/signup')}
              className="btn btn-primary btn-lg"
              aria-label="Get Started with CodeMind"
            >
              Get Started Free
              <ArrowRight size={16} />
            </button>
            <button
              onClick={() => navigate('/login')}
              className="btn btn-ghost btn-lg"
              aria-label="Log in to existing workspace"
            >
              Sign In
            </button>
          </div>
        </header>

        {/* Preview Code Mockup */}
        <section className="landing-preview animate-scale-in delay-4" aria-label="Interactive Preview">
          <div className="mockup-window">
            <div className="mockup-header">
              <div className="mockup-dots" aria-hidden="true">
                <span className="mockup-dot mockup-dot--red" />
                <span className="mockup-dot mockup-dot--yellow" />
                <span className="mockup-dot mockup-dot--green" />
              </div>
              <span className="mockup-title">codemind-session.sh</span>
            </div>
            <div className="mockup-body">
              <div className="mockup-line">
                <span className="mockup-prompt">$</span>
                <span className="mockup-cmd">codemind index https://github.com/expressjs/express</span>
              </div>
              <div className="mockup-line">
                <span className="mockup-response">
                  ✓ Cloned repository <br />
                  ✓ Parsed 234 structural classes/functions via AST <br />
                  ✓ Stored 3,072-dimensional vector embeddings in Pinecone <br />
                  🚀 Workspace ready for questioning!
                </span>
              </div>
              <div className="mockup-line" style={{ marginTop: '20px' }}>
                <span className="mockup-prompt">?</span>
                <span className="mockup-cmd" style={{ color: '#fff' }}>
                  How does express route parameters under the hood?
                </span>
              </div>
              <div className="mockup-line">
                <span className="mockup-response">
                  Express resolves route params in `lib/router/index.js` inside the `handle` function. 
                  When a request matches a route, it iterates through the compiled path regex 
                  keys matching dynamic tokens (like `:id`) and populates `req.params`...
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Feature Grid */}
        <section className="landing-features" aria-label="Features">
          <div className="features-header">
            <h2 className="features-title">Designed for code comprehension</h2>
            <p className="features-sub">Engineered to bridge the gap between complex file structures and quick insights</p>
          </div>

          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon-wrap">
                <GitBranch size={20} />
              </div>
              <h3>Instant GitHub Sync</h3>
              <p>Clones, parses, and configures workspaces automatically from any public or private repository URL.</p>
            </div>

            <div className="feature-card feature-card--purple">
              <div className="feature-icon-wrap">
                <Code size={20} />
              </div>
              <h3>AST Syntax Trees</h3>
              <p>Goes beyond flat text chunking. We build code representations mapping functions, classes, and scopes for contextual answers.</p>
            </div>

            <div className="feature-card feature-card--teal">
              <div className="feature-icon-wrap">
                <Database size={20} />
              </div>
              <h3>Vector Embedding Indexes</h3>
              <p>Generates high-fidelity embeddings stored inside Pinecone databases for low-latency semantic code retrieval.</p>
            </div>

            <div className="feature-card">
              <div className="feature-icon-wrap">
                <MessageSquare size={20} />
              </div>
              <h3>Conversational Debugging</h3>
              <p>Ask architectural questions, locate files, identify performance bottlenecks, or ask CodeMind to write code snippets for you.</p>
            </div>
          </div>
        </section>

        {/* CTA Banner */}
        <section className="landing-cta" aria-label="Call to Action">
          <div className="cta-card glass">
            <h2 className="cta-title">Ready to understand your code?</h2>
            <p className="cta-sub">Sign up now and index your first repository in under a minute.</p>
            <button
              onClick={() => navigate('/signup')}
              className="btn btn-primary btn-lg"
              aria-label="Create workspace now"
            >
              Get Started Now
              <ArrowRight size={16} />
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

import { Link, useLocation } from 'react-router-dom';
import { Brain, Github } from 'lucide-react';
import { useSocket } from '../context/SocketContext';
import './Navbar.css';

export default function Navbar() {
  const location = useLocation();
  const { connected } = useSocket();

  return (
    <nav className="navbar glass" role="navigation" aria-label="Main navigation">
      <div className="navbar-inner">
        {/* Logo */}
        <Link to="/" className="navbar-logo" aria-label="CodeMind AI home">
          <div className="navbar-logo-icon">
            <Brain size={18} strokeWidth={1.75} />
          </div>
          <span className="navbar-logo-text">
            <span className="navbar-logo-name">CodeMind</span>
            <span className="navbar-logo-suffix"> AI</span>
          </span>
        </Link>

        {/* Right side */}
        <div className="navbar-right">
          {/* Connection indicator */}
          <div
            className={`navbar-conn ${connected ? 'conn-on' : 'conn-off'}`}
            data-tooltip={connected ? 'Connected' : 'Disconnected'}
            aria-label={connected ? 'Server connected' : 'Server disconnected'}
          >
            <span className="conn-dot" />
            <span className="conn-label">{connected ? 'Live' : 'Offline'}</span>
          </div>

          {/* GitHub link */}
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost btn-icon navbar-gh"
            aria-label="View on GitHub"
            data-tooltip="GitHub"
          >
            <Github size={16} />
          </a>
        </div>
      </div>
    </nav>
  );
}

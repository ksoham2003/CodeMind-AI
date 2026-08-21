import { Link, useLocation } from 'react-router-dom';
import { Brain, Github } from 'lucide-react';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { LogOut } from 'lucide-react';
import './Navbar.css';
import { Link } from 'react-router-dom';

export default function Navbar() {
  const location = useLocation();
  const { connected } = useSocket();
  const { user, logout } = useAuth();

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

          {user && (
            <>
              <span className="navbar-user">Hi, {user.name}</span>
              <button onClick={logout} className="btn btn-ghost btn-icon" title="Logout">
                <LogOut size={16} />
              </button>
            </>
          )}

          <Link to="/costs" className="btn btn-ghost" title="Cost Dashboard">Costs</Link>

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

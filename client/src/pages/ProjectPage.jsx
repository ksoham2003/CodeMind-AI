import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { GitBranch, ArrowLeft, Loader2, Maximize2, Minimize2, ExternalLink, Network, Sparkles } from 'lucide-react';
import { projectService, chatService, architectureService } from '../services';
import ChatMessage from '../components/ChatMessage';
import ChatInput from '../components/ChatInput';
import SourcePanel from '../components/SourcePanel';
import SuggestedQuestions from '../components/SuggestedQuestions';
import StatusBadge from '../components/StatusBadge';
import './ProjectPage.css';

export default function ProjectPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [messages, setMessages] = useState([]);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);
  const [visualizing, setVisualizing] = useState(false);
  const [providerError, setProviderError] = useState(null);

  const messagesEndRef = useRef(null);

  useEffect(() => {
    const init = async () => {
      try {
        const [projRes, chatRes] = await Promise.all([
          projectService.getById(id),
          chatService.getHistory(id),
        ]);

        setProject(projRes.project);

        // Map history to chat message format
        const history = [];
        const reversedChats = [...chatRes.chats].reverse(); // oldest first
        for (const chat of reversedChats) {
          history.push({ role: 'user', content: chat.question, timestamp: chat.createdAt });
          history.push({
            role: 'ai',
            content: chat.answer,
            sources: chat.sources,
            timestamp: chat.createdAt,
          });
        }
        setMessages(history);
        
        // Show sources from last message if it has them
        const lastChat = reversedChats[reversedChats.length - 1];
        if (lastChat?.sources?.length > 0) {
          setSources(lastChat.sources);
          setSourcePanelOpen(true);
        }
      } catch (err) {
        setError('Failed to load project: ' + err.message);
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [id]);

  const handleSend = async (question) => {
    if (!question || !question.trim()) return;

    const userMsg = { role: 'user', content: question, timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setSending(true);

    try {
      const res = await chatService.send(id, question);

      const aiMsg = {
        role: 'ai',
        content: res.answer,
        sources: res.sources,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, aiMsg]);
      setSources(res.sources || []);
      setSourcePanelOpen(!!(res.sources && res.sources.length > 0));
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'ai', content: `❌ Error: ${err.message}` }]);
    } finally {
      setSending(false);
    }
  };

  const handleVisualize = async () => {
    if (visualizing || project?.status !== 'ready') return;
    setVisualizing(true);

    // Add a user-style message
    const userMsg = {
      role: 'user',
      content: '🏗️ Visualize the architecture of this repository',
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await architectureService.visualize(id, 'component');

          const diagramContent = `Here's the architecture diagram for **${project.name}**:\n\n${res.summary}`;

      const aiMsg = {
        role: 'ai',
        content: diagramContent,
            graph: res.graph,
            timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, aiMsg]);
      setSourcePanelOpen(false);
      // clear any previous provider errors on success
      setProviderError(null);
    } catch (err) {
      // Surface detailed provider errors in a banner and also append an AI message
      setProviderError(err.message);
      setMessages((prev) => [
        ...prev,
        { role: 'ai', content: `❌ Failed to generate architecture diagram: ${err.message}` },
      ]);
    } finally {
      setVisualizing(false);
    }
  };

  if (loading) {
    return (
      <div className="project-page-center">
        <Loader2 size={32} className="spin-icon" color="var(--c-accent)" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="project-page-center">
        <div className="empty-state">
          <h3>Error Loading Project</h3>
          <p className="text-secondary">{error || 'Project not found'}</p>
          <button className="btn btn-primary" onClick={() => navigate('/')}>
            Go Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="project-page">
      {providerError && (
        <div className="provider-error-banner">
          <div className="provider-error-content">
            <strong>AI Provider Error:</strong>
            <span className="provider-error-msg">{providerError}</span>
          </div>
          <div className="provider-error-actions">
            <button className="btn btn-ghost" onClick={() => { setProviderError(null); }}>
              Dismiss
            </button>
            <button className="btn btn-primary" onClick={handleVisualize} disabled={visualizing}>
              Retry
            </button>
          </div>
        </div>
      )}
      {/* ── Sidebar (File Tree Placeholder) ── */}
      <aside className="project-sidebar glass-raised">
        <div className="sidebar-header">
          <button
            className="btn btn-ghost btn-icon back-btn"
            onClick={() => navigate('/')}
            aria-label="Back to projects"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="sidebar-repo-info">
            <h2 className="sidebar-repo-name truncate">{project.name}</h2>
            <StatusBadge status={project.status} />
          </div>
        </div>
        
        <div className="sidebar-divider" />
        
        <div className="sidebar-content scroll-area">
           <div className="sidebar-stats">
              <div className="sidebar-stat-row">
                <span className="stat-label">Indexed Files</span>
                <span className="stat-value">{project.fileCount}</span>
              </div>
              <div className="sidebar-stat-row">
                <span className="stat-label">Code Chunks</span>
                <span className="stat-value">{project.chunkCount}</span>
              </div>
              <div className="sidebar-stat-row">
                <span className="stat-label">Last Updated</span>
                <span className="stat-value">
                  {new Date(project.indexedAt || project.updatedAt).toLocaleDateString()}
                </span>
              </div>
           </div>

           {/* Architecture Visualization Actions */}
           {project.status === 'ready' && (
             <div className="sidebar-arch-actions">
               <button
                 className="sidebar-arch-btn"
                 onClick={handleVisualize}
                 disabled={visualizing}
               >
                 {visualizing ? (
                   <Loader2 size={14} className="spin-icon" />
                 ) : (
                   <Sparkles size={14} />
                 )}
                   <span>{visualizing ? 'Generating…' : 'Visualize Architecture'}</span>
                 </button>
                 <button
                   className="sidebar-arch-btn sidebar-arch-btn--secondary"
                   onClick={() => navigate(`/project/${id}/architecture`)}
                 >
                   <Network size={14} />
                   <span>Architecture Explorer</span>
                 </button>
               </div>
             )}

           {project.githubUrl && (
             <a
               href={project.githubUrl}
               target="_blank"
               rel="noopener noreferrer"
               className="sidebar-gh-link"
             >
               <GitBranch size={14} />
               <span>View on GitHub</span>
               <ExternalLink size={12} style={{ marginLeft: 'auto' }} />
             </a>
           )}
        </div>
      </aside>

      {/* ── Main Chat Area ── */}
      <main className="project-main">
        <div className="chat-area scroll-area">
          {messages.length === 0 ? (
            <div className="chat-empty">
              <SuggestedQuestions onSelect={handleSend} />
            </div>
          ) : (
            messages.map((m, i) => <ChatMessage key={i} message={m} />)
          )}
          <div ref={messagesEndRef} />
        </div>
        
        <div className="chat-input-container">
          <ChatInput onSend={handleSend} loading={sending} disabled={project.status !== 'ready'} />
        </div>
      </main>

      {/* ── Sources Panel ── */}
      <aside className={`project-sources glass-raised ${sourcePanelOpen ? 'sources-open' : 'sources-closed'}`}>
        <div className="sources-toggle-btn" onClick={() => setSourcePanelOpen(!sourcePanelOpen)}>
          {sourcePanelOpen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </div>
        
        {sourcePanelOpen && (
          <div className="sources-content scroll-area">
            {sources.length > 0 ? (
              <SourcePanel sources={sources} />
            ) : (
              <div className="sources-empty">
                <p>No sources available for the last query.</p>
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

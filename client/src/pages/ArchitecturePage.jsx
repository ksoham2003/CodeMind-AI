import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, RefreshCw, ZoomIn, ZoomOut, Maximize, Copy, Network, FileCode, Check, HelpCircle } from 'lucide-react';
import ReactFlow, { Controls, MiniMap, Background } from 'reactflow';
import dagre from 'dagre';
import { projectService, architectureService } from '../services';
import FileTreeView from '../components/FileTreeView';
import 'reactflow/dist/style.css';
import './ArchitecturePage.css';

const graphDirectionMap = {
  LR: 'LR',
  RL: 'RL',
  TD: 'TB',
  BT: 'BT',
};

const getLayoutedElements = (nodes, edges, direction = 'LR') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: graphDirectionMap[direction] || 'LR', nodesep: 50, ranksep: 80 });

  nodes.forEach((node) => dagreGraph.setNode(node.id, { width: 170, height: 48 }));
  edges.forEach((edge) => dagreGraph.setEdge(edge.source, edge.target));

  dagre.layout(dagreGraph);

  return nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - 170 / 2,
        y: nodeWithPosition.y - 48 / 2,
      },
      style: {
        border: '1px solid #7c3aed',
        borderRadius: 12,
        padding: 10,
        background: '#0f172a',
        color: '#f8fafc',
      },
      className: 'architecture-node',
    };
  });
};

export default function ArchitecturePage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [project, setProject] = useState(null);
  const [diagramType, setDiagramType] = useState('component');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState('');
  const [copied, setCopied] = useState(false);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);

  // Fetch project details and generate diagram
  const loadDiagram = useCallback(async (type) => {
    setLoading(true);
    setError(null);
    try {
      const res = await architectureService.visualize(id, type);
      setSummary(res.summary);

      const graph = res.graph || { nodes: [], edges: [], direction: 'LR' };
      const layoutedNodes = getLayoutedElements(graph.nodes || [], graph.edges || [], graph.direction || 'LR');
      setNodes(layoutedNodes);
      setEdges(graph.edges || []);
    } catch (err) {
      setError(err.message || 'Failed to generate architecture diagram');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    const fetchProject = async () => {
      try {
        const res = await projectService.getById(id);
        setProject(res.project);
      } catch (err) {
        setError('Failed to fetch project details');
      }
    };
    fetchProject();
  }, [id]);

  const flowInstanceRef = useRef(null);

  useEffect(() => {
    loadDiagram(diagramType);
  }, [diagramType, loadDiagram]);

  // Zoom handlers
  const zoomIn = () => flowInstanceRef.current?.zoomIn();
  const zoomOut = () => flowInstanceRef.current?.zoomOut();
  const resetZoom = () => flowInstanceRef.current?.fitView();

  // Copy code
  const handleCopyCode = async () => {
    await navigator.clipboard.writeText(
      JSON.stringify({ nodes, edges }, null, 2)
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Highlight nodes by file path
  const handleFileSelect = (filePath) => {
    const baseName = filePath.split('/').pop().toLowerCase();
    const cleanPath = filePath.toLowerCase();

    let foundMatch = false;

    const updatedNodes = nodes.map((node) => {
      const text = String(node.data?.label || '').toLowerCase();
      const matched =
        text.includes(baseName) ||
        cleanPath.includes(text) ||
        String(node.id).toLowerCase().includes(baseName.replace(/\..*$/, ''));

      if (matched) {
        foundMatch = true;
        return {
          ...node,
          selected: true,
          style: {
            ...node.style,
            border: '2px solid #f59e0b',
            boxShadow: '0 0 0 8px rgba(245, 158, 11, 0.15)',
          },
        };
      }

      return {
        ...node,
        selected: false,
        style: {
          ...node.style,
          border: '1px solid #7c3aed',
          boxShadow: 'none',
        },
      };
    });

    if (foundMatch) {
      setNodes(updatedNodes);
    }
  };

  return (
    <div className="architecture-explorer">
      {/* Sidebar - File Tree View */}
      <aside className="explorer-sidebar glass-raised">
        <div className="sidebar-header">
          <button
            className="btn btn-ghost btn-icon back-btn"
            onClick={() => navigate(`/project/${id}`)}
            aria-label="Back to project chat"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="sidebar-repo-info">
            <h2 className="sidebar-repo-name truncate">{project?.name || 'Loading…'}</h2>
            <span className="sidebar-repo-subtitle">Architecture Explorer</span>
          </div>
        </div>

        <div className="sidebar-divider" />

        <div className="explorer-sidebar-content">
          <FileTreeView 
            fileTree={project?.fileTree} 
            onFileSelect={handleFileSelect} 
          />
        </div>
      </aside>

      {/* Main View Area */}
      <main className="explorer-main">
        {/* Top Control Bar */}
        <header className="explorer-header">
          {/* Tabs for diagram types */}
          <div className="diagram-tabs">
            <button
              className={`tab-btn ${diagramType === 'component' ? 'tab-btn--active' : ''}`}
              onClick={() => setDiagramType('component')}
              disabled={loading}
            >
              <Network size={14} />
              <span>Component Tree</span>
            </button>
            <button
              className={`tab-btn ${diagramType === 'dependency' ? 'tab-btn--active' : ''}`}
              onClick={() => setDiagramType('dependency')}
              disabled={loading}
            >
              <FileCode size={14} />
              <span>Dependency Graph</span>
            </button>
            <button
              className={`tab-btn ${diagramType === 'api-routes' ? 'tab-btn--active' : ''}`}
              onClick={() => setDiagramType('api-routes')}
              disabled={loading}
            >
              <HelpCircle size={14} />
              <span>API Routes</span>
            </button>
          </div>

          {/* Action Toolbar */}
          <div className="explorer-toolbar">
            <button className="btn btn-ghost toolbar-btn" onClick={zoomIn} title="Zoom In">
              <ZoomIn size={16} />
            </button>
            <button className="btn btn-ghost toolbar-btn" onClick={zoomOut} title="Zoom Out">
              <ZoomOut size={16} />
            </button>
            <button className="btn btn-ghost toolbar-btn" onClick={resetZoom} title="Reset View">
              <Maximize size={16} />
            </button>
            <div className="toolbar-divider" />
            <button className="btn btn-ghost toolbar-btn" onClick={handleCopyCode} title="Copy source code">
              {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
            </button>
            <button className="btn btn-ghost toolbar-btn" onClick={() => loadDiagram(diagramType)} title="Refresh diagram">
              <RefreshCw size={16} />
            </button>
          </div>
        </header>

        {/* Interactive Canvas Viewport */}
        <div className="canvas-container">
          {loading ? (
            <div className="canvas-state-overlay">
              <Loader2 size={36} className="spin-icon text-accent" />
              <span>Synthesizing codebase architecture…</span>
            </div>
          ) : error ? (
            <div className="canvas-state-overlay canvas-state-error">
              <h3>Generation Failed</h3>
              <p>{error}</p>
              <button className="btn btn-primary" onClick={() => loadDiagram(diagramType)}>
                Retry
              </button>
            </div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              fitView
              nodesConnectable={false}
              nodesDraggable={false}
              elementsSelectable={true}
              onInit={(flow) => (flowInstanceRef.current = flow)}
              style={{ width: '100%', height: '100%' }}
            >
              <MiniMap nodeColor={(node) => '#7c3aed'} nodeStrokeWidth={1} />
              <Controls showInteractive={false} />
              <Background gap={12} color="#111827" />
            </ReactFlow>
          )}

          {/* Interactive Help Hint Overlay */}
          <div className="canvas-hint">
            Drag to pan · Scroll/buttons to zoom · Click sidebar files to highlight nodes
          </div>
        </div>

        {/* Brief architectural summary panel */}
        {summary && !loading && (
          <footer className="explorer-summary-panel animate-fade-in">
            <span className="summary-badge">Summary</span>
            <p className="summary-text">{summary}</p>
          </footer>
        )}
      </main>
    </div>
  );
}

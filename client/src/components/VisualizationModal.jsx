import React, { useState, useEffect, useMemo, useCallback } from 'react';
import ReactFlow, { Background, Controls, Panel, useNodesState, useEdgesState, MarkerType } from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';
import { architectureService } from '../services';
import ErrorBoundary from './ErrorBoundary';
import './VisualizationModal.css';

const getLayoutedElements = (nodes, edges, direction = 'LR') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  
  const isHorizontal = direction === 'LR';
  dagreGraph.setGraph({ rankdir: direction });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: 200, height: 50 });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    if (!nodeWithPosition) return node;
    return {
      ...node,
      targetPosition: isHorizontal ? 'left' : 'top',
      sourcePosition: isHorizontal ? 'right' : 'bottom',
      position: {
        x: nodeWithPosition.x - 100,
        y: nodeWithPosition.y - 25,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
};

export default function VisualizationModal({ projectId, isOpen, onClose }) {
  const [diagram, setDiagram] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [diagramType, setDiagramType] = useState('component');
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  useEffect(() => {
    if (isOpen && projectId) {
      generateVisualization();
    }
  }, [isOpen, projectId]);

  const generateVisualization = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await architectureService.visualize(projectId, diagramType);
      if (response.success && response.graph) {
        setDiagram(response);
        
        // Convert to React Flow format
        const rfNodes = (response.graph.nodes || []).map((n) => ({
          id: n.id,
          data: { label: n.label },
          style: { 
            background: '#1a1f2c', 
            color: '#fff', 
            border: '1px solid #3b82f6',
            borderRadius: '8px',
            padding: '10px',
            fontSize: '12px'
          }
        }));
        
        const rfEdges = (response.graph.edges || []).map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label,
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#64748b' },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: '#64748b',
          },
        }));

        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
          rfNodes,
          rfEdges,
          response.graph.direction || 'LR'
        );

        setNodes(layoutedNodes);
        setEdges(layoutedEdges);
      } else {
        setError(response.message || 'Failed to generate architecture diagram');
      }
    } catch (err) {
      setError(err.message || 'Error generating architecture diagram');
    } finally {
      setLoading(false);
    }
  };

  const handleDiagramTypeChange = (e) => {
    const newType = e.target.value;
    setDiagramType(newType);
    setDiagram(null);
  };

  if (!isOpen) return null;

  return (
    <div className="visualization-modal-overlay" onClick={onClose}>
      <div className="visualization-modal" onClick={(e) => e.stopPropagation()}>
        <div className="visualization-header">
          <h2>Architecture Visualization</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="visualization-controls">
          <div className="diagram-type-selector">
            <label htmlFor="diagramType">Diagram Type:</label>
            <select
              id="diagramType"
              value={diagramType}
              onChange={handleDiagramTypeChange}
              disabled={loading}
            >
              <option value="component">Component</option>
              <option value="class">Class</option>
              <option value="sequence">Sequence</option>
              <option value="flowchart">Flowchart</option>
            </select>
          </div>
          <button
            className="regenerate-btn"
            onClick={generateVisualization}
            disabled={loading}
          >
            {loading ? 'Generating...' : 'Regenerate'}
          </button>
        </div>

        <div className="visualization-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {loading && (
            <div className="loading-state">
              <div className="spinner"></div>
              <p>Generating architecture diagram...</p>
            </div>
          )}

          {error && (
            <div className="error-state">
              <p className="error-message">⚠️ {error}</p>
              <p className="error-hint">Make sure the repository has been indexed.</p>
              <button onClick={generateVisualization} className="retry-btn">
                Retry
              </button>
            </div>
          )}

          {diagram && !loading && (
            <div style={{ width: '100%', height: '600px', position: 'relative', border: '1px solid #ccc', borderRadius: '8px', overflow: 'hidden' }}>
              <ErrorBoundary>
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  fitView
                  attributionPosition="bottom-right"
                >
                <Background color="#333" gap={16} />
                <Controls />
                <Panel position="top-right" style={{ background: 'rgba(20, 20, 30, 0.95)', padding: '15px', borderRadius: '10px', maxWidth: '280px', border: '1px solid #3b82f6', fontSize: '12px' }}>
                  <h3 style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#a78bfa', fontWeight: 600 }}>
                    {diagram.pattern || 'Architecture'}
                  </h3>
                  {diagram.facts?.technologies?.length > 0 && (
                    <div style={{ marginBottom: '8px' }}>
                      <span style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Technologies</span>
                      <div style={{ marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {diagram.facts.technologies.slice(0, 6).map((t) => (
                          <span key={t} style={{ background: '#1e3a5f', color: '#93c5fd', padding: '2px 6px', borderRadius: '4px', fontSize: '10px' }}>{t}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {diagram.dataflow && (
                    <div style={{ marginBottom: '8px' }}>
                      <span style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Data Flow</span>
                      <p style={{ margin: '4px 0 0 0', color: '#cbd5e1', lineHeight: '1.4', fontSize: '11px' }}>{diagram.dataflow}</p>
                    </div>
                  )}
                  <div style={{ borderTop: '1px solid #334155', paddingTop: '8px', color: '#64748b', fontSize: '10px' }}>
                    {diagram.facts?.filesAnalyzed} files · {diagram.facts?.chunksProcessed} chunks
                  </div>
                </Panel>
              </ReactFlow>
              </ErrorBoundary>

              {diagram.mermaid && (
                <div className="mermaid-code" style={{ position: 'absolute', bottom: 10, left: 10, zIndex: 5, maxWidth: '400px' }}>
                  <details style={{ background: 'rgba(30, 30, 40, 0.9)', padding: '10px', borderRadius: '8px', border: '1px solid #333' }}>
                    <summary style={{ cursor: 'pointer', color: '#cbd5e1', fontSize: '12px' }}>View Mermaid Code</summary>
                    <pre style={{ margin: '10px 0 0 0', fontSize: '10px', color: '#a78bfa', maxHeight: '200px', overflow: 'auto' }}>
                      {diagram.mermaid}
                    </pre>
                  </details>
                </div>
              )}
            </div>
          )}

          {!loading && !error && !diagram && (
            <div className="empty-state">
              <p>Click "Regenerate" to generate an architecture diagram</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

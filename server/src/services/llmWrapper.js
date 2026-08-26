const path = require('path');

let llmService = null;
try {
  llmService = require('./llmService');
} catch (e) {
  console.warn('llmService require failed in wrapper:', e && e.message ? e.message : e);
}
const localLlm = require('./localLlmService');

const placeholderGraphFromFileTree = (fileTree, retrievedChunks = [], diagramType = 'component') => {
  const nodes = [];
  const edges = [];

  // Build node list from retrievedChunks if available, falling back to fileTree children
  const seen = new Set();
  const entries = [];

  if (Array.isArray(retrievedChunks) && retrievedChunks.length > 0) {
    for (const c of retrievedChunks) {
      const path = c?.metadata?.path || c?.metadata?.file || c?.id || null;
      if (path && !seen.has(path)) {
        seen.add(path);
        entries.push({ path, meta: c.metadata });
      }
    }
  }

  if (entries.length === 0 && fileTree && Array.isArray(fileTree.children)) {
    for (const ch of fileTree.children.slice(0, 25)) {
      const p = ch.path || ch.name || ch.title || JSON.stringify(ch).slice(0, 40);
      if (!seen.has(p)) {
        seen.add(p);
        entries.push({ path: p, meta: ch });
      }
    }
  }

  if (entries.length === 0) {
    // empty fallback
    nodes.push({ id: 'A', data: { label: 'No code chunks found' } });
    nodes.push({ id: 'B', data: { label: 'Try re-indexing' } });
    edges.push({ id: 'e-A-B', source: 'A', target: 'B' });
    return { nodes, edges, direction: 'LR' };
  }

  // Create nodes with data.label (ReactFlow expects node.data.label)
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const id = `n${i}`;
    const label = (e.meta && (e.meta.functionName || e.meta.className)) || (e.path || `file-${i}`);
    nodes.push({ id, label, data: { label } });
  }

  // Create different edge patterns depending on diagramType so views differ
  if (diagramType === 'component') {
    // star from first node (assumed root) to others
    for (let i = 1; i < nodes.length; i++) {
      edges.push({ id: `e-root-${i}`, source: nodes[0].id, target: nodes[i].id });
    }
  } else if (diagramType === 'dependency') {
    // chain dependencies
    for (let i = 0; i < nodes.length - 1; i++) {
      edges.push({ id: `e-${i}-${i + 1}`, source: nodes[i].id, target: nodes[i + 1].id });
    }
  } else if (diagramType === 'api-routes') {
    // connect nodes that likely contain 'route' or 'api' in their label/path, else group
    const apiNodes = nodes.filter((n) => /route|api|controller|handler|router/i.test(String(n.data.label)));
    if (apiNodes.length > 0) {
      for (let i = 0; i < apiNodes.length - 1; i++) {
        edges.push({ id: `e-api-${i}-${i + 1}`, source: apiNodes[i].id, target: apiNodes[i + 1].id });
      }
      // link non-api nodes to first api node
      const firstApi = apiNodes[0];
      for (const n of nodes) {
        if (!apiNodes.includes(n)) edges.push({ id: `e-link-${n.id}`, source: n.id, target: firstApi.id });
      }
    } else {
      // fallback to a sparse mesh
      for (let i = 0; i < Math.min(5, nodes.length); i++) {
        for (let j = i + 1; j < Math.min(nodes.length, i + 4); j++) {
          edges.push({ id: `e-m-${i}-${j}`, source: nodes[i].id, target: nodes[j].id });
        }
      }
    }
  } else {
    // generic: connect root to all
    for (let i = 1; i < nodes.length; i++) {
      edges.push({ id: `e-root-${i}`, source: nodes[0].id, target: nodes[i].id });
    }
  }

  return { nodes, edges, direction: diagramType === 'dependency' ? 'LR' : 'TD' };
};

const generateArchitectureDiagram = async (retrievedChunks, repoName, diagramType, fileTree) => {
  if (llmService && typeof llmService.generateArchitectureDiagram === 'function') {
    return llmService.generateArchitectureDiagram(retrievedChunks, repoName, diagramType, fileTree);
  }

  // Fallback: return a basic graph summarising fileTree
  return {
    graph: placeholderGraphFromFileTree(fileTree || {}, retrievedChunks || [], diagramType),
    summary: `Fallback architecture graph generated locally (LLM service unavailable). Type: ${diagramType}`,
    tokensUsed: 0,
  };
};

// (exports defined at end)

// Provide safe wrappers for generateAnswer and streamAnswer
const generateAnswer = async (question, retrievedChunks, repoName) => {
  if (llmService && typeof llmService.generateAnswer === 'function') {
    return llmService.generateAnswer(question, retrievedChunks, repoName);
  }

  // Fallback: call local LLM with a simple prompt
  try {
    const j = await localLlm.generate(`Question: ${question}\n\nContext: ${JSON.stringify(retrievedChunks || []).slice(0, 2000)}`, { model: 'local' });
    return { answer: j.text || j.output || '', tokensUsed: j.tokens || 0 };
  } catch (e) {
    return { answer: "Local LLM unavailable.", tokensUsed: 0 };
  }
};

const streamAnswer = async function* (question, retrievedChunks, repoName) {
  if (llmService && typeof llmService.streamAnswer === 'function') {
    for await (const c of llmService.streamAnswer(question, retrievedChunks, repoName)) {
      yield c;
    }
    return;
  }

  // Fallback: stream from localLlm if available
  try {
    for await (const chunk of localLlm.stream(`Question: ${question}\n\nContext: ${JSON.stringify(retrievedChunks || []).slice(0, 2000)}`, { model: 'local' })) {
      yield chunk;
    }
  } catch (e) {
    yield 'Local LLM streaming unavailable.';
  }
};

module.exports = { generateArchitectureDiagram, generateAnswer, streamAnswer };

const { v4: uuidv4 } = require('uuid');

const MAX_CHUNK_CHARS = parseInt(process.env.MAX_CHUNK_CHARS || '2500', 10);
const MAX_REPO_CHUNKS = parseInt(process.env.MAX_REPO_CHUNKS || '2500', 10);

// Default to selective chunking to keep embedding workloads fast while retaining the most useful code signals.
const CHUNK_STRATEGY = (process.env.EMBED_CHUNK_STRATEGY || 'selective').toLowerCase();
const SELECTIVE_MIN_CHARS = parseInt(process.env.SELECTIVE_MIN_CHARS || '180', 10);

/**
 * Convert parsed AST nodes into indexable chunks with rich metadata
 *
 * Each chunk contains:
 * - id: unique vector ID for Pinecone
 * - text: the content to embed
 * - metadata: everything stored alongside the vector
 *
 * @param {object[]} parsedNodes - Output from parserService.parseFiles()
 * @param {string} repoId - Repository identifier
 * @param {string} repoName - Human-readable name
 * @returns {{ id, text, metadata }[]}
 */
const buildChunks = (parsedNodes, repoId, repoName) => {
  const chunks = [];

  for (const node of parsedNodes) {
    const code = (node.code || '').trim();
    const nodeType = node.type || 'function';
    const isHighSignal = ['function', 'method', 'class', 'file'].includes(nodeType);

    // Skip very small or noisy helper chunks early. This keeps large repos fast without losing useful code.
    if (CHUNK_STRATEGY === 'selective') {
      const keepTypes = new Set(['function', 'method', 'class', 'file']);
      const isExported = Boolean(node.isExported || node.exported || node.isExport);
      if (!keepTypes.has(nodeType) && !isExported) continue;
      if (code.length < SELECTIVE_MIN_CHARS) continue;
      if (nodeType === 'function' && /^(use[A-Z]|handle[A-Z]|on[A-Z]|render[A-Z])/.test(node.name || '')) {
        if (code.length < 300) continue;
      }
    } else {
      if (code.length < 30) continue;
    }

    if (!isHighSignal && code.length < 400) continue;

    // If the code block is very large, split it into overlapping sub-chunks
    const subChunks = splitLargeChunk(code);

    for (let i = 0; i < subChunks.length; i++) {
      const subCode = subChunks[i];
      if (subCode.trim().length < 80) continue;

      // Build a rich natural-language prefix so the embedding captures intent
      const textPrefix = buildTextPrefix(node, repoName);
      const text = `${textPrefix}\n\n${subCode}`;

      chunks.push({
        id: uuidv4(),
        text,
        metadata: {
          repoId,
          repoName,
          path: node.filePath || '',
          language: extToLanguage(node.extension || '.js'),
          chunkType: nodeType,
          functionName: (nodeType === 'function' || nodeType === 'method') ? (node.name || '') : '',
          className: node.className || (nodeType === 'class' ? node.name : '') || '',
          startLine: node.startLine || 1,
          endLine: node.endLine || 1,
          subChunkIndex: i,
          totalSubChunks: subChunks.length,
          content: subCode.slice(0, 1500),
        },
      });
    }
  }

  if (chunks.length > MAX_REPO_CHUNKS) {
    chunks.sort((a, b) => (b.text.length + (b.metadata?.content?.length || 0)) - (a.text.length + (a.metadata?.content?.length || 0)));
    return chunks.slice(0, MAX_REPO_CHUNKS);
  }

  return chunks;
};

/**
 * Build a rich text prefix for better semantic embedding
 */
const buildTextPrefix = (node, repoName) => {
  const parts = [`Repository: ${repoName}`];

  if (node.filePath) {
    parts.push(`File: ${node.filePath}`);
  }

  if (node.type === 'class') {
    parts.push(`Class: ${node.name}`);
  } else if (node.type === 'method' && node.className) {
    parts.push(`Class: ${node.className}`);
    parts.push(`Method: ${node.name}`);
  } else if (node.type === 'function') {
    parts.push(`Function: ${node.name}`);
  } else if (node.type === 'file') {
    parts.push(`Module: ${node.name}`);
  }

  return parts.join('\n');
};

/**
 * Split a large code block into overlapping chunks
 */
const splitLargeChunk = (code) => {
  if (code.length <= MAX_CHUNK_CHARS) return [code];

  const chunks = [];
  const overlap = 500;
  let start = 0;

  while (start < code.length) {
    const end = Math.min(start + MAX_CHUNK_CHARS, code.length);
    chunks.push(code.slice(start, end));
    if (end === code.length) break;
    start = end - overlap;
  }

  return chunks;
};

/**
 * Map file extension to language name
 */
const extToLanguage = (ext) => {
  const map = {
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.py': 'python',
    '.java': 'java',
    '.go': 'go',
    '.rb': 'ruby',
    '.rs': 'rust',
    '.cpp': 'cpp',
    '.c': 'c',
    '.cs': 'csharp',
    '.php': 'php',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.md': 'markdown',
    '.json': 'json',
    '.html': 'html',
    '.css': 'css',
  };
  return map[ext] || 'text';
};

module.exports = { buildChunks };

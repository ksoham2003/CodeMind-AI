const { v4: uuidv4 } = require('uuid');

const MAX_CHUNK_CHARS = 6000; // ~1500 tokens — safe for embedding models

// Chunking strategy: 'full' (default) indexes all eligible parsed nodes,
// 'selective' only indexes high-value nodes (functions, methods, classes, exported symbols)
const CHUNK_STRATEGY = (process.env.EMBED_CHUNK_STRATEGY || 'full').toLowerCase();
const SELECTIVE_MIN_CHARS = parseInt(process.env.SELECTIVE_MIN_CHARS || '50', 10);

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
    // Skip trivially small chunks (getters, 1-liners with no real content)
    const code = (node.code || '').trim();

    // If using selective strategy, only keep functions/methods/classes or
    // explicitly exported/top-level modules. This reduces the number of
    // embeddings dramatically while keeping high-signal code.
    if (CHUNK_STRATEGY === 'selective') {
      const keepTypes = new Set(['function', 'method', 'class', 'file', 'module']);
      const isExported = Boolean(node.isExported || node.exported || node.isExport);
      if (!keepTypes.has(node.type) && !isExported) continue;
      if (code.length < SELECTIVE_MIN_CHARS) continue;
    } else {
      if (code.length < 30) continue;
    }

    // If the code block is very large, split it into overlapping sub-chunks
    const subChunks = splitLargeChunk(code);

    for (let i = 0; i < subChunks.length; i++) {
      const subCode = subChunks[i];

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
          chunkType: node.type || 'function',
          // Pinecone does not accept null — use empty string for optional fields
          functionName: (node.type === 'function' || node.type === 'method') ? (node.name || '') : '',
          className: node.className || (node.type === 'class' ? node.name : '') || '',
          startLine: node.startLine || 1,
          endLine: node.endLine || 1,
          subChunkIndex: i,
          totalSubChunks: subChunks.length,
          // Store first 1500 chars of code for display in the frontend
          content: subCode.slice(0, 1500),
        },
      });
    }
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

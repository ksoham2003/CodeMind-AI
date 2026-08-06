/**
 * Parser Service — AST-based code extraction using Tree-sitter
 * Falls back to regex-based extraction if Tree-sitter fails to load native bindings.
 *
 * Extracts:
 * - Functions (declarations, expressions, arrow functions)
 * - Classes and their methods
 * - React components
 * - Express routes
 */

let treeSitterAvailable = false;
let Parser, JavaScript, TypeScript, TSX;

try {
  Parser = require('tree-sitter');
  JavaScript = require('tree-sitter-javascript');
  TypeScript = require('tree-sitter-typescript/typescript');
  TSX = require('tree-sitter-typescript/tsx');
  treeSitterAvailable = true;
} catch (e) {
  console.warn('⚠️  Tree-sitter native bindings not available, using regex fallback parser');
}

// ---------------------------------------------------------------------------
// Tree-sitter based parser
// ---------------------------------------------------------------------------

const SUPPORTED_LANGUAGES = {
  '.js': () => JavaScript,
  '.jsx': () => JavaScript,
  '.ts': () => TypeScript,
  '.tsx': () => TSX,
};

/**
 * Extract the text of a node from source code
 */
const nodeText = (node, source) => source.slice(node.startIndex, node.endIndex);

/**
 * Get identifier name from a node's children
 */
const getIdentifier = (node, source) => {
  const nameNode =
    node.childForFieldName?.('name') ||
    node.children?.find((c) => c.type === 'identifier');
  return nameNode ? nodeText(nameNode, source) : null;
};

/**
 * Parse a single file with Tree-sitter
 * @returns {{ type, name, code, startLine, endLine }[]}
 */
const parseWithTreeSitter = (source, language) => {
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(source);
  const chunks = [];

  const visit = (node, className = null) => {
    switch (node.type) {
      case 'function_declaration':
      case 'function_expression': {
        const name = getIdentifier(node, source) || 'anonymous';
        chunks.push({
          type: 'function',
          name,
          className,
          code: nodeText(node, source),
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
        break;
      }

      case 'arrow_function': {
        // Try to get the name from the parent variable declarator
        const parent = node.parent;
        let name = 'anonymous';
        if (parent?.type === 'variable_declarator') {
          name = getIdentifier(parent, source) || 'anonymous';
        }
        // Only record top-level arrow functions or those with a name
        if (name !== 'anonymous' || (node.startPosition.row !== node.endPosition.row)) {
          chunks.push({
            type: 'function',
            name,
            className,
            code: nodeText(node.parent?.parent || node, source),
            startLine: (node.parent?.parent || node).startPosition.row + 1,
            endLine: (node.parent?.parent || node).endPosition.row + 1,
          });
        }
        break;
      }

      case 'method_definition': {
        const name = getIdentifier(node, source) || 'method';
        chunks.push({
          type: 'method',
          name,
          className,
          code: nodeText(node, source),
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
        break;
      }

      case 'class_declaration':
      case 'class': {
        const name = getIdentifier(node, source) || 'AnonymousClass';
        chunks.push({
          type: 'class',
          name,
          className: null,
          code: nodeText(node, source),
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
        // Visit class body with class context
        for (const child of node.children || []) {
          visit(child, name);
        }
        return; // Don't double-visit children below
      }

      case 'export_statement': {
        // Handle export default function / export const X = ...
        for (const child of node.children || []) {
          visit(child, className);
        }
        return;
      }
    }

    // Recurse into children
    for (const child of node.children || []) {
      visit(child, className);
    }
  };

  visit(tree.rootNode);

  // Deduplicate by startLine
  const seen = new Set();
  return chunks.filter((c) => {
    const key = `${c.startLine}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// ---------------------------------------------------------------------------
// Regex fallback parser
// ---------------------------------------------------------------------------

/**
 * Simple regex-based extractor for when Tree-sitter is unavailable
 */
const parseWithRegex = (source) => {
  const chunks = [];
  const lines = source.split('\n');

  // Match: function name(...) {  OR  const name = (...) =>  OR  async function name
  const patterns = [
    // Named function declarations
    /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/m,
    // Arrow function / const
    /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(.*\)\s*=>/m,
    // Class declarations
    /^(?:export\s+)?class\s+(\w+)/m,
  ];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        const name = match[1];
        // Grab up to 60 lines as the "chunk"
        const endLine = Math.min(i + 60, lines.length - 1);
        const code = lines.slice(i, endLine + 1).join('\n');

        let type = 'function';
        if (line.includes('class ')) type = 'class';

        chunks.push({
          type,
          name,
          className: null,
          code,
          startLine: i + 1,
          endLine: endLine + 1,
        });
        break;
      }
    }
    i++;
  }

  return chunks;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a file and extract code chunks
 * @param {{ path, relativePath, content, extension }} file
 * @returns {{ type, name, className, code, startLine, endLine }[]}
 */
const parseFile = (file) => {
  try {
    if (treeSitterAvailable && SUPPORTED_LANGUAGES[file.extension]) {
      const language = SUPPORTED_LANGUAGES[file.extension]();
      return parseWithTreeSitter(file.content, language);
    }
  } catch (e) {
    // Tree-sitter failed for this file, fall through to regex
  }
  return parseWithRegex(file.content);
};

/**
 * Parse a list of files and return all chunks with file metadata
 */
const parseFiles = (files) => {
  const allChunks = [];

  for (const file of files) {
    const chunks = parseFile(file);

    // If parser found no named chunks, treat the whole file as one chunk
    if (chunks.length === 0 && file.content.trim().length > 0) {
      allChunks.push({
        type: 'file',
        name: file.relativePath.split('/').pop(),
        className: null,
        code: file.content.slice(0, 4000), // Cap at 4000 chars
        startLine: 1,
        endLine: file.content.split('\n').length,
        filePath: file.relativePath,
        extension: file.extension,
      });
    } else {
      for (const chunk of chunks) {
        allChunks.push({
          ...chunk,
          filePath: file.relativePath,
          extension: file.extension,
        });
      }
    }
  }

  return allChunks;
};

module.exports = { parseFile, parseFiles };

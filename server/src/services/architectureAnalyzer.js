/**
 * architectureAnalyzer.js
 * ─────────────────────────────────────────────────────────
 * Pure static analysis: takes indexed code chunks and produces
 * a structured ArchitectureFacts object that can be sent to
 * Ollama for interpretation (much cheaper / more reliable than
 * sending raw code).
 *
 * Pipeline:
 *   chunks → classify files into layers
 *           → detect technologies
 *           → extract imports / exports / routes
 *           → build dependency graph
 *           → return ArchitectureFacts JSON
 */

// ── Layer classifiers ──────────────────────────────────────────────────────

const LAYER_PATTERNS = [
  { layer: 'routes',      patterns: [/\/routes?\//i, /router\./i, /route\.js/i] },
  { layer: 'controllers', patterns: [/\/controllers?\//i, /Controller\.(js|ts)$/i] },
  { layer: 'services',    patterns: [/\/services?\//i, /Service\.(js|ts)$/i] },
  { layer: 'models',      patterns: [/\/models?\//i, /Model\.(js|ts)$/i, /schema\.(js|ts)$/i] },
  { layer: 'middleware',  patterns: [/\/middleware\//i, /Middleware\.(js|ts)$/i] },
  { layer: 'workers',     patterns: [/\/workers?\//i, /Worker\.(js|ts)$/i, /queue/i] },
  { layer: 'config',      patterns: [/\/config\//i, /\.config\.(js|ts)$/i, /\/config\.(js|ts)$/i] },
  { layer: 'pages',       patterns: [/\/pages?\//i, /Page\.(jsx|tsx)$/i] },
  { layer: 'components',  patterns: [/\/components?\//i, /\.(jsx|tsx)$/] },
  { layer: 'hooks',       patterns: [/\/hooks?\//i, /use[A-Z]/] },
  { layer: 'utils',       patterns: [/\/utils?\//i, /\/helpers?\//i, /\/lib\//i] },
  { layer: 'tests',       patterns: [/\.(test|spec)\.(js|ts|jsx|tsx)$/i, /\/__tests__\//i] },
];

function classifyFile(filePath) {
  for (const { layer, patterns } of LAYER_PATTERNS) {
    if (patterns.some((p) => p.test(filePath))) return layer;
  }
  return 'other';
}

// ── Technology detector ────────────────────────────────────────────────────

const TECH_SIGNATURES = [
  { name: 'Express.js',         regex: /require\(['"]express['"]\)|from ['"]express['"]/ },
  { name: 'MongoDB/Mongoose',   regex: /require\(['"]mongoose['"]\)|from ['"]mongoose['"]/ },
  { name: 'Redis',              regex: /require\(['"]ioredis['"]\)|require\(['"]redis['"]\)|from ['"]ioredis['"]/ },
  { name: 'BullMQ',             regex: /require\(['"]bullmq['"]\)|from ['"]bullmq['"]/ },
  { name: 'Socket.io',          regex: /require\(['"]socket\.io['"]\)|from ['"]socket\.io['"]/ },
  { name: 'React',              regex: /from ['"]react['"]|require\(['"]react['"]\)/ },
  { name: 'React Router',       regex: /from ['"]react-router/ },
  { name: 'Axios',              regex: /require\(['"]axios['"]\)|from ['"]axios['"]/ },
  { name: 'JWT',                regex: /require\(['"]jsonwebtoken['"]\)|from ['"]jsonwebtoken['"]/ },
  { name: 'OpenAI',             regex: /require\(['"]openai['"]\)|from ['"]openai['"]/ },
  { name: 'Groq',               regex: /require\(['"]groq-sdk['"]\)|from ['"]groq-sdk['"]/ },
  { name: 'Ollama (Local LLM)', regex: /OLLAMA|local-llm|localLlm|ollama/ },
  { name: 'FastAPI',            regex: /from fastapi|import fastapi/ },
];

function detectTechnologies(allText) {
  return TECH_SIGNATURES
    .filter(({ regex }) => regex.test(allText))
    .map(({ name }) => name);
}

// ── Import extractor ───────────────────────────────────────────────────────

const REQUIRE_RE = /require\(['"]([^'"]+)['"]\)/g;
const IMPORT_RE  = /import\s+(?:[\w\s{},*]+\s+from\s+)?['"]([^'"]+)['"]/g;

function extractImports(text) {
  const imports = new Set();
  let m;
  REQUIRE_RE.lastIndex = 0;
  while ((m = REQUIRE_RE.exec(text)) !== null) imports.add(m[1]);
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(text)) !== null) imports.add(m[1]);
  return [...imports].filter((i) => i.startsWith('.'));
}

// ── Route extractor ────────────────────────────────────────────────────────

const ROUTE_RE = /(?:router|app)\s*\.\s*(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi;

function extractRoutes(text) {
  const routes = [];
  let m;
  ROUTE_RE.lastIndex = 0;
  while ((m = ROUTE_RE.exec(text)) !== null) {
    routes.push(`${m[1].toUpperCase()} ${m[2]}`);
  }
  return routes;
}

// ── Relative path resolver ─────────────────────────────────────────────────

function resolveRelative(sourcePath, relativePath) {
  const parts = sourcePath.split('/');
  parts.pop();
  const relParts = relativePath.split('/');
  for (const part of relParts) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
}

// ── Main analyzer ──────────────────────────────────────────────────────────

/**
 * Analyze code chunks and produce structured ArchitectureFacts.
 * @param {{ text: string, metadata: { path: string, functionName?: string, className?: string } }[]} chunks
 * @returns {object} ArchitectureFacts
 */
function analyzeArchitecture(chunks) {
  const fileMap = new Map();

  for (const chunk of chunks) {
    const path = chunk.metadata?.path || 'unknown';
    if (!fileMap.has(path)) {
      fileMap.set(path, {
        path,
        layer: classifyFile(path),
        text: '',
        imports: [],
        routes: [],
        functions: new Set(),
        classes: new Set(),
      });
    }
    const entry = fileMap.get(path);
    entry.text += '\n' + (chunk.text || '');
    if (chunk.metadata?.functionName) entry.functions.add(chunk.metadata.functionName);
    if (chunk.metadata?.className)    entry.classes.add(chunk.metadata.className);
  }

  const files = [];
  const allTextParts = [];
  const dependencyEdges = [];

  for (const [, entry] of fileMap) {
    entry.imports = extractImports(entry.text);
    entry.routes  = extractRoutes(entry.text);
    allTextParts.push(entry.text);

    for (const imp of entry.imports) {
      const resolved = resolveRelative(entry.path, imp);
      dependencyEdges.push([entry.path, resolved]);
    }

    files.push({
      path: entry.path,
      layer: entry.layer,
      routes: entry.routes,
      functions: [...entry.functions].slice(0, 10),
      classes: [...entry.classes].slice(0, 5),
      importCount: entry.imports.length,
    });
  }

  // Group filenames by layer
  const layers = {};
  for (const f of files) {
    if (!layers[f.layer]) layers[f.layer] = [];
    layers[f.layer].push(f.path.split('/').pop());
  }

  const technologies = detectTechnologies(allTextParts.join('\n'));

  const apiRoutes = files
    .filter((f) => f.routes.length > 0)
    .flatMap((f) => f.routes.map((r) => ({ file: f.path.split('/').pop(), route: r })))
    .slice(0, 20);

  // Build layer-level dependency edges (deduplicated)
  const layerEdgeSet = new Set();
  for (const [src, tgt] of dependencyEdges) {
    const srcLayer = classifyFile(src);
    const tgtLayer = classifyFile(tgt);
    if (srcLayer !== tgtLayer && srcLayer !== 'other' && tgtLayer !== 'other') {
      layerEdgeSet.add(`${srcLayer} → ${tgtLayer}`);
    }
  }

  return {
    filesAnalyzed: fileMap.size,
    chunksProcessed: chunks.length,
    layers,
    technologies,
    apiRoutes,
    layerDependencies: [...layerEdgeSet],
    fileDependencies: dependencyEdges
      .slice(0, 25)
      .map(([s, t]) => [s.split('/').pop(), t.split('/').pop()]),
  };
}

module.exports = { analyzeArchitecture };

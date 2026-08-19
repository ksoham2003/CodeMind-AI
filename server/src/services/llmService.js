const Groq = require('groq-sdk');

let groqClient = null;

const getGroqClient = () => {
  if (!groqClient) {
    if (!process.env.GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY environment variable is not set.');
    }
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groqClient;
};

// LLM model can be overridden via environment variable `LLM_MODEL`.
// Default to a mainstream model that is commonly available if not set.
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';
// Separate model for chat (cheaper/smaller) to reduce cost for conversational flows
const LLM_CHAT_MODEL = process.env.LLM_CHAT_MODEL || LLM_MODEL;
const MAX_CONTEXT_CHUNKS = 8;
const MAX_CONTEXT_CHARS = 12000;

/**
 * Build the RAG system prompt
 */
const buildSystemPrompt = (repoName) => `You are CodeMind AI, an expert code analysis assistant for the repository "${repoName}".

You answer developer questions precisely and clearly, referencing specific files, functions, and line numbers from the provided code context.

Guidelines:
- Be specific: cite exact file paths and function names
- Explain the WHY, not just the WHAT
- If the answer spans multiple files, describe each part
- Use markdown formatting with code blocks for code snippets
- If context doesn't have the answer, say so clearly rather than guessing
- Keep answers focused and actionable`;

/**
 * Build the user prompt with retrieved code context
 */
const buildUserPrompt = (question, retrievedChunks) => {
  let contextText = '';
  let totalChars = 0;

  for (const chunk of retrievedChunks.slice(0, MAX_CONTEXT_CHUNKS)) {
    const meta = chunk.metadata;
    const header = `--- File: ${meta.path} | ${meta.chunkType}: ${meta.functionName || meta.className || meta.path.split('/').pop()} | Lines ${meta.startLine}-${meta.endLine} ---`;
    const section = `${header}\n${meta.content}\n\n`;

    if (totalChars + section.length > MAX_CONTEXT_CHARS) break;
    contextText += section;
    totalChars += section.length;
  }

  return `Here is the relevant code context retrieved from the repository:

${contextText}

Developer Question: ${question}

Please provide a precise, well-structured answer referencing the specific files and functions above.`;
};

/**
 * Generate a RAG answer using the retrieved code chunks
 * @param {string} question - User's question
 * @param {object[]} retrievedChunks - Pinecone query matches
 * @param {string} repoName - Repository name
 * @returns {{ answer: string, tokensUsed: number }}
 */
const generateAnswer = async (question, retrievedChunks, repoName) => {
  const groq = getGroqClient();
  // Use chat-specific model to reduce cost if configured
  const modelToUse = LLM_CHAT_MODEL || LLM_MODEL;

  const response = await groq.chat.completions.create({
    model: modelToUse,
    messages: [
      { role: 'system', content: buildSystemPrompt(repoName) },
      { role: 'user', content: buildUserPrompt(question, retrievedChunks) }
    ],
    temperature: 0.1,
    max_tokens: 2000,
  });

  const answer = response.choices[0].message.content;
  const tokensUsed = response.usage?.total_tokens || 0;

  return { answer, tokensUsed };
};

/**
 * Stream a RAG answer (returns async generator)
 * @param {string} question
 * @param {object[]} retrievedChunks
 * @param {string} repoName
 * @returns AsyncIterable of text chunks
 */
const streamAnswer = async function* (question, retrievedChunks, repoName) {
  const groq = getGroqClient();
  // Stream using chat-optimized model to save cost
  const modelToUse = LLM_CHAT_MODEL || LLM_MODEL;

  const stream = await groq.chat.completions.create({
    model: modelToUse,
    messages: [
      { role: 'system', content: buildSystemPrompt(repoName) },
      { role: 'user', content: buildUserPrompt(question, retrievedChunks) }
    ],
    temperature: 0.1,
    max_tokens: 2000,
    stream: true,
  });

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content || '';
    if (text) {
      yield text;
    }
  }
};

/**
 * Architecture diagram prompt templates per type
 */
const ARCHITECTURE_PROMPTS = {
  component: `Analyze the code context and generate a Mermaid diagram showing the COMPONENT HIERARCHY of this codebase.

Rules:
- Use "graph TD" (top-down) syntax
- Show parent → child component relationships
- Include page components, layout components, and reusable UI components
- Label edges with the relationship using Mermaid vertical bar format: A -->|renders| B. DO NOT use colons (e.g. A --> B : renders) and DO NOT append extra characters like A -->|renders|>.
- Use subgraphs to group by feature area or directory
- DO NOT draw link/connection lines directly to or from subgraph names (e.g. DO NOT draw "Frontend" --> "Backend"). Subgraphs should only structure the groups; draw connections between internal leaf nodes instead.
- Give each node a short readable label, use the actual component/module names
- Quote ALL node names/labels that contain special characters like parentheses, slashes, or dots (e.g., use "app.js" --> "App.jsx" instead of app.js --> App.jsx)
- Do NOT use parentheses in node IDs — only in quoted labels
- Keep the diagram focused and readable (max ~30 nodes)`,

  dependency: `Analyze the code context and generate a Mermaid diagram showing the FILE DEPENDENCY GRAPH.

Rules:
- Use "graph LR" (left-right) syntax
- Show which files import/require which other files
- Group files by directory using subgraphs
- Use arrows from importer → imported module with a relationship label: A -->|imports| B. DO NOT use colons (e.g. A --> B : imports) and DO NOT append extra characters like A -->|imports|>.
- DO NOT draw link/connection lines directly to or from subgraph names (e.g. DO NOT draw "Frontend" --> "Backend"). Connect internal leaf nodes instead.
- Include key npm packages as external nodes (styled differently)
- Quote ALL node names/labels that contain special characters like parentheses, slashes, or dots (e.g., use "app.js" --> "App.jsx" instead of app.js --> App.jsx)
- Do NOT use parentheses in node IDs — only in quoted labels
- Keep the diagram focused on the most important ~25 files`,

  'api-routes': `Analyze the code context and generate a Mermaid diagram showing the API ROUTE FLOW.

Rules:
- Use "graph LR" (left-right) syntax
- Show: HTTP Method + Path → Route Handler → Controller → Service → Database/External
- Use subgraphs for Route Groups, Controllers, Services, and Data layers
- Include middleware in the flow when relevant
- Label edges with HTTP methods using vertical bars: A -->|GET| B. DO NOT use colons (e.g. A --> B : GET) and DO NOT append extra characters like A -->|GET|>.
- DO NOT draw link/connection lines directly to or from subgraph names (e.g. DO NOT draw "Frontend" --> "Backend"). Connect internal leaf nodes instead.
- Quote ALL node names/labels that contain special characters like parentheses, slashes, or dots (e.g., use "app.js" --> "App.jsx" instead of app.js --> App.jsx)
- Do NOT use parentheses in node IDs — only in quoted labels
- Keep the diagram focused and readable`,
};

const parseMermaidGraph = (mermaidCode) => {
  const lines = mermaidCode
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const directionMatch = lines[0]?.match(/^graph\s+(LR|RL|TD|BT)/i);
  const direction = directionMatch?.[1]?.toUpperCase() || 'LR';

  const nodeMap = new Map();
  const edges = [];
  const connectionRegex = /^(?:"([^"]+)"|([^"\s\[]+))(?:\[(?:"([^"]+)"|([^"\]]+))\])?\s*([-.]+>+|-->|==>)\s*(?:\|([^|]+)\|\s*)?(?:"([^"]+)"|([^"\s\[]+))(?:\[(?:"([^"]+)"|([^"\]]+))\])?$/;

  for (const line of lines.slice(1)) {
    if (line.startsWith('subgraph') || line === 'end') {
      continue;
    }

    const match = line.match(connectionRegex);
    if (!match) {
      continue;
    }

    const sourceId = match[1] || match[2];
    const sourceLabel = match[3] || match[4] || sourceId;
    const edgeTypeRaw = match[5] || '-->';
    const edgeLabel = match[6] ? match[6].trim() : '';
    const targetId = match[7] || match[8];
    const targetLabel = match[9] || match[10] || targetId;

    if (!nodeMap.has(sourceId)) {
      nodeMap.set(sourceId, {
        id: sourceId,
        label: sourceLabel,
      });
    }

    if (!nodeMap.has(targetId)) {
      nodeMap.set(targetId, {
        id: targetId,
        label: targetLabel,
      });
    }

    edges.push({
      id: `e-${sourceId}-${targetId}-${edges.length}`,
      source: sourceId,
      target: targetId,
      label: edgeLabel || undefined,
    });
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges,
    direction,
  };
};

/**
 * Build system prompt for architecture diagram generation
 */
const buildArchitectureSystemPrompt = (repoName, diagramType) => {
  const typePrompt = ARCHITECTURE_PROMPTS[diagramType] || ARCHITECTURE_PROMPTS.component;

  return `You are CodeMind AI, an expert code architecture analyst for the repository "${repoName}".

Your task is to generate a structured graph object and a brief summary of the codebase architecture.

${typePrompt}

IMPORTANT: Respond in EXACTLY this format:

\`\`\`json
{
  "nodes": [
    { "id": "node1", "label": "Node 1" },
    { "id": "node2", "label": "Node 2" }
  ],
  "edges": [
    { "id": "edge1", "source": "node1", "target": "node2", "label": "imports" }
  ],
  "direction": "LR"
}
\`\`\`

**Summary:** <2-3 sentence summary of what the graph shows>

Do NOT include any other text or markdown outside this exact JSON block and the summary.`;
};

/**
 * Build context from retrieved chunks for architecture analysis
 */
const buildArchitectureContext = (retrievedChunks, fileTree) => {
  let contextText = '';
  let totalChars = 0;
  const maxChars = 18000; // More context for architecture analysis

  for (const chunk of retrievedChunks.slice(0, 20)) {
    const meta = chunk.metadata;
    const header = `--- File: ${meta.path} | ${meta.chunkType}: ${meta.functionName || meta.className || meta.path.split('/').pop()} | Lines ${meta.startLine}-${meta.endLine} ---`;
    const section = `${header}\n${meta.content}\n\n`;

    if (totalChars + section.length > maxChars) break;
    contextText += section;
    totalChars += section.length;
  }

  // Include file tree summary if available
  let fileTreeSummary = '';
  if (fileTree) {
    fileTreeSummary = '\n--- File Tree Structure ---\n' + JSON.stringify(fileTree, null, 2).slice(0, 3000) + '\n\n';
  }

  return `Here is the repository code context:\n\n${fileTreeSummary}${contextText}`;
};

/**
 * Generate an architecture diagram using the LLM
 * @param {object[]} retrievedChunks - Pinecone query matches
 * @param {string} repoName - Repository name
 * @param {string} diagramType - 'component' | 'dependency' | 'api-routes'
 * @param {object} fileTree - File tree from Project model
 * @returns {{ mermaidCode: string, summary: string, tokensUsed: number }}
 */
const generateArchitectureDiagram = async (retrievedChunks, repoName, diagramType, fileTree) => {
  const groq = getGroqClient();
  // Attempt LLM call, with optional fallback retry for model_not_found errors
  let response;
  try {
    response = await groq.chat.completions.create({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: buildArchitectureSystemPrompt(repoName, diagramType) },
        { role: 'user', content: buildArchitectureContext(retrievedChunks, fileTree) },
      ],
      temperature: 0.15,
      max_tokens: 3000,
    });
  } catch (err) {
    // If model not found, try fallback models if configured
    const isModelNotFound = err && (err.status === 404 || (err.error && err.error.error && err.error.error.code === 'model_not_found') || (err.error && err.error.code === 'model_not_found'));
    if (isModelNotFound) {
      console.warn('LLM model not found:', LLM_MODEL, '— attempting fallback models');
      const fallbackCandidates = [];
      if (process.env.LLM_FALLBACK_MODEL) fallbackCandidates.push(process.env.LLM_FALLBACK_MODEL);
      // Common alternative model names to try (only if not equal to primary)
      ['gpt-4o', 'gpt-4'].forEach((m) => {
        if (m && m !== LLM_MODEL) fallbackCandidates.push(m);
      });

      for (const candidate of fallbackCandidates) {
        try {
          console.log('Trying fallback model:', candidate);
          response = await groq.chat.completions.create({
            model: candidate,
            messages: [
              { role: 'system', content: buildArchitectureSystemPrompt(repoName, diagramType) },
              { role: 'user', content: buildArchitectureContext(retrievedChunks, fileTree) },
            ],
            temperature: 0.15,
            max_tokens: 3000,
          });
          console.log('Fallback model succeeded:', candidate);
          break;
        } catch (retryErr) {
          console.warn('Fallback model failed:', candidate, retryErr && retryErr.message ? retryErr.message : retryErr);
          // continue to next candidate
        }
      }
    } else {
      // Not a model-not-found error — rethrow for upstream handling
      throw err;
    }
  }

  if (!response) {
    throw new Error('LLM call failed and no fallback model succeeded');
  }

  const fullAnswer = response.choices[0].message.content;
  const tokensUsed = response.usage?.total_tokens || 0;

  const summaryMatch = fullAnswer.match(/\*\*Summary:\*\*\s*(.*)/);
  const summary = summaryMatch
    ? summaryMatch[1].trim()
    : 'Architecture diagram generated from repository analysis.';

  const jsonMatch = fullAnswer.match(/```json\s*([\s\S]*?)```/);
  let graph = null;
  let jsonText = '';

  if (jsonMatch) {
    jsonText = jsonMatch[1].trim();
  } else {
    const firstBrace = fullAnswer.indexOf('{');
    const lastBrace = fullAnswer.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonText = fullAnswer.slice(firstBrace, lastBrace + 1);
    }
  }

  if (jsonText) {
    try {
      graph = JSON.parse(jsonText);
    } catch (err) {
      console.warn('Failed to parse architecture graph JSON:', err.message || err);
    }
  }

  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    graph = {
      nodes: [
        { id: 'A', label: 'No code chunks found' },
        { id: 'B', label: 'Try again or re-index the repository' },
      ],
      edges: [
        { id: 'e-A-B', source: 'A', target: 'B' },
      ],
      direction: 'LR',
    };
  }

  return { graph, summary, tokensUsed };
};

module.exports = { generateAnswer, streamAnswer, generateArchitectureDiagram };

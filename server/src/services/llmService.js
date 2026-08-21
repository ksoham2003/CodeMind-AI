const Groq = require('groq-sdk');
const OpenAI = require('openai');
const { getRedis } = require('../config/redis');
const crypto = require('crypto');

let groqClient = null;
let openaiClient = null;

const getGroqClient = () => {
  if (!groqClient) {
    if (!process.env.GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY environment variable is not set.');
    }
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groqClient;
};

const getOpenAIClient = () => {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set.');
    }
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
};

const normalizeOpenAIText = (response) => {
  if (response.output_text) return response.output_text;

  const output = response.output || [];
  const combined = [];

  for (const item of output) {
    if (item.type === 'message' && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (part.type === 'output_text' || part.type === 'text') {
          combined.push(part.text || part.value || '');
        }
      }
    }
  }

  return combined.join('\n').trim();
};

const getPreferredProvider = () => {
  // Allow explicit override via LLM_PROVIDER env var: 'openai' | 'groq'
  if (process.env.LLM_PROVIDER) {
    const p = process.env.LLM_PROVIDER.toLowerCase();
    if (p === 'openai') {
      if (!process.env.OPENAI_API_KEY) throw new Error('LLM_PROVIDER=openai but OPENAI_API_KEY is not set.');
      return 'openai';
    }
    if (p === 'groq') {
      if (!process.env.GROQ_API_KEY) throw new Error('LLM_PROVIDER=groq but GROQ_API_KEY is not set.');
      return 'groq';
    }
    throw new Error(`Unknown LLM_PROVIDER=${process.env.LLM_PROVIDER}`);
  }
  // Respect an explicit fallback priority list if provided.
  // Example: LLM_FALLBACK_PRIORITY="openai,groq,gemini"
  if (process.env.LLM_FALLBACK_PRIORITY) {
    const order = process.env.LLM_FALLBACK_PRIORITY.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    for (const candidate of order) {
      if (candidate === 'openai' && process.env.OPENAI_API_KEY) return 'openai';
      if (candidate === 'groq' && process.env.GROQ_API_KEY) return 'groq';
      if (candidate === 'gemini' && process.env.GEMINI_API_KEY) return 'gemini';
    }
  }

  // Default behavior: prefer OpenAI, then Groq, then Gemini
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.GROQ_API_KEY) return 'groq';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  throw new Error('No LLM API key configured. Set OPENAI_API_KEY, GROQ_API_KEY, or GEMINI_API_KEY.');
};

// LLM model can be overridden via environment variable `LLM_MODEL`.
// Default to a mainstream model that is commonly available if not set.
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';
// Prefer a cheaper chat model by default to reduce conversational costs; env overrides still apply
const LLM_CHAT_MODEL = process.env.LLM_CHAT_MODEL || process.env.LLM_MODEL || 'gpt-3.5-turbo';
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
const LLM_RESPONSE_CACHE_TTL = Number(process.env.LLM_RESPONSE_CACHE_TTL || 30); // seconds

// In-memory map to coalesce identical in-flight LLM requests within this process
const inFlightRequests = new Map(); // cacheKey -> Promise

const generateAnswer = async (question, retrievedChunks, repoName) => {
  const provider = getPreferredProvider();

  // Compute a short cache key for this question+context
  const modelId = LLM_CHAT_MODEL || LLM_MODEL;
  const cacheKey = 'llm:resp:' + crypto.createHash('sha256').update(provider + '|' + modelId + '|' + repoName + '|' + question).digest('hex');

  try {
    const redis = getRedis();
    // Try Redis cache
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (e) {
      // ignore cache read errors
    }

    // If identical call is in-flight, await its promise
    if (inFlightRequests.has(cacheKey)) {
      return await inFlightRequests.get(cacheKey);
    }

    const promise = (async () => {
      // Original generation logic follows
      if (provider === 'openai') {
        const client = getOpenAIClient();
        const modelToUse = LLM_CHAT_MODEL || LLM_MODEL;

        try {
          const response = await client.responses.create({
            model: modelToUse,
            input: [
              { role: 'system', content: buildSystemPrompt(repoName) },
              { role: 'user', content: buildUserPrompt(question, retrievedChunks) },
            ],
            temperature: 0.1,
            max_output_tokens: 2000,
          });

          return {
            answer: normalizeOpenAIText(response),
            tokensUsed: response.usage?.total_tokens || 0,
          };
        } catch (err) {
          const isQuota = err?.code === 'insufficient_quota' || (err?.status === 429) || /quota|insufficient/i.test(err?.message || '');
          console.warn('OpenAI call failed:', err?.message || err);
          // Attempt fallback to Groq if available
          if (isQuota && process.env.GROQ_API_KEY) {
            console.log('Falling back to Groq due to OpenAI quota/error');
            const groq = getGroqClient();
            const response = await groq.chat.completions.create({
              model: LLM_CHAT_MODEL || LLM_MODEL,
              messages: [
                { role: 'system', content: buildSystemPrompt(repoName) },
                { role: 'user', content: buildUserPrompt(question, retrievedChunks) }
              ],
              temperature: 0.1,
              max_tokens: 2000,
            });

            return { answer: response.choices[0].message.content, tokensUsed: response.usage?.total_tokens || 0 };
          }

          // Retry with fallback model if configured
          if (isQuota && process.env.LLM_FALLBACK_MODEL) {
            try {
              console.log('Retrying OpenAI with fallback model:', process.env.LLM_FALLBACK_MODEL);
              const resp2 = await client.responses.create({
                model: process.env.LLM_FALLBACK_MODEL,
                input: [
                  { role: 'system', content: buildSystemPrompt(repoName) },
                  { role: 'user', content: buildUserPrompt(question, retrievedChunks) },
                ],
                temperature: 0.1,
                max_output_tokens: 2000,
              });
              return {
                answer: normalizeOpenAIText(resp2),
                tokensUsed: resp2.usage?.total_tokens || 0,
              };
            } catch (err2) {
              console.warn('Fallback model retry failed:', err2?.message || err2);
            }
          }

          throw err;
        }
      }

      const groq = getGroqClient();
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
    })();

    inFlightRequests.set(cacheKey, promise);
    try {
      const result = await promise;
      // Cache short-term to reduce duplicate work
      try {
        await getRedis().set(cacheKey, JSON.stringify(result), 'EX', LLM_RESPONSE_CACHE_TTL);
      } catch (e) {
        /* ignore cache write errors */
      }
      return result;
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  } catch (e) {
    console.warn('LLM cache/coalesce error:', e?.message || e);
    // fallback to direct call if caching/coalescing fails
    // (call original logic without caching)
    if (provider === 'openai') {
      const client = getOpenAIClient();
      const modelToUse = LLM_CHAT_MODEL || LLM_MODEL;
      const response = await client.responses.create({
        model: modelToUse,
        input: [
          { role: 'system', content: buildSystemPrompt(repoName) },
          { role: 'user', content: buildUserPrompt(question, retrievedChunks) },
        ],
        temperature: 0.1,
        max_output_tokens: 2000,
      });

      return { answer: normalizeOpenAIText(response), tokensUsed: response.usage?.total_tokens || 0 };
    }

    const groq = getGroqClient();
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

    return { answer: response.choices[0].message.content, tokensUsed: response.usage?.total_tokens || 0 };
};

/**
 * Stream a RAG answer (returns async generator)
 * @param {string} question
 * @param {object[]} retrievedChunks
 * @param {string} repoName
 * @returns AsyncIterable of text chunks
 */
const streamAnswer = async function* (question, retrievedChunks, repoName) {
  const provider = getPreferredProvider();

  if (provider === 'openai') {
    const client = getOpenAIClient();
    const modelToUse = LLM_CHAT_MODEL || LLM_MODEL;
    try {
      const response = await client.responses.create({
        model: modelToUse,
        input: [
          { role: 'system', content: buildSystemPrompt(repoName) },
          { role: 'user', content: buildUserPrompt(question, retrievedChunks) },
        ],
        temperature: 0.1,
        max_output_tokens: 2000,
      });

      const text = normalizeOpenAIText(response);
      if (text) yield text;
      return;
    } catch (err) {
      const isQuota = err?.code === 'insufficient_quota' || (err?.status === 429) || /quota|insufficient/i.test(err?.message || '');
      console.warn('OpenAI streaming failed:', err?.message || err);
      if (isQuota && process.env.GROQ_API_KEY) {
        console.log('Falling back to Groq streaming due to OpenAI quota/error');
        const groq = getGroqClient();
        const stream = await groq.chat.completions.create({
          model: LLM_CHAT_MODEL || LLM_MODEL,
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
        return;
      }

      // If fallback model configured, attempt a non-stream retry
      if (isQuota && process.env.LLM_FALLBACK_MODEL) {
        try {
          console.log('Retrying OpenAI streaming with fallback model (non-stream)');
          const resp2 = await client.responses.create({
            model: process.env.LLM_FALLBACK_MODEL,
            input: [
              { role: 'system', content: buildSystemPrompt(repoName) },
              { role: 'user', content: buildUserPrompt(question, retrievedChunks) },
            ],
            temperature: 0.1,
            max_output_tokens: 2000,
          });
          const text = normalizeOpenAIText(resp2);
          if (text) yield text;
          return;
        } catch (err2) {
          console.warn('Fallback model (non-stream) retry failed:', err2?.message || err2);
        }
      }

      throw err;
    }
  }

  const groq = getGroqClient();
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
  const provider = getPreferredProvider();

  let response;
  let fullAnswer = '';
  let tokensUsed = 0;

  try {
    if (provider === 'openai') {
      const client = getOpenAIClient();
      const modelToUse = LLM_MODEL || 'gpt-4o-mini';
      response = await client.responses.create({
        model: modelToUse,
        input: [
          { role: 'system', content: buildArchitectureSystemPrompt(repoName, diagramType) },
          { role: 'user', content: buildArchitectureContext(retrievedChunks, fileTree) },
        ],
        temperature: 0.15,
        max_output_tokens: 3000,
      });
      fullAnswer = normalizeOpenAIText(response);
      tokensUsed = response.usage?.total_tokens || 0;
    } else {
      const groq = getGroqClient();
      response = await groq.chat.completions.create({
        model: LLM_MODEL,
        messages: [
          { role: 'system', content: buildArchitectureSystemPrompt(repoName, diagramType) },
          { role: 'user', content: buildArchitectureContext(retrievedChunks, fileTree) },
        ],
        temperature: 0.15,
        max_tokens: 3000,
      });
      fullAnswer = response.choices[0].message.content;
      tokensUsed = response.usage?.total_tokens || 0;
    }
  } catch (err) {
    if (provider === 'openai') {
      console.warn('OpenAI architecture generation failed:', err.message || err);
      const groq = getGroqClient();
      const fallbackCandidates = [];
      if (process.env.LLM_FALLBACK_MODEL) fallbackCandidates.push(process.env.LLM_FALLBACK_MODEL);
      ['gpt-4o', 'gpt-4'].forEach((m) => {
        if (m && m !== LLM_MODEL) fallbackCandidates.push(m);
      });

      for (const candidate of fallbackCandidates) {
        try {
          const retryResponse = await groq.chat.completions.create({
            model: candidate,
            messages: [
              { role: 'system', content: buildArchitectureSystemPrompt(repoName, diagramType) },
              { role: 'user', content: buildArchitectureContext(retrievedChunks, fileTree) },
            ],
            temperature: 0.15,
            max_tokens: 3000,
          });
          fullAnswer = retryResponse.choices[0].message.content;
          tokensUsed = retryResponse.usage?.total_tokens || 0;
          break;
        } catch (retryErr) {
          console.warn('Fallback model failed:', candidate, retryErr && retryErr.message ? retryErr.message : retryErr);
        }
      }
    } else {
      const isModelNotFound = err && (err.status === 404 || (err.error && err.error.error && err.error.error.code === 'model_not_found') || (err.error && err.error.code === 'model_not_found'));
      if (isModelNotFound) {
        console.warn('LLM model not found:', LLM_MODEL, '— attempting fallback models');
        const fallbackCandidates = [];
        if (process.env.LLM_FALLBACK_MODEL) fallbackCandidates.push(process.env.LLM_FALLBACK_MODEL);
        ['gpt-4o', 'gpt-4'].forEach((m) => {
          if (m && m !== LLM_MODEL) fallbackCandidates.push(m);
        });

        for (const candidate of fallbackCandidates) {
          try {
            console.log('Trying fallback model:', candidate);
            const retryResponse = await groq.chat.completions.create({
              model: candidate,
              messages: [
                { role: 'system', content: buildArchitectureSystemPrompt(repoName, diagramType) },
                { role: 'user', content: buildArchitectureContext(retrievedChunks, fileTree) },
              ],
              temperature: 0.15,
              max_tokens: 3000,
            });
            fullAnswer = retryResponse.choices[0].message.content;
            tokensUsed = retryResponse.usage?.total_tokens || 0;
            console.log('Fallback model succeeded:', candidate);
            break;
          } catch (retryErr) {
            console.warn('Fallback model failed:', candidate, retryErr && retryErr.message ? retryErr.message : retryErr);
          }
        }
      } else {
        throw err;
      }
    }
  }

  if (!fullAnswer) {
    throw new Error('LLM call failed and no fallback model succeeded');
  }

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

// Explicitly attach exports to avoid partial-export issues
module.exports.generateAnswer = generateAnswer;
module.exports.streamAnswer = streamAnswer;
module.exports.generateArchitectureDiagram = generateArchitectureDiagram;

}

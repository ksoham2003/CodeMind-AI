const Groq = require('groq-sdk');
const OpenAI = require('openai');
const { getRedis } = require('../config/redis');
const crypto = require('crypto');
const localLlm = require('./localLlmService');
const { analyzeArchitecture } = require('./architectureAnalyzer');

// Lazy-initialized singleton clients
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
  if (response == null) return '';
  if (response.output_text) return response.output_text;

  const output = response.output || [];
  const combined = [];

  for (const item of output) {
    if (item == null) continue;
    if (item.type === 'message' && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (!part) continue;
        if (part.type === 'output_text' || part.type === 'text') {
          combined.push(part.text || part.value || '');
        }
      }
    } else if (item.type === 'output_text' || item.type === 'text') {
      combined.push(item.text || item.value || '');
    }
  }

  return combined.join('');
};

const LLM_CHAT_MODEL = process.env.LLM_CHAT_MODEL || process.env.LLM_MODEL || 'gpt-3.5-turbo';
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-3.5-turbo';
const MAX_CONTEXT_CHUNKS = 8;
const MAX_CONTEXT_CHARS = 12000;

const getPreferredProvider = () => {
  if (process.env.LOCAL_LLM_ENABLED === 'true') return 'local';
  return (process.env.LLM_PROVIDER || (process.env.OPENAI_API_KEY ? 'openai' : (process.env.GROQ_API_KEY ? 'groq' : 'none'))).toLowerCase();
};

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
        // Local provider handling with fallbacks
        if (provider === 'local') {
          const modelToUse = LLM_CHAT_MODEL || LLM_MODEL;
          const prompt = buildSystemPrompt(repoName) + '\n\n' + buildUserPrompt(question, retrievedChunks);
          try {
            const j = await localLlm.generate(prompt, { model: modelToUse, temperature: 0.1 });
            return { answer: j.text || j.output || '', tokensUsed: j.tokens || 0 };
          } catch (localErr) {
            console.warn('Local LLM call failed:', localErr && localErr.message ? localErr.message : localErr);
            // Try configured fallback order (env or defaults)
            const fallbacks = (process.env.LLM_FALLBACK_PRIORITY || 'openai,groq,gemini').split(',').map(s => s.trim()).filter(Boolean);
            for (const candidate of fallbacks) {
              try {
                if (candidate === 'openai' && process.env.OPENAI_API_KEY) {
                  const client = getOpenAIClient();
                  const resp = await client.responses.create({
                    model: LLM_CHAT_MODEL || LLM_MODEL,
                    input: [
                      { role: 'system', content: buildSystemPrompt(repoName) },
                      { role: 'user', content: buildUserPrompt(question, retrievedChunks) }
                    ],
                    temperature: 0.1,
                    max_output_tokens: 2000,
                  });
                  return { answer: normalizeOpenAIText(resp), tokensUsed: resp.usage?.total_tokens || 0 };
                }

                if (candidate === 'groq' && process.env.GROQ_API_KEY) {
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
              } catch (fbErr) {
                console.warn('Fallback candidate failed:', candidate, fbErr && fbErr.message ? fbErr.message : fbErr);
              }
            }
            // If all fallbacks failed, rethrow local error
            throw localErr;
          }
        }
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
  }
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

  // If local provider is preferred, try it first and fall back on error
  if (provider === 'local') {
    const modelToUse = LLM_CHAT_MODEL || LLM_MODEL;
    const prompt = buildSystemPrompt(repoName) + '\n\n' + buildUserPrompt(question, retrievedChunks);
    try {
      for await (const chunk of localLlm.stream(prompt, { model: modelToUse, temperature: 0.1 })) {
        yield chunk;
      }
      return;
    } catch (localErr) {
      console.warn('Local LLM streaming failed:', localErr && localErr.message ? localErr.message : localErr);
      // fall through to external providers
    }
  }

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
 * Generate an architecture diagram from code chunks.
 *
 * NEW PIPELINE (static-analysis first):
 *   chunks
 *     → architectureAnalyzer  (pure static analysis, no LLM)
 *     → ArchitectureFacts JSON (layers, technologies, dependencies)
 *     → Ollama prompt with FACTS (not raw code)
 *     → LLM returns structured architecture JSON
 *     → buildGraphFromArchJSON converts to React Flow nodes/edges
 */
const generateArchitectureDiagram = async (chunks, projectId, diagramType = 'component') => {
  if (!chunks || chunks.length === 0) {
    return { success: false, message: 'No code chunks found for analysis' };
  }

  try {
    // ── Step 1: Static analysis ──────────────────────────────────────────
    console.log(`🔍 Running static analysis on ${chunks.length} chunks...`);
    const facts = analyzeArchitecture(chunks);
    console.log(`📊 Facts: ${facts.filesAnalyzed} files, ${facts.technologies.length} technologies, ${facts.layerDependencies.length} layer deps`);

    // ── Step 2: Build LLM prompt from structured facts (NOT raw code) ────
    const factsPrompt = `You are a software architecture expert. Based on the following static analysis facts from a codebase, generate a highly detailed ${diagramType} diagram.

STATIC ANALYSIS FACTS:
${JSON.stringify(facts, null, 2)}

Based on these facts, return a JSON object with this exact structure (no other text):
{
  "pattern": "<architecture pattern e.g. Layered Architecture, Component-Based, MVC, etc>",
  "components": ["<specific component/file name>", ...],
  "relationships": [["<from component/file>", "<to component/file>"], ...],
  "dataflow": "<brief description of main data flow>"
}

Rules:
- DO NOT generalize the entire codebase into just "Frontend" and "Backend". 
- Components MUST be the specific files, modules, or layers found in the facts (e.g., "ImageClipHandler", "useShapeKeypointGesture", "BaseShapeElement", "Controllers").
- For a ${diagramType} diagram, focus on the relationships between these specific files/modules.
- Include at least 5-10 specific nodes based on the provided files in the facts.
- Return ONLY the JSON object, no markdown, no explanation`;


    // ── Step 3: Ask LLM to interpret facts ───────────────────────────────
    const provider = getPreferredProvider();
    const modelToUse = LLM_MODEL;
    let rawResponse = '';

    if (provider === 'local') {
      const result = await localLlm.generate(factsPrompt, { model: modelToUse, temperature: 0.1 });
      rawResponse = result.text || result.output || '';
    } else if (provider === 'groq') {
      const groq = getGroqClient();
      const result = await groq.chat.completions.create({
        model: modelToUse,
        messages: [{ role: 'user', content: factsPrompt }],
        temperature: 0.1,
        max_tokens: 1000,
      });
      rawResponse = result.choices[0]?.message?.content || '';
    } else if (provider === 'openai') {
      const openai = getOpenAIClient();
      const result = await openai.chat.completions.create({
        model: modelToUse,
        messages: [{ role: 'user', content: factsPrompt }],
        temperature: 0.1,
        max_tokens: 1000,
      });
      rawResponse = result.choices[0]?.message?.content || '';
    } else {
      // No LLM — build graph directly from static analysis facts
      rawResponse = buildArchJsonFromFacts(facts);
    }

    // ── Step 4: Parse LLM JSON response ──────────────────────────────────
    let archJson = null;
    try {
      // Strip markdown code blocks if present
      const jsonStr = rawResponse
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();
      // Find the first {...} block
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) archJson = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.warn('⚠️  LLM did not return valid JSON, falling back to static analysis graph');
    }

    // Fallback: build directly from static facts if LLM response is unusable
    if (!archJson || !archJson.components || archJson.components.length === 0) {
      archJson = buildArchJsonFromFacts(facts);
    }

    // ── Step 5: Convert architecture JSON → React Flow graph ─────────────
    const graph = buildGraphFromArchJson(archJson);

    const layerNames = Object.keys(facts.layers).filter((l) => l !== 'other' && l !== 'tests');
    return {
      success: true,
      graph,
      facts,           // expose raw facts for debugging / future use
      archJson,        // expose interpreted JSON
      pattern: archJson.pattern || 'Unknown',
      dataflow: archJson.dataflow || '',
      summary: `${archJson.pattern || 'Architecture'} — ${facts.filesAnalyzed} files across [${layerNames.join(', ')}] using ${facts.technologies.slice(0, 4).join(', ')}`,
      diagramType,
      tokensUsed: rawResponse.split(/\s+/).length,
    };

  } catch (error) {
    console.error('❌ Architecture generation error:', error.message);
    return { success: false, message: error.message };
  }
};

/**
 * Build a minimal architecture JSON directly from static analysis facts
 * (used as fallback when LLM returns garbage).
 */
function buildArchJsonFromFacts(facts) {
  const components = [];
  const relationships = [];

  // Map known layers to human-readable component names
  const layerToComponent = {
    pages: 'Frontend Pages',
    components: 'UI Components',
    hooks: 'Frontend Hooks',
    routes: 'API Routes',
    controllers: 'Controllers',
    services: 'Services',
    models: 'Data Models',
    workers: 'Background Workers',
    middleware: 'Middleware',
    config: 'Configuration',
  };

  const presentLayers = Object.keys(facts.layers).filter((l) => l !== 'other' && l !== 'tests');
  for (const layer of presentLayers) {
    const label = layerToComponent[layer] || layer;
    if (!components.includes(label)) components.push(label);
  }

  // Add technology-based infrastructure nodes
  if (facts.technologies.includes('MongoDB/Mongoose')) components.push('MongoDB');
  if (facts.technologies.includes('Redis')) components.push('Redis');
  if (facts.technologies.includes('BullMQ')) components.push('Job Queue');

  // Build relationships from layer dependencies
  for (const dep of facts.layerDependencies) {
    const [src, tgt] = dep.split(' → ');
    const srcLabel = layerToComponent[src] || src;
    const tgtLabel = layerToComponent[tgt] || tgt;
    if (components.includes(srcLabel) && components.includes(tgtLabel)) {
      relationships.push([srcLabel, tgtLabel]);
    }
  }

  // Add infra relationships
  if (components.includes('Services')) {
    if (components.includes('MongoDB')) relationships.push(['Services', 'MongoDB']);
    if (components.includes('Redis')) relationships.push(['Services', 'Redis']);
    if (components.includes('Job Queue')) relationships.push(['Services', 'Job Queue']);
  }

  return {
    pattern: presentLayers.length > 3 ? 'Layered Architecture' : 'Service-Oriented',
    components,
    relationships,
    dataflow: facts.layerDependencies.join(', '),
  };
}

/**
 * Convert architecture JSON (components + relationships) into React Flow nodes/edges.
 */
function buildGraphFromArchJson(archJson) {
  const components = archJson.components || [];
  const relationships = archJson.relationships || [];

  // Assign node IDs
  const idMap = {};
  components.forEach((comp, i) => { idMap[comp] = String.fromCharCode(65 + i); }); // A, B, C ...

  const nodes = components.map((comp, i) => ({
    id: idMap[comp],
    label: comp,
  }));

  const edges = [];
  const edgeSeen = new Set();
  for (const [from, to] of relationships) {
    const srcId = idMap[from];
    const tgtId = idMap[to];
    if (!srcId || !tgtId) continue;
    const key = `${srcId}-${tgtId}`;
    if (edgeSeen.has(key)) continue;
    edgeSeen.add(key);
    edges.push({ id: `e-${key}`, source: srcId, target: tgtId });
  }

  return { nodes, edges, direction: 'LR' };
}

// Explicit exports
module.exports = {
  generateAnswer,
  streamAnswer,
  generateArchitectureDiagram,
};

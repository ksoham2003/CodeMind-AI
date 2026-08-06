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

const LLM_MODEL = 'llama-3.3-70b-versatile';
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

  const response = await groq.chat.completions.create({
    model: LLM_MODEL,
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

  const stream = await groq.chat.completions.create({
    model: LLM_MODEL,
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

module.exports = { generateAnswer, streamAnswer };

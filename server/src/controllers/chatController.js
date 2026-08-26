const Project = require('../models/Project');
const Chat = require('../models/Chat');
const Chunk = require('../models/Chunk');
const { embedText } = require('../services/embeddingService');
const { querySimilar } = require('../services/pineconeService');
const { addEmbedJob } = require('../queues/embedQueue');
const { generateAnswer, streamAnswer } = require('../services/llmWrapper');

// If a lazy-indexed project has few/no vector matches, we'll enqueue an on-demand embedding job
// for pending chunks and wait briefly for embeddings to be produced and upserted, then re-query.
const waitForEmbeddings = async (chunkIds, timeoutMs = 15000, pollMs = 1000) => {
  const start = Date.now();
  if (!Array.isArray(chunkIds) || chunkIds.length === 0) return 0;
  while (Date.now() - start < timeoutMs) {
    const done = await Chunk.countDocuments({ _id: { $in: chunkIds }, status: 'embedded' });
    if (done > 0) return done;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return 0;
};

/**
 * POST /api/chat
 * Body: { projectId, question }
 */
const sendMessage = async (req, res) => {
  const { projectId, question } = req.body;

  if (!projectId || !question) {
    return res.status(400).json({ success: false, message: 'projectId and question are required' });
  }

  try {
    const project = await Project.findOne({ _id: projectId, owner: req.user._id });
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    if (project.status !== 'ready') {
      return res.status(400).json({
        success: false,
        message: `Repository is not ready. Current status: ${project.status}`,
      });
    }

    // Step 1: Embed the question
    const questionVector = await embedText(question);

    // Step 2: Search Pinecone (support optional filters/boosts)
    const clientFilters = req.body.filters || undefined;
    const clientBoosts = req.body.boosts || undefined;
    const matches = await querySimilar(questionVector, project.repoId, 10, { filters: clientFilters, boosts: clientBoosts });

    let finalMatches = matches || [];

    // If project was indexed with lazyEmbedding and we found few/no matches, try to generate embeddings on-demand
    if (project.lazyEmbedding && finalMatches.length < 5) {
      // Find pending chunks for this project (limit to reasonable batch)
      const pending = await Chunk.find({ project: projectId, status: 'pending' }).limit(200).select('_id').lean();
      if (pending && pending.length > 0) {
        const ids = pending.map((p) => p._id);
        await addEmbedJob({ chunkIds: ids, projectId });
        // Wait briefly for worker to process some embeddings
        await waitForEmbeddings(ids, 15000, 1000);
        // Re-query Pinecone (re-use client filters/boosts)
        finalMatches = await querySimilar(questionVector, project.repoId, 10, { filters: clientFilters, boosts: clientBoosts });
      }
    }

    if (!finalMatches || finalMatches.length === 0) {
      return res.json({
        success: true,
        answer: "I couldn't find relevant code for your question in this repository. Try rephrasing or asking about specific files or functions.",
        sources: [],
      });
    }

    // Step 3: Generate answer with LLM
    const { answer, tokensUsed } = await generateAnswer(question, finalMatches, project.name);

    // Step 4: Format sources for the frontend
    const sources = matches.slice(0, 6).map((m) => ({
      file: m.metadata.path,
      functionName: m.metadata.functionName,
      className: m.metadata.className,
      chunkType: m.metadata.chunkType,
      startLine: m.metadata.startLine,
      endLine: m.metadata.endLine,
      language: m.metadata.language,
      score: m.score,
      content: m.metadata.content,
    }));

    // Step 5: Save to MongoDB
    const chat = await Chat.create({
      projectId,
      owner: req.user._id,
      question,
      answer,
      sources,
      tokensUsed,
    });

    return res.json({
      success: true,
      chatId: chat._id,
      answer,
      sources,
      tokensUsed,
    });
  } catch (err) {
    console.error('❌ Chat error:', err.message || err);

    // Gemini quota / rate-limit
    if (err.status === 429) {
      return res.status(429).json({
        success: false,
        message: 'AI quota exceeded. The Gemini API free-tier limit has been reached. Please try again later or upgrade your API plan at https://ai.google.dev.',
      });
    }

    // Any other upstream API error
    return res.status(500).json({
      success: false,
      message: 'Failed to generate a response. Please try again.',
    });
  }
};

/**
 * GET /api/chat/history/:projectId
 * Query: ?limit=20&page=1
 */
const getChatHistory = async (req, res) => {
  const { projectId } = req.params;
  const limit = parseInt(req.query.limit) || 20;
  const page = parseInt(req.query.page) || 1;
  const skip = (page - 1) * limit;

  const project = await Project.findOne({ _id: projectId, owner: req.user._id });
  if (!project) {
    return res.status(404).json({ success: false, message: 'Project not found' });
  }

  const [chats, total] = await Promise.all([
    Chat.find({ projectId, owner: req.user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-__v'),
    Chat.countDocuments({ projectId, owner: req.user._id }),
  ]);

  res.json({
    success: true,
    chats: chats.reverse(), // Chronological order
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
};


/**
 * POST /api/chat/stream
 * Body: { projectId, question }
 * Streams SSE events with partial answer chunks from the LLM
 */
const streamMessage = async (req, res) => {
  const { projectId, question } = req.body;

  if (!projectId || !question) {
    res.status(400).json({ success: false, message: 'projectId and question are required' });
    return;
  }

  try {
    const project = await Project.findOne({ _id: projectId, owner: req.user._id });
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    if (project.status !== 'ready') {
      res.status(400).json({ success: false, message: `Repository is not ready. Current status: ${project.status}` });
      return;
    }

    // Step 1: Embed the question and search for context. Allow clients to pass filters/boosts.
    const questionVector = await embedText(question);
    const clientFilters = req.body.filters || undefined;
    const clientBoosts = req.body.boosts || undefined;
    const matches = await querySimilar(questionVector, project.repoId, 10, { filters: clientFilters, boosts: clientBoosts });

    let finalMatches = matches || [];

    // If lazy indexing is used and we have few matches, enqueue embeddings and wait briefly
    if (project.lazyEmbedding && finalMatches.length < 5) {
      const pending = await Chunk.find({ project: projectId, status: 'pending' }).limit(200).select('_id').lean();
      if (pending && pending.length > 0) {
        const ids = pending.map((p) => p._id);
        await addEmbedJob({ chunkIds: ids, projectId });
        // Stream client a small 'waiting' notice
        res.write(`data: ${JSON.stringify({ waiting: true, message: 'Generating embeddings for more context...' })}\n\n`);
        await waitForEmbeddings(ids, 15000, 1000);
        finalMatches = await querySimilar(questionVector, project.repoId, 10, { filters: clientFilters, boosts: clientBoosts });
      }
    }

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    if (!finalMatches || finalMatches.length === 0) {
      res.write(`data: ${JSON.stringify({ done: true, error: "No context found" })}\n\n`);
      res.end();
      return;
    }

    // Stream chunks from LLM
    try {
      for await (const chunk of streamAnswer(question, finalMatches, project.name)) {
        const payload = { chunk }; // simple wrapper
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      }

      // Final event
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (streamErr) {
      console.error('Stream error:', streamErr?.message || streamErr);
      res.write(`data: ${JSON.stringify({ done: true, error: streamErr?.message || 'Stream failed' })}\n\n`);
      res.end();
    }
  } catch (err) {
    console.error('❌ Chat stream error:', err.message || err);
    res.status(500).json({ success: false, message: 'Failed to stream response' });
  }
};

module.exports = { sendMessage, getChatHistory, streamMessage };

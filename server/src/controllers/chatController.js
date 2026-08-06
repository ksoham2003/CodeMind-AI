const Project = require('../models/Project');
const Chat = require('../models/Chat');
const { embedText } = require('../services/embeddingService');
const { querySimilar } = require('../services/pineconeService');
const { generateAnswer } = require('../services/llmService');

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

    // Step 2: Search Pinecone
    const matches = await querySimilar(questionVector, project.repoId, 10);

    if (matches.length === 0) {
      return res.json({
        success: true,
        answer: "I couldn't find relevant code for your question in this repository. Try rephrasing or asking about specific files or functions.",
        sources: [],
      });
    }

    // Step 3: Generate answer with LLM
    const { answer, tokensUsed } = await generateAnswer(question, matches, project.name);

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

module.exports = { sendMessage, getChatHistory };

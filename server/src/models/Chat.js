const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    question: {
      type: String,
      required: true,
    },
    answer: {
      type: String,
      required: true,
    },
    // Relevant source chunks returned from Pinecone
    sources: [
      {
        file: String,
        functionName: String,
        className: String,
        chunkType: String,
        startLine: Number,
        endLine: Number,
        language: String,
        score: Number,
        content: String,
      },
    ],
    // Optional embedded diagram generated for this chat (architecture visualization)
    tokensUsed: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Chat', chatSchema);

const mongoose = require('mongoose');

const chunkSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // use generated chunk.id (uuid) as _id
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    text: { type: String, required: true },
    path: { type: String, default: '' },
    functionName: { type: String, default: '' },
    className: { type: String, default: '' },
    chunkType: { type: String, default: 'code' },
    startLine: { type: Number, default: 0 },
    endLine: { type: Number, default: 0 },
    content: { type: String, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    embedding: { type: [Number], default: null },
    embeddingSha: { type: String, default: null, index: true },
    status: { type: String, enum: ['pending', 'embedded', 'error'], default: 'pending' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Chunk', chunkSchema);

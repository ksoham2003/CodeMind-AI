const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    githubUrl: {
      type: String,
      required: true,
      trim: true,
    },
    repoId: {
      type: String,
      required: true,
      unique: true,
      // e.g. "owner-reponame-uuid"
    },
    status: {
      type: String,
      enum: ['pending', 'cloning', 'parsing', 'embedding', 'indexing', 'ready', 'error'],
      default: 'pending',
    },
    errorMessage: {
      type: String,
      default: null,
    },
    // Stats populated after indexing
    fileCount: { type: Number, default: 0 },
    chunkCount: { type: Number, default: 0 },
    language: { type: String, default: 'javascript' },
    // Primary languages found in the repo
    languages: [{ type: String }],
    // File tree stored as JSON for the sidebar
    fileTree: { type: mongoose.Schema.Types.Mixed, default: null },
    indexedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Project', projectSchema);

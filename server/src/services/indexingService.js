/**
 * Indexing Orchestrator Service
 *
 * Orchestrates the full pipeline:
 *   Clone → Read Files → Parse → Chunk → Embed → Store in Pinecone
 *
 * Emits real-time progress events via Socket.io
 */

const Project = require('../models/Project');
const { cloneRepository, readRepositoryFiles, buildFileTree, deleteRepository } = require('./githubService');
const { parseFiles } = require('./parserService');
const { buildChunks } = require('./chunkService');
const { embedChunks } = require('./embeddingService');
const { upsertVectors } = require('./pineconeService');

// Supported file extensions
const SUPPORTED_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx'];

/**
 * Emit a progress event to the connected socket room
 */
const emitProgress = (io, projectId, stage, message, data = {}) => {
  // If no socket.io instance is provided (e.g., manual CLI run),
  // fall back to logging to console instead of throwing.
  if (!io || typeof io.to !== 'function') {
    console.log(`[indexing:${stage}] ${projectId} - ${message}`, data || {});
    return;
  }

  io.to(projectId).emit('indexing:progress', {
    stage,
    message,
    timestamp: new Date().toISOString(),
    ...data,
  });
};

/**
 * Run the full indexing pipeline for a project
 *
 * @param {string} projectId - MongoDB Project _id
 * @param {object} io - Socket.io server instance
 */
const runIndexingPipeline = async (projectId, io) => {
  let project;

  try {
    project = await Project.findById(projectId);
    if (!project) throw new Error('Project not found');

    // Clear cached diagrams when starting a fresh indexing run
    await Project.findByIdAndUpdate(projectId, { diagrams: null });

    // ── Stage 1: Clone ────────────────────────────────────────────────────────
    await Project.findByIdAndUpdate(projectId, { status: 'cloning' });
    emitProgress(io, projectId, 'cloning', `Cloning repository from GitHub...`);

    const localPath = await cloneRepository(
      project.githubUrl,
      project.repoId,
      (stage, msg) => emitProgress(io, projectId, 'cloning', msg)
    );

    emitProgress(io, projectId, 'cloning', 'Repository cloned successfully', { done: true });

    // ── Stage 2: Read Files ───────────────────────────────────────────────────
    await Project.findByIdAndUpdate(projectId, { status: 'parsing' });
    emitProgress(io, projectId, 'reading', 'Reading source files...');

    const files = readRepositoryFiles(localPath, SUPPORTED_EXTENSIONS, localPath);

    if (files.length === 0) {
      throw new Error('No supported source files found in this repository. Make sure it contains .js, .jsx, .ts, or .tsx files.');
    }

    const fileTree = buildFileTree(files);
    await Project.findByIdAndUpdate(projectId, { fileCount: files.length, fileTree });

    emitProgress(io, projectId, 'reading', `Found ${files.length} source files`, {
      fileCount: files.length,
      done: true,
    });

    // ── Stage 3: Parse (AST) ──────────────────────────────────────────────────
    emitProgress(io, projectId, 'parsing', 'Parsing code with AST analysis...');

    const parsedNodes = parseFiles(files);

    emitProgress(io, projectId, 'parsing', `Extracted ${parsedNodes.length} code blocks`, {
      nodeCount: parsedNodes.length,
      done: true,
    });

    // ── Stage 4: Chunk ────────────────────────────────────────────────────────
    emitProgress(io, projectId, 'chunking', 'Building semantic chunks...');

    const chunks = buildChunks(parsedNodes, project.repoId, project.name);

    await Project.findByIdAndUpdate(projectId, { chunkCount: chunks.length });
    emitProgress(io, projectId, 'chunking', `Created ${chunks.length} semantic chunks`, {
      chunkCount: chunks.length,
      done: true,
    });

    // ── Stage 5: Embed ────────────────────────────────────────────────────────
    // ── Stage 5: Embed ───────────────────────────────────────────────────────
    await Project.findByIdAndUpdate(projectId, { status: 'embedding' });

    // Support resuming from partial embedding progress
    const freshProject = await Project.findById(projectId);
    const startEmbeddingAt = freshProject.embeddingProgress || 0;
    emitProgress(io, projectId, 'embedding', `Generating embeddings for ${chunks.length} chunks...`, {
      startAt: startEmbeddingAt,
    });

    let embeddedCount = 0;
    // embedChunks reports progress relative to the slice passed; translate to absolute
    const chunksToEmbed = chunks.slice(startEmbeddingAt);
    const vectors = await embedChunks(chunksToEmbed, async (done, total) => {
      embeddedCount = startEmbeddingAt + done;
      const pct = Math.round((embeddedCount / chunks.length) * 100);
      // persist embedding progress periodically
      await Project.findByIdAndUpdate(projectId, { embeddingProgress: embeddedCount });
      emitProgress(io, projectId, 'embedding', `Embedding ${embeddedCount}/${chunks.length} chunks (${pct}%)`, {
        done: embeddedCount,
        total: chunks.length,
        percent: pct,
      });
    });

    // Adjust vector IDs to match original chunk ids (embedChunks returned ids from chunksToEmbed)
    emitProgress(io, projectId, 'embedding', 'Embeddings generated', { done: true });

    // ── Stage 6: Store in Pinecone ────────────────────────────────────────────
    // ── Stage 6: Store in Pinecone ────────────────────────────────────────────
    await Project.findByIdAndUpdate(projectId, { status: 'indexing' });

    // Support resuming upsert from where it left off
    const freshAfterEmbed = await Project.findById(projectId);
    const startUpsertAt = freshAfterEmbed.upsertProgress || 0;
    emitProgress(io, projectId, 'indexing', `Uploading ${vectors.length} vectors to Pinecone...`, {
      startAt: startUpsertAt,
    });

    // upsertVectors handles batching and reports progress; we pass a callback that persists progress
    await upsertVectors(vectors.slice(startUpsertAt), async (done, total) => {
      const absoluteDone = startUpsertAt + done;
      await Project.findByIdAndUpdate(projectId, { upsertProgress: absoluteDone });
      const pct = Math.round((absoluteDone / vectors.length) * 100);
      emitProgress(io, projectId, 'indexing', `Stored ${absoluteDone}/${vectors.length} vectors (${pct}%)`, {
        done: absoluteDone,
        total: vectors.length,
        percent: pct,
      });
    });

    // Clear progress markers after successful indexing
    await Project.findByIdAndUpdate(projectId, { embeddingProgress: 0, upsertProgress: 0 });

    // ── Stage 7: Done ─────────────────────────────────────────────────────────
    await Project.findByIdAndUpdate(projectId, {
      status: 'ready',
      indexedAt: new Date(),
    });

    // Detect primary languages
    const langCounts = {};
    for (const f of files) {
      const lang = f.extension;
      langCounts[lang] = (langCounts[lang] || 0) + 1;
    }
    const languages = Object.entries(langCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([ext]) => ext.replace('.', '').toUpperCase());

    await Project.findByIdAndUpdate(projectId, { languages });

    emitProgress(io, projectId, 'done', `✅ Repository indexed successfully! ${chunks.length} chunks ready.`, {
      done: true,
      chunkCount: chunks.length,
      fileCount: files.length,
    });

    // ── Cleanup: Remove cloned files ──────────────────────────────────────────
    await deleteRepository(project.repoId);
  } catch (error) {
    console.error(`Indexing error for project ${projectId}:`, error);

    await Project.findByIdAndUpdate(projectId, {
      status: 'error',
      errorMessage: error.message,
    });

    if (project) {
      await deleteRepository(project.repoId).catch(() => {});
    }

    if (io) {
      emitProgress(io, projectId, 'error', `❌ Indexing failed: ${error.message}`, {
        error: true,
        message: error.message,
      });
    }

    throw error;
  }
};

module.exports = { runIndexingPipeline };

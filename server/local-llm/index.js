const express = require('express');
const bodyParser = require('body-parser');
const { execFile } = require('child_process');
const fs = require('fs');

const app = express();
app.use(bodyParser.json());

const QUANTIZED_ENABLED = (process.env.LOCAL_LLM_QUANTIZED === 'true');
const MODEL_PATH = process.env.LOCAL_LLM_MODEL_PATH || '/models/ggml-alpaca-q4.bin';

// Helper to attempt to call an external quantized runner if present
const tryQuantizedRun = (prompt) => new Promise((resolve, reject) => {
  const runner = process.env.LOCAL_LLM_QUANTIZED_RUNNER || '/usr/local/bin/quantized-runner';
  if (!fs.existsSync(runner)) return reject(new Error('quantized runner not found'));
  execFile(runner, [MODEL_PATH, prompt], { maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) return reject(err);
    resolve({ text: stdout.toString().trim(), tokens: Math.ceil(stdout.length / 4) });
  });
});

// Generate endpoint
app.post('/generate', async (req, res) => {
  const prompt = req.body.prompt || req.body.input || '';
  const wantQuantized = QUANTIZED_ENABLED || req.body.use_quantized;

  if (wantQuantized) {
    try {
      const out = await tryQuantizedRun(prompt);
      return res.json(out);
    } catch (e) {
      // Fall back to a placeholder quantized response
      const text = `QUANTIZED_LLM_PLACEHOLDER: model=${MODEL_PATH} prompt_len=${prompt.length}`;
      return res.json({ text, tokens: Math.min(2000, Math.ceil(prompt.length / 2)) });
    }
  }

  // Non-quantized deterministic echo generator
  const text = `LOCAL_LLM_RESPONSE: Received prompt length ${prompt.length}.`;
  res.json({ text, tokens: Math.min(100, Math.ceil(prompt.length / 4)) });
});

// Streaming endpoint
app.post('/stream', async (req, res) => {
  const prompt = req.body.prompt || '';
  const wantQuantized = QUANTIZED_ENABLED || req.body.use_quantized;

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');

  if (wantQuantized) {
    // Try to stream from quantized runner if available (placeholder behavior)
    const lines = [`QUANTIZED_STREAM_START`, `Model: ${MODEL_PATH}`, `Prompt length: ${prompt.length}`, `QUANTIZED_STREAM_END`];
    for (const line of lines) {
      res.write(line + '\n');
      await new Promise((r) => setTimeout(r, 120));
    }
    return res.end();
  }

  // Fallback streaming behavior
  const lines = [`STREAM_START`, `Prompt length: ${prompt.length}`, `STREAM_END`];
  for (const line of lines) {
    res.write(line + '\n');
    await new Promise((r) => setTimeout(r, 80));
  }
  res.end();
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Local LLM stub listening on port ${PORT} (quantized=${QUANTIZED_ENABLED})`));

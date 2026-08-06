const { GoogleGenAI } = require('@google/genai');

let geminiClient = null;
let embeddingClient = null;

/**
 * Returns the main Gemini client (v1beta) for generative content.
 */
const getGeminiClient = () => {
  if (!geminiClient) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY environment variable is not set.');
    }
    geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return geminiClient;
};

/**
 * Returns a Gemini client pinned to the stable v1 API.
 * Required for text-embedding-004, which is not available on v1beta.
 */
const getEmbeddingClient = () => {
  if (!embeddingClient) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY environment variable is not set.');
    }
    embeddingClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: { apiVersion: 'v1' },
    });
  }
  return embeddingClient;
};

module.exports = { getGeminiClient, getEmbeddingClient };

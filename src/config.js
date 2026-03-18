// Application configuration – all paths relative to project root
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function resolveFromRoot(value) {
  if (!value) return value;
  return path.isAbsolute(value) ? value : path.join(ROOT, value);
}

export const config = {
  // Model
  model: "phi-3.5-mini",

  // RAG
  docsDir: path.join(ROOT, "docs"),
  dbPath: path.join(ROOT, "data", "rag.db"),
  chunkSize: 200,       // tokens (approx) – kept small for NPU compatibility
  chunkOverlap: 25,     // tokens overlap between chunks
  topK: 3,              // number of chunks to retrieve – limited for NPU context window
  retrievalMode: process.env.RETRIEVAL_MODE || "hybrid",
  retrievalModes: ["lexical", "semantic", "hybrid"],
  fallbackRetrievalMode: "lexical",
  semanticCandidateMultiplier: 3,
  retrievalWeights: {
    lexical: 0.45,
    semantic: 0.55,
  },
  embeddingModelPath: resolveFromRoot(
    process.env.EMBEDDING_MODEL_PATH || path.join("models", "embeddings", "bge-small-en-v1.5")
  ),

  // Server
  port: 3000,
  host: "127.0.0.1",

  // UI
  publicDir: path.join(ROOT, "public"),
};

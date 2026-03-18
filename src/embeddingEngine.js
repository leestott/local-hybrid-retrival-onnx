import fs from "fs";
import path from "path";
import { env, pipeline } from "@huggingface/transformers";

env.allowLocalModels = true;
env.allowRemoteModels = false;

function extractVector(output) {
  if (!output) return null;
  if (output.data) return Array.from(output.data);
  if (output.cpuData) return Array.from(output.cpuData);
  if (typeof output.tolist === "function") return output.tolist().flat(Infinity).map(Number);
  if (Array.isArray(output)) return output.flat(Infinity).map(Number);
  return null;
}

export class EmbeddingEngine {
  constructor(modelPath) {
    this.modelPath = modelPath;
    this.extractor = null;
    this.available = false;
    this.lastError = null;
  }

  async init() {
    if (!this.modelPath) {
      this.lastError = "No embedding model path configured.";
      return false;
    }

    const resolvedPath = path.resolve(this.modelPath);
    if (!fs.existsSync(resolvedPath)) {
      this.lastError = `Embedding model path not found: ${resolvedPath}`;
      return false;
    }

    if (!fs.statSync(resolvedPath).isDirectory()) {
      this.lastError = `Embedding model path must be a directory: ${resolvedPath}`;
      return false;
    }

    try {
      this.extractor = await pipeline("feature-extraction", resolvedPath, {
        local_files_only: true,
      });
      this.available = true;
      this.lastError = null;
      return true;
    } catch (err) {
      this.extractor = null;
      this.available = false;
      this.lastError = err instanceof Error ? err.message : String(err);
      return false;
    }
  }

  isReady() {
    return this.available && !!this.extractor;
  }

  async embed(text) {
    if (!this.isReady() || !text || !text.trim()) return null;

    const output = await this.extractor(text, {
      pooling: "mean",
      normalize: true,
    });

    return extractVector(output);
  }

  async embedBatch(texts) {
    const vectors = [];
    for (const text of texts) {
      vectors.push(await this.embed(text));
    }
    return vectors;
  }

  getStatus() {
    return {
      available: this.isReady(),
      modelPath: this.modelPath,
      lastError: this.lastError,
    };
  }
}
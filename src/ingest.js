/**
 * Ingestion script.
 * Reads all markdown documents from the docs/ folder,
 * chunks them, and stores in the local SQLite vector store.
 *
 * Usage: node src/ingest.js
 */
import fs from "fs";
import path from "path";
import { config } from "./config.js";
import { parseFrontMatter, chunkText } from "./chunker.js";
import { EmbeddingEngine } from "./embeddingEngine.js";
import { VectorStore } from "./vectorStore.js";

async function ingest() {
  console.log("=== Gas Field RAG – Document Ingestion ===\n");

  const docsDir = config.docsDir;
  if (!fs.existsSync(docsDir)) {
    console.error(`Docs directory not found: ${docsDir}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(docsDir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  if (files.length === 0) {
    console.error("No markdown files found in docs/");
    process.exit(1);
  }

  console.log(`Found ${files.length} documents.\n`);

  const store = new VectorStore(config.dbPath);
  store.clear(); // Fresh ingestion each time

  const embeddingEngine = new EmbeddingEngine(config.embeddingModelPath);
  const semanticAvailable = await embeddingEngine.init();

  if (semanticAvailable) {
    console.log(`Semantic indexing enabled with local ONNX model: ${config.embeddingModelPath}\n`);
  } else {
    const { lastError } = embeddingEngine.getStatus();
    console.log(`Semantic indexing unavailable. Continuing with lexical-only ingestion. ${lastError || ""}\n`);
  }

  let totalChunks = 0;
  let totalEmbeddedChunks = 0;

  for (const file of files) {
    const raw = fs.readFileSync(path.join(docsDir, file), "utf-8");
    const { meta, body } = parseFrontMatter(raw);
    const docId = meta.id || path.basename(file, ".md");
    const title = meta.title || file;
    const category = meta.category || "Uncategorised";

    const chunks = chunkText(body, config.chunkSize, config.chunkOverlap);
    const embeddings = semanticAvailable
      ? await embeddingEngine.embedBatch(chunks)
      : new Array(chunks.length).fill(null);

    for (let i = 0; i < chunks.length; i++) {
      store.insert(docId, title, category, i, chunks[i], embeddings[i]);
      if (Array.isArray(embeddings[i])) totalEmbeddedChunks += 1;
    }

    console.log(`  ✓ ${file} → ${chunks.length} chunk(s)  [${category}]`);
    totalChunks += chunks.length;
  }

  console.log(`\nIngestion complete: ${totalChunks} chunks from ${files.length} documents.`);
  console.log(`Embeddings indexed: ${totalEmbeddedChunks}`);
  console.log(`Database: ${config.dbPath}`);
  store.close();
}

ingest().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});

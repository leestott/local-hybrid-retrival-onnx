/**
 * Local vector store backed by SQLite.
 * Stores document chunks and their term-frequency vectors for offline RAG retrieval.
 *
 * Performance optimisations:
 * - Inverted index: maps terms → chunk IDs for fast candidate filtering
 * - Row cache: parsed TF maps kept in memory to avoid JSON.parse on every query
 * - Prepared statements: reused across calls
 */
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { termFrequency, cosineSimilarity } from "./chunker.js";

function denseCosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function withScoreMetadata(row, score, lexicalScore = 0, semanticScore = 0, retrievalMode = "lexical") {
  return {
    ...row,
    score,
    lexicalScore,
    semanticScore,
    retrievalMode,
    tf_json: undefined,
    embedding_json: undefined,
  };
}

export class VectorStore {
  constructor(dbPath) {
    // Ensure data directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this._init();

    // In-memory caches for fast retrieval
    this._rowCache = null;    // Array of { id, doc_id, title, category, content, tf }
    this._invertedIndex = null; // Map<term, Set<rowIndex>>
  }

  _init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id TEXT NOT NULL,
        title TEXT,
        category TEXT,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        tf_json TEXT NOT NULL,
        embedding_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_doc_id ON chunks(doc_id);
    `);

    const columns = this.db.prepare("PRAGMA table_info(chunks)").all();
    if (!columns.some((column) => column.name === "embedding_json")) {
      this.db.exec("ALTER TABLE chunks ADD COLUMN embedding_json TEXT");
    }

    // Prepare reusable statements
    this._stmtInsert = this.db.prepare(
      "INSERT INTO chunks (doc_id, title, category, chunk_index, content, tf_json, embedding_json) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    this._stmtAll = this.db.prepare("SELECT * FROM chunks");
    this._stmtCount = this.db.prepare("SELECT COUNT(*) as cnt FROM chunks");
    this._stmtEmbeddingCount = this.db.prepare("SELECT COUNT(*) as cnt FROM chunks WHERE embedding_json IS NOT NULL");
    this._stmtListDocs = this.db.prepare(
      "SELECT doc_id, title, category, COUNT(*) as chunks FROM chunks GROUP BY doc_id ORDER BY title"
    );
    this._stmtDeleteDoc = this.db.prepare("DELETE FROM chunks WHERE doc_id = ?");
  }

  /** Invalidate in-memory caches (called after any mutation). */
  _invalidateCache() {
    this._rowCache = null;
    this._invertedIndex = null;
  }

  /** Build or return the in-memory row cache and inverted index. */
  _ensureCache() {
    if (this._rowCache) return;

    const rows = this._stmtAll.all();
    this._rowCache = rows.map((row) => {
      const tf = new Map(JSON.parse(row.tf_json));
      const embedding = row.embedding_json ? JSON.parse(row.embedding_json) : null;
      return { id: row.id, doc_id: row.doc_id, title: row.title, category: row.category, content: row.content, tf, embedding };
    });

    // Build inverted index: term → set of row indices
    this._invertedIndex = new Map();
    for (let i = 0; i < this._rowCache.length; i++) {
      for (const term of this._rowCache[i].tf.keys()) {
        if (!this._invertedIndex.has(term)) {
          this._invertedIndex.set(term, new Set());
        }
        this._invertedIndex.get(term).add(i);
      }
    }
  }

  /** Remove all existing chunks (for fresh re-ingestion). */
  clear() {
    this.db.exec("DELETE FROM chunks");
    this._invalidateCache();
  }

  /** Insert a single chunk. */
  insert(docId, title, category, chunkIndex, content, embedding = null) {
    const tf = termFrequency(content);
    const tfJson = JSON.stringify([...tf]);
    const embeddingJson = Array.isArray(embedding) && embedding.length > 0 ? JSON.stringify(embedding) : null;
    this._stmtInsert.run(docId, title, category, chunkIndex, content, tfJson, embeddingJson);
    this._invalidateCache();
  }

  /** Retrieve top-K most relevant chunks for a query. */
  search(query, topK = 5) {
    return this.searchLexical(query, topK);
  }

  /** Retrieve top-K chunks using exact-term lexical retrieval. */
  searchLexical(query, topK = 5) {
    const queryTf = termFrequency(query);
    this._ensureCache();

    // Use inverted index to find candidate chunks that share at least one term
    const candidateIndices = new Set();
    for (const term of queryTf.keys()) {
      const indices = this._invertedIndex.get(term);
      if (indices) {
        for (const idx of indices) candidateIndices.add(idx);
      }
    }

    // Score only candidates instead of all rows
    const scored = [];
    for (const idx of candidateIndices) {
      const row = this._rowCache[idx];
      const score = cosineSimilarity(queryTf, row.tf);
      if (score > 0) {
        scored.push(withScoreMetadata(row, score, score, 0, "lexical"));
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /** Retrieve top-K chunks using dense embedding similarity. */
  searchSemantic(queryEmbedding, topK = 5) {
    if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) return [];

    this._ensureCache();

    const scored = [];
    for (const row of this._rowCache) {
      if (!row.embedding) continue;
      const score = denseCosineSimilarity(queryEmbedding, row.embedding);
      if (score > 0) {
        scored.push(withScoreMetadata(row, score, 0, score, "semantic"));
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /** Combine lexical and semantic scores into a hybrid ranking. */
  searchHybrid(query, queryEmbedding, topK = 5, weights = { lexical: 0.45, semantic: 0.55 }) {
    const lexicalResults = this.searchLexical(query, topK * 3);
    const semanticResults = this.searchSemantic(queryEmbedding, topK * 3);

    if (semanticResults.length === 0) {
      return lexicalResults.slice(0, topK).map((row) => ({
        ...row,
        retrievalMode: "lexical",
      }));
    }

    const lexicalWeight = typeof weights.lexical === "number" ? weights.lexical : 0.45;
    const semanticWeight = typeof weights.semantic === "number" ? weights.semantic : 0.55;
    const combined = new Map();

    for (const row of lexicalResults) {
      combined.set(row.id, {
        ...row,
        lexicalScore: row.score,
        semanticScore: 0,
      });
    }

    for (const row of semanticResults) {
      const existing = combined.get(row.id);
      if (existing) {
        existing.semanticScore = row.score;
      } else {
        combined.set(row.id, {
          ...row,
          lexicalScore: 0,
          semanticScore: row.score,
        });
      }
    }

    const fused = [...combined.values()].map((row) => ({
      ...row,
      score: (row.lexicalScore * lexicalWeight) + (row.semanticScore * semanticWeight),
      retrievalMode: row.lexicalScore > 0 && row.semanticScore > 0 ? "hybrid" : (row.semanticScore > 0 ? "semantic" : "lexical"),
    }));

    fused.sort((a, b) => b.score - a.score);
    return fused.slice(0, topK);
  }

  /** Remove all chunks for a specific document. */
  removeByDocId(docId) {
    this._stmtDeleteDoc.run(docId);
    this._invalidateCache();
  }

  /** Get total chunk count. */
  count() {
    return this._stmtCount.get().cnt;
  }

  /** Count chunks that have semantic embeddings indexed. */
  countEmbeddings() {
    return this._stmtEmbeddingCount.get().cnt;
  }

  /** List distinct documents in the store. */
  listDocs() {
    return this._stmtListDocs.all();
  }

  close() {
    this.db.close();
  }
}

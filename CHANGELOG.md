# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0.1] - 2026-03-18

### Added

- Added a Windows `postinstall` script to copy `onnxruntime_providers_shared.dll` into the `onnxruntime-node` runtime directory when present.
- Added embedding model file discovery to `/api/health` so local model availability can be verified from the running app.
- Added README guidance for downloading and validating the local `bge-small-en-v1.5` ONNX embedding model.

### Changed

- Pinned `onnxruntime-node` to `1.24.3` via `overrides` to keep the local embedding runtime aligned with the rest of the dependency stack.
- Updated server configuration to respect the `PORT` environment variable instead of always binding to `3000`.
- Improved startup error handling for occupied ports with an explicit `EADDRINUSE` message and a PowerShell override example.

## [1.0.0] - 2026-03-18

### Added

- Initial public release of the offline hybrid RAG sample for gas-field support workflows.
- Local lexical, semantic, and hybrid retrieval modes with automatic fallback to lexical search when embeddings are unavailable.
- ONNX-based embedding pipeline backed by Transformers.js and a local embedding model directory.
- SQLite-backed vector store for sparse lexical features and optional dense embedding vectors.
- Document ingestion pipeline for the bundled markdown knowledge base.
- Express server with chat, streaming chat, upload, document listing, health, and initialization status endpoints.
- Browser UI for interacting with the local agent and switching retrieval modes.
- Automated tests covering chunking, configuration, server behavior, and vector-store ranking.


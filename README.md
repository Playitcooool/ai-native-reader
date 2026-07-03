# RustyBooks

**A local-first AI reader for serious PDFs and EPUBs.**

RustyBooks keeps your library, reading state, notes, OCR, and AI context on your machine. Ask about a page, a selected passage, an explicit page range, or a table-of-contents chapter without uploading the document.

<p>
  <img alt="RustyBooks library" src="docs/screenshots/rustybooks-library.png" width="100%">
</p>

<p>
  <img alt="RustyBooks reader" src="docs/screenshots/rustybooks-reader.png" width="100%">
</p>

## Highlights

| Feature | Why it matters |
|---|---|
| Local-first library | PDFs, EPUBs, notes, sessions, and reading progress stay on your device. |
| Context-aware AI | Ask about the current page, selected text, ranges, or TOC chapters. |
| Clickable citations | AI answers cite pages like `[p.12]`, and links jump back into the reader. |
| Bring your own model | Use OpenAI, LM Studio, Ollama, or any OpenAI-compatible endpoint. |
| Built for long documents | Native TOC, page ranges, EPUB progress, OCR fallback, and reading stats. |

## Release

Current version: **0.2.1**

## Quick Start

```bash
npm install
npm run tauri dev
```

Build a release bundle:

```bash
npm run tauri build
```

## AI Setup

Open **Settings** in the app and point it at any OpenAI-compatible API:

| Field | Example |
|---|---|
| Base URL | `http://localhost:1234/v1` |
| API key | (your key, or leave blank for local models) |
| Model | `gpt-4o-mini` / `llama-3.2` / any |

Local models (LM Studio, Ollama) work with zero configuration beyond the URL.

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `E` | Explain selected text |
| `←` / `→` | Previous / next page |
| `+` / `-` | Zoom in / out |
| `0` | Reset zoom |
| `Esc` | Clear selection |

## Tech Stack

| Layer | What |
|---|---|
| Shell | Tauri v2 |
| Frontend | React 18, TypeScript, Vite |
| PDF | PDF.js v4 |
| State | Zustand |
| Storage | SQLite (local, never leaves your machine) |
| AI | OpenAI-compatible HTTP |

See [design notes](docs/superpowers/ai_native_pdf_reader_design_v0.5_agent_ready.md) for the full background.

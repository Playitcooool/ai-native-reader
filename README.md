# RustyBooks

**AI-native reader that lives in your documents — not in the cloud.**

A local-first desktop reader for PDFs and EPUBs. Works offline, keeps everything on your machine, and brings AI to your reading without uploading a single page.

<p>
  <img alt="RustyBooks library" src="docs/screenshots/rustybooks-library.png" width="100%">
</p>

<p>
  <img alt="RustyBooks reader" src="docs/screenshots/rustybooks-reader.png" width="100%">
</p>

## What makes it different

**AI that reads the room.** Select a paragraph and press `E` — the AI sees the selected text, the page, the section heading, and nearby pages before answering. No copy-paste, no context window guessing.

**Citations that work.** Answers reference pages (`[p.12]`), and every citation is a clickable link back into the PDF.

**Tiny footprint.** SQLite backend, bundled AI calls, no hidden uploads. Everything runs on your hardware, against the model you choose.

**Bring your own model.** OpenAI, LM Studio, Ollama — any OpenAI-compatible endpoint. No vendor lock-in, no per-seat fees.

## Quick Start

```bash
npm install
npm run tauri dev
```

Build for distribution:

```bash
npm run tauri build
```

## Configure AI

Open **Settings** in the app and point it at any OpenAI-compatible API:

| Field | Example |
|---|---|
| Base URL | `http://localhost:1234/v1` |
| API key | (your key, or leave blank for local models) |
| Model | `gpt-4o-mini` / `llama-3.2` / any |

Local models (LM Studio, Ollama) work with zero configuration beyond the URL.

## Keyboard

| Key | Action |
|---|---|
| `E` | Explain selected text |
| `←` / `→` | Previous / next page |
| `+` / `-` | Zoom in / out |
| `0` | Reset zoom |
| `Esc` | Clear selection |

## Stack

| Layer | What |
|---|---|
| Shell | Tauri v2 |
| Frontend | React 18, TypeScript, Vite |
| PDF | PDF.js v4 |
| State | Zustand |
| Storage | SQLite (local, never leaves your machine) |
| AI | OpenAI-compatible HTTP |

See [design notes](docs/superpowers/ai_native_pdf_reader_design_v0.5_agent_ready.md) for the full background.

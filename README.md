# RustyBooks

**A local-first AI reader for serious PDFs and EPUBs.**

RustyBooks keeps your documents, library, reading state, notes, and extracted text on your machine. AI requests send bounded text context—not the document file—to the provider you configure. Use LM Studio or Ollama to keep those requests on your device.

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
| Bring your own model | Use OpenAI-compatible APIs, Anthropic, LM Studio, or Ollama. |
| Built for long documents | Native TOC, page ranges, EPUB progress, OCR fallback, and reading stats. |

## Release

Development version: **0.2.58**

Installable builds are published on [GitHub Releases](https://github.com/Playitcooool/ai-native-reader/releases). Maintainers should follow [RELEASING.md](RELEASING.md); local unsigned builds are for testing only.

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

Open **Settings**, choose a provider, and enter the model you want to use:

| Provider | Default base URL | API key |
|---|---|---|
| OpenAI-compatible | `https://api.openai.com/v1` | Required for cloud services |
| Anthropic | `https://api.anthropic.com/v1` | Required |
| LM Studio | `http://localhost:1234/v1` | Optional |
| Ollama | `http://localhost:11434/v1` | Optional |

Provider endpoints and model names remain configurable, including for self-hosted services.

## Privacy and Data Handling

RustyBooks has no account system, advertising, or built-in telemetry service. Your source files and local library database stay on your device. When you use a cloud AI provider, RustyBooks sends the prompt plus the bounded text context needed for that request to the endpoint you configured; that provider's terms and retention policy apply.

Provider API keys are stored in the operating system's secure credential store and are excluded from exported database backups. See [Privacy and Data Handling](PRIVACY.md) for the complete data flow and deletion details.

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
| Storage | Local SQLite plus the operating system's secure credential store |
| AI | OpenAI-compatible and Anthropic HTTP APIs, including local endpoints |

See [design notes](docs/superpowers/ai_native_pdf_reader_design_v0.5_agent_ready.md) for the full background.

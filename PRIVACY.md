# Privacy and Data Handling

Effective date: July 13, 2026

RustyBooks is a local-first desktop application. It does not require an account and does not operate a RustyBooks cloud service.

## Data Stored on Your Device

RustyBooks reads PDFs and EPUBs from the locations you select. It stores application data locally, including:

- document paths and metadata;
- extracted or OCR-generated text and table-of-contents data;
- notes, highlights, drawings, citations, collections, and reading progress;
- AI conversations, session summaries, and reading-time records;
- application and provider configuration; and
- cached EPUB covers and interface preferences.

Provider API keys are stored in the operating system's secure credential store: Keychain on macOS, Credential Manager on Windows, and Secret Service on Linux. They are not returned to the interface or included in SQLite backups.

## Data Sent to AI Providers

RustyBooks makes a network request only when an AI operation needs the provider you configured, such as testing a connection, explaining or summarizing text, answering a question, or translating a selection.

An AI request may contain your prompt, selected text, bounded excerpts from relevant pages or chapters, table-of-contents labels, and relevant prior conversation context. RustyBooks does not send the PDF or EPUB file itself. If the endpoint is a cloud service, its privacy, retention, and model-training terms govern the data it receives. If the endpoint is a local LM Studio or Ollama server, requests stay within the network path you configured.

RustyBooks does not send advertising identifiers or analytics to its developer. Optional performance diagnostics are off by default, remain in memory, and leave the app only if you manually export them to a file.

## Backups and Deletion

Database backups contain local library records, extracted text, notes, AI history, reading state, and provider configuration. API keys are explicitly removed from exported backups. A backup can still contain sensitive document text and conversations, so store it accordingly.

Removing a book from the library is not a secure erase and intentionally preserves its notes and AI history. Settings provides controls to clear cached PDF text and AI history. Deleting RustyBooks' application-data directory removes its database and cached covers. Interface preferences are stored separately in the system webview's local storage. These actions do not delete your source PDF or EPUB files, and uninstalling RustyBooks may not remove its app data automatically.

## External Links

Opening an external link hands that URL to your system browser. The destination site then applies its own privacy policy.

## Changes and Questions

Material changes to this document will update the effective date. Report privacy or security concerns through the [repository issue tracker](https://github.com/Playitcooool/ai-native-reader/issues).

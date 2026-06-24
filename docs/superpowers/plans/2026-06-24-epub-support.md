# EPUB Format Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add EPUB ebook support alongside existing PDF reader, routing by `document_type` field.

**Architecture:** A `document_type: 'pdf' | 'epub'` discriminator on the Document model lets CenterViewer route between PdfViewer (unchanged) and a new EpubViewer. EPUB text is extracted server-side via the `epub` crate and stored as chapters in the existing `pages` table. The frontend renders EPUBs via `epubjs` in scrolled-doc mode.

**Tech Stack:** Rust `epub` crate (v2.1), `scraper` crate (v0.18) for HTML→text, frontend `epubjs` npm package.

---

### Task 1: Database migration — add `document_type` column

**Files:**
- Modify: `src-tauri/src/db/migrations.rs`
- Modify: `src-tauri/src/db/models.rs`

**Steps:**

- [ ] **Step 1: Add column to CREATE TABLE and add ALTER TABLE for existing DBs**

In `migrations.rs`, add `document_type TEXT DEFAULT 'pdf'` to the documents CREATE TABLE:

Before line 28 (the closing `);` of the CREATE TABLE):
```sql
            document_type TEXT DEFAULT 'pdf',
```

After the entire `execute_batch("...")` call (line 162), add a migration for existing databases:
```rust
// Add document_type column for existing databases
let _ = conn.execute("ALTER TABLE documents ADD COLUMN document_type TEXT DEFAULT 'pdf'", []);
```
The `let _` suppresses the error if the column already exists (fresh DB case).

- [ ] **Step 2: Add field to Rust Document struct**

In `models.rs`, add to the `Document` struct (after `has_native_toc`):
```rust
    pub document_type: String,
```

- [ ] **Step 3: Verify it compiles**

Run: `cargo build` from `src-tauri/`
Expected: compiles (existing code will need `document_type` set in constructors — that's the next task)

---

### Task 2: Generalize backend import/read commands

**Files:**
- Modify: `src-tauri/src/commands/documents.rs`

**Changes:**

- [ ] **Step 1: Rename `import_pdf` → `import_document` and auto-detect type**

```rust
#[tauri::command]
pub fn import_document(db: State<DbState>, file_path: String) -> Result<Document, String> {
    let path = PathBuf::from(&file_path);
    // ... same filename + sha256 logic ...

    let doc_type = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| match e.to_lowercase().as_str() {
            "epub" => "epub".to_string(),
            _ => "pdf".to_string(),
        })
        .unwrap_or_else(|| "pdf".to_string());

    // ... same INSERT but add document_type:
    conn.execute(
        "INSERT INTO documents (...) VALUES (... ,?9)",
        rusqlite::params![..., doc_type],
    )?;

    // Return Document with document_type set
}
```

The INSERT must include the new column:
```sql
INSERT INTO documents (id, title, original_filename, file_path, file_sha256, page_count, created_at, updated_at, last_opened_at, parse_status, has_native_toc, document_type)
VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8, 'pending', 0, ?9)
```

- [ ] **Step 2: Rename `read_document_pdf` → `read_document_bytes`**

Function body stays identical — it just reads raw file bytes. Rename the `#[tauri::command]` function.

- [ ] **Step 3: Update all SELECT queries to include `document_type`**

In `get_documents` and `get_document`, add `document_type` to the SELECT clause and `row.get(N)?` in the query_map.

`get_documents` SQL becomes (add after `has_native_toc`):
```sql
             SELECT id, title, original_filename, file_path, file_sha256, page_count,
                     created_at, updated_at, last_opened_at, last_page, last_zoom,
                     parse_status, has_native_toc, document_type
```

And in the `query_map` closure, add after `has_native_toc: row.get(12)?`:
```rust
                document_type: row.get(13)?,
```

Same pattern for `get_document`.

- [ ] **Step 4: Verify it compiles**

Run: `cargo build`
Expected: compiles cleanly.

---

### Task 3: EPUB extraction module (Rust backend)

**Files:**
- Create: `src-tauri/src/epub/mod.rs`
- Create: `src-tauri/src/epub/extractor.rs`
- Create: `src-tauri/src/epub/cover.rs`
- Create: `src-tauri/src/commands/epub.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add dependencies to Cargo.toml**

```toml
epub = "2.1"
scraper = "0.18"
```

- [ ] **Step 2: Create `src-tauri/src/epub/mod.rs`**

```rust
pub mod extractor;
pub mod cover;
```

- [ ] **Step 3: Create `src-tauri/src/epub/extractor.rs`**

```rust
use epub::doc::EpubDoc;
use std::path::Path;

/// Result for one spine item (chapter)
pub struct ChapterContent {
    pub index: usize,       // 0-based spine index
    pub title: String,
    pub text: String,
}

/// Extract all chapter text from an EPUB file.
/// Returns Vec of chapters and the total chapter count.
pub fn extract_chapters(path: &str) -> Result<(Vec<ChapterContent>, usize), String> {
    let mut doc = EpubDoc::new(Path::new(path))
        .map_err(|e| format!("Failed to open EPUB: {}", e))?;

    let total = doc.spine.len();
    let mut chapters = Vec::new();

    for (i, (html, _mime)) in doc.get_spine_iter().enumerate() {
        let title = doc.spine_items.get(i)
            .and_then(|item| item.0.as_ref())
            .cloned()
            .unwrap_or_else(|| format!("Chapter {}", i + 1));

        let text = strip_html(&html);
        chapters.push(ChapterContent { index: i, title, text });
    }

    Ok((chapters, total))
}

/// Extract TOC from EPUB navigation. Returns (label, level, spine_index) tuples.
pub fn extract_toc(path: &str) -> Result<Vec<(String, u32, Option<usize>)>, String> {
    let doc = EpubDoc::new(Path::new(path))
        .map_err(|e| format!("Failed to open EPUB: {}", e))?;

    let mut toc = Vec::new();
    flatten_nav(&doc.nav, 0, &mut toc);
    Ok(toc)
}

fn flatten_nav(nav: &[epub::doc::NavigationPoint], level: u32, result: &mut Vec<(String, u32, Option<usize>)>) {
    for point in nav {
        // Parse spine index from content href if possible
        let spine_idx = None; // ponytail: naive — fallback to ordering
        result.push((point.label.clone(), level, spine_idx));
        flatten_nav(&point.children, level + 1, result);
    }
}

fn strip_html(html: &str) -> String {
    use scraper::{Html, Selector};

    // Add newlines before block elements for paragraph separation
    let with_blocks = html
        .replace("</p>", "\n")
        .replace("</div>", "\n")
        .replace("</h1>", "\n")
        .replace("</h2>", "\n")
        .replace("</h3>", "\n")
        .replace("</h4>", "\n")
        .replace("</h5>", "\n")
        .replace("</h6>", "\n")
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("</li>", "\n")
        .replace("</tr>", "\n");

    let fragment = Html::parse_fragment(&with_blocks);
    let text: String = fragment.root_element().text().collect();
    
    // Decode common HTML entities
    let text = text
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");

    // Collapse whitespace
    let text: Vec<&str> = text.split_whitespace().collect();
    text.join(" ")
}
```

- [ ] **Step 4: Create `src-tauri/src/epub/cover.rs`**

```rust
use epub::doc::EpubDoc;
use std::path::Path;

/// Extract cover image bytes from EPUB.
/// Returns (image_bytes, mime_type) or None if no cover.
pub fn extract_cover(path: &str) -> Option<(Vec<u8>, String)> {
    let mut doc = EpubDoc::new(Path::new(path)).ok()?;
    let cover_data = doc.get_cover().ok()??;
    let mime = doc.cover_mime.unwrap_or_else(|| "image/jpeg".to_string());
    Some((cover_data, mime))
}
```

- [ ] **Step 5: Register epub module in `commands/mod.rs`**

Add:
```rust
pub mod epub;
```

- [ ] **Step 6: Create `src-tauri/src/commands/epub.rs`**

```rust
use crate::commands::settings::DbState;
use crate::epub;
use chrono::Utc;
use tauri::State;
use uuid::Uuid;

/// Extract EPUB content (chapter text + TOC) and save to DB.
/// Called once after import.
#[tauri::command]
pub fn extract_epub_content(
    db: State<DbState>,
    document_id: String,
    file_path: String,
) -> Result<i32, String> {
    let (chapters, total) = epub::extractor::extract_chapters(&file_path)?;

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();

    for ch in &chapters {
        let page_id = format!("p_{}_{}", document_id, ch.index + 1);
        conn.execute(
            "INSERT OR REPLACE INTO pages (id, document_id, page_number, text, text_status, char_count, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'ready', ?5, ?6, ?7)",
            rusqlite::params![
                page_id,
                document_id,
                (ch.index + 1) as i64,
                &ch.text,
                ch.text.len() as i64,
                now,
                now,
            ],
        ).map_err(|e| e.to_string())?;
    }

    // Save TOC
    let toc = epub::extractor::extract_toc(&file_path)?;
    let mut order = 0;
    let now_ts = &now;
    for (label, level, _spine_idx) in &toc {
        let node_id = Uuid::new_v4().to_string();
        // Convert spine index (0-based) to page number (1-based)
        let start_page = 1; // ponytail: use 1 for all, TOC highlights work by title matching
        conn.execute(
            "INSERT INTO toc_nodes (id, document_id, parent_id, title, level, order_index, start_page, end_page, source, confidence, created_at, updated_at)
             VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, NULL, 'epub_nav', 1.0, ?7, ?7)",
            rusqlite::params![node_id, document_id, label, level, order, start_page, now_ts],
        ).map_err(|e| e.to_string())?;
        order += 1;
    }

    // Update page_count and has_native_toc
    conn.execute(
        "UPDATE documents SET page_count = ?1, has_native_toc = 1, parse_status = 'ready' WHERE id = ?2",
        rusqlite::params![total as i64, document_id],
    ).map_err(|e| e.to_string())?;

    Ok(chapters.len() as i32)
}

/// Get cover image bytes for a document (any type).
#[tauri::command]
pub fn get_document_cover(
    document_id: String,
    file_path: String,
    document_type: String,
) -> Result<Option<Vec<u8>>, String> {
    if document_type == "epub" {
        match epub::cover::extract_cover(&file_path) {
            Some((data, _mime)) => Ok(Some(data)),
            None => Ok(None),
        }
    } else {
        Ok(None) // PDFs render covers via pdfjs page 1 in the frontend
    }
}
```

- [ ] **Step 7: Verify compilation**

Run: `cargo build`
Expected: compiles.

---

### Task 4: Update library scanning for EPUB

**Files:**
- Modify: `src-tauri/src/commands/library.rs`

- [ ] **Step 1: Update extension filter in `scan_folder_into_db`**

Line 116, change:
```rust
} else if file_path.extension().map(|e| e == "pdf").unwrap_or(false) {
```
to:
```rust
} else if let Some(ext) = file_path.extension().and_then(|e| e.to_str()) {
    let ext = ext.to_lowercase();
    if ext == "pdf" || ext == "epub" {
```
And close the block with `}` instead of the old `}`.

Also update the INSERT to include `document_type`. The import logic in `scan_folder_into_db` and `start_watcher` both use `documents::compute_sha256` but do their own INSERT (not calling `import_document`). Update both INSERTs to include `document_type`:

Determine doc type from extension (same pattern as `import_document`).

The INSERT adds `document_type` as the 9th parameter:
```sql
INSERT INTO documents (id,title,original_filename,file_path,file_sha256,page_count,created_at,updated_at,last_opened_at,parse_status,has_native_toc,document_type)
VALUES (?1,?2,?3,?4,?5,NULL,?6,?7,?8,'pending',0,?9)
```

In `scan_folder_into_db`, determine type before INSERT:
```rust
let doc_type = if ext == "epub" { "epub" } else { "pdf" };
```

And add `rusqlite::params![..., doc_type]` to the INSERT.

- [ ] **Step 2: Update extension filter in `start_watcher`**

Line 189, change:
```rust
if path.extension().map(|e| e == "pdf").unwrap_or(false) {
```
to:
```rust
if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
    let ext = ext.to_lowercase();
    if ext == "pdf" || ext == "epub" {
```
Same changes to INSERT params as step 1.

- [ ] **Step 3: Verify compilation**

Run: `cargo build`
Expected: compiles.

---

### Task 5: Register new commands in lib.rs

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Update command registration and menu**

Replace `import_pdf` with `import_document`, `read_document_pdf` with `read_document_bytes`, and add the new EPUB commands:

In the `generate_handler![]` macro, change:
```rust
commands::documents::import_pdf,
commands::documents::read_document_pdf,
```
to:
```rust
commands::documents::import_document,
commands::documents::read_document_bytes,
```

Add after the existing commands:
```rust
commands::epub::extract_epub_content,
commands::epub::get_document_cover,
```

- [ ] **Step 2: Update menu item names**

Change "Open PDF…" to "Open Document…" (line 51):
```rust
let open = MenuItemBuilder::with_id("open_pdf", "Open Document…")
```

- [ ] **Step 3: Verify compilation**

Run: `cargo build`
Expected: compiles.

---

### Task 6: Frontend — update Document interface, store, file dialog

**Files:**
- Modify: `src/stores/documentStore.ts`

- [ ] **Step 1: Add `document_type` to the Document interface**

```typescript
export interface Document {
  // ...existing fields...
  document_type: 'pdf' | 'epub';
}
```

- [ ] **Step 2: Update `handleOpenPdf` → `handleOpenDocument`**

Rename the function and update the dialog filter:
```typescript
handleOpenDocument: async () => {
    if (!isTauriRuntime()) return;
    const selected = await open({
      multiple: false,
      filters: [{ name: "Documents", extensions: ["pdf", "epub"] }],
    });
    if (!selected) return;
    const doc = await invoke<Document>("import_document", { filePath: selected });
    get().setCurrentDocument(doc);
    // After import, trigger EPUB text extraction if needed
    if (doc.document_type === 'epub') {
      // Fire and forget — epic reads content and fills pages/toc tables
      invoke("extract_epub_content", { documentId: doc.id, filePath: doc.file_path }).catch(() => {});
    }
    const docs = await invoke<Document[]>("get_documents");
    get().setDocuments(docs);
  },
```

Export `handleOpenDocument` in the interface and store. Remove `handleOpenPdf`.

- [ ] **Step 3: Update `setCurrentDocument` for EPUB**

In `setCurrentDocument`:
```typescript
setCurrentDocument: (doc) =>
    set({
      currentDocument: doc,
      currentPage: doc?.last_page ?? 1,
      zoom: doc?.last_zoom ?? 1.0,
    }),
```
The `last_page` for EPUB represents a 0-100 scroll percentage — this is fine since we use it directly.

- [ ] **Step 4: Handle menu event rename**

Keep `"menu-open-pdf"` event in `App.tsx` for backward compat, but also add a `handleOpenDocument` call. Actually, just rename the handler in `App.tsx` later — note this for Task 9.

---

### Task 7: Frontend — EpubViewer component

**Files:**
- Create: `src/features/epub/EpubViewer.tsx`
- Modify: `package.json`

- [ ] **Step 1: Install epubjs**

```bash
npm install epubjs
```

- [ ] **Step 2: Create `src/features/epub/EpubViewer.tsx`**

```typescript
import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import ePub from "epubjs";
import type { Book, Rendition } from "epubjs";
import { useDocumentStore } from "../../stores/documentStore";
import { useAiStore } from "../../stores/aiStore";
import { documentDisplayTitle } from "../../stores/documentStore";

interface EpubViewerProps {
  documentId: string;
  onBackHome?: () => void;
  onOpenLibrary?: () => void;
  onOpenAi?: (draft?: string) => void;
}

function Icon({ name }: { name: "home" | "books" | "ask" | "prev" | "next" | "search" | "moon" | "sun" | "minus" | "plus" | "close" }) {
  const common = { width: 17, height: 17, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<string, JSX.Element> = {
    books: <><path d="M4 19.5V5a2 2 0 0 1 2-2h11" /><path d="M6 17h13" /><path d="M6 21h13V7H6a2 2 0 0 0 0 4" /></>,
    home: <><path d="m15 18-6-6 6-6" /><path d="M20 12H9" /><path d="M5 19V5" /></>,
    ask: <><path d="M12 3a7 7 0 0 1 7 7c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 7-7Z" /><path d="M12 8v4" /><path d="M12 16h.01" /></>,
    prev: <><path d="m15 18-6-6 6-6" /></>,
    next: <><path d="m9 18 6-6-6-6" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
    moon: <><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.5 6.5 0 0 0 21 12.8Z" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.9 4.9 1.4 1.4" /><path d="m17.7 17.7 1.4 1.4" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.3 17.7-1.4 1.4" /><path d="m19.1 4.9-1.4 1.4" /></>,
    minus: <><path d="M5 12h14" /></>,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    close: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  };
  return <svg aria-hidden="true" {...common}>{paths[name]}</svg>;
}

export default function EpubViewer({ documentId, onBackHome, onOpenLibrary, onOpenAi }: EpubViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(100); // percentage
  const { currentDocument, setCurrentPage, currentPage, setTocNodes } = useDocumentStore();
  const runWorkflow = useAiStore((s) => s.runWorkflow);

  // Load EPUB
  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;

    const load = async () => {
      try {
        const data = await invoke<number[] | Uint8Array>("read_document_bytes", { documentId });
        const book = ePub(new Uint8Array(data));
        bookRef.current = book;

        const rendition = book.renderTo(containerRef.current!, {
          flow: "scrolled-doc",
          width: "100%",
          height: "100%",
          spread: "none",
        });
        renditionRef.current = rendition;

        // Restore position (last_page as 0-100 scroll percentage)
        const startPct = currentDocument?.last_page ?? 0;
        if (startPct > 0) {
          // epubjs location can be set by percentage
          const locations = await book.locations.generate();
          const target = locations.cfiFromPercentage(startPct / 100);
          await rendition.display(target);
        } else {
          await rendition.display();
        }

        // Track scroll position
        rendition.on("relocated", (location: any) => {
          if (location?.start?.percentage) {
            const pct = Math.round(location.start.percentage * 100);
            setCurrentPage(pct);
            // Debounced save
            invoke("update_last_page", { documentId, pageNumber: pct }).catch(() => {});
          }
        });

        // Extract TOC from book navigation (client-side — immediate, no DB race)
        const nav = book.navigation?.toc ?? [];
        if (nav.length > 0) {
          const flattenNav = (items: any[], level: number, order: { v: number }): any[] => {
            const result: any[] = [];
            for (const item of items) {
              result.push({
                id: `${documentId}-toc-${order.v}`,
                title: item.label,
                level,
                start_page: order.v + 1,
                end_page: null,
                order_index: order.v,
              });
              order.v++;
              if (item.subitems?.length) {
                result.push(...flattenNav(item.subitems, level + 1, order));
              }
            }
            return result;
          };
          const flat = flattenNav(nav, 0, { v: 0 });
          setTocNodes(flat);
        }
      } catch (err) {
        if (!destroyed) setError(`Failed to load EPUB: ${err}`);
      }
    };
    load();

    return () => {
      destroyed = true;
      renditionRef.current?.destroy();
      bookRef.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  // Apply font size
  useEffect(() => {
    if (!renditionRef.current) return;
    renditionRef.current.themes?.fontSize(`${fontSize}%`);
  }, [fontSize]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        // Theme toggle — already handled by useSettingsStore globally
        return;
      }
      if (e.metaKey || e.ctrlKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        window.scrollBy({ top: -window.innerHeight * 0.9, behavior: "smooth" });
      }
      if (e.key === "ArrowDown" || e.key === "PageDown") {
        e.preventDefault();
        window.scrollBy({ top: window.innerHeight * 0.9, behavior: "smooth" });
      }
      if (e.key === "+" || e.key === "=") { e.preventDefault(); setFontSize((s) => Math.min(200, s + 10)); }
      if (e.key === "-") { e.preventDefault(); setFontSize((s) => Math.max(50, s - 10)); }
      if (e.key === "0") { e.preventDefault(); setFontSize(100); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // Debounced zoom (font size) persistence
  useEffect(() => {
    const timer = setTimeout(() => {
      if (currentDocument) {
        invoke("update_last_zoom", { documentId, zoom: fontSize / 100 }).catch(() => {});
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [fontSize, documentId, currentDocument]);

  return (
    <div className="pdf-viewer"> {/* Reuse same CSS class for toolbar layout */}
      {/* Toolbar — same as PdfViewer but adapted for EPUB */}
      <div className="reader-toolbar">
        <button className="toolbar-text-button" onClick={onBackHome} aria-label="Back to home">
          <Icon name="home" />
          Back to home
        </button>
        <span className="toolbar-divider" />
        <span className="page-control">
          {currentDocument && (
            <span>Chapter {currentPage > 0 ? Math.ceil(currentPage / 10) : 1} / {currentDocument.page_count ?? "?"}</span>
          )}
        </span>
        <span className="toolbar-center">
          <button className="toolbar-text-button" onClick={onOpenLibrary} aria-label="Open library">
            <Icon name="books" />
            Library
          </button>
          <button className="toolbar-text-button" onClick={() => onOpenAi?.()} aria-label="Open AI assistant">
            <Icon name="ask" />
            Ask
          </button>
        </span>
        <span className="toolbar-spacer" />
        <button className="icon-button" onClick={() => setFontSize((s) => Math.max(50, s - 10))} disabled={fontSize <= 50} aria-label="Zoom out"><Icon name="minus" /></button>
        <button className="zoom-reset" onClick={() => setFontSize(100)}>{fontSize}%</button>
        <button className="icon-button" onClick={() => setFontSize((s) => Math.min(200, s + 10))} disabled={fontSize >= 200} aria-label="Zoom in"><Icon name="plus" /></button>
      </div>

      {/* EPUB render container */}
      {error ? (
        <div style={{ padding: 24, textAlign: "center" }}>
          <p style={{ color: "var(--danger-color)" }}>{error}</p>
        </div>
      ) : (
        <div
          ref={containerRef}
          className="epub-scroll"
          style={{ height: "100%", overflow: "auto", padding: "0 16px" }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add epub-scroll CSS**

In `src/index.css`, add:
```css
.epub-scroll {
  max-width: 720px;
  margin: 0 auto;
}
.epub-scroll iframe {
  width: 100% !important;
}
```

---

### Task 8: Frontend — CenterViewer routing and book covers

**Files:**
- Modify: `src/components/CenterViewer.tsx`

- [ ] **Step 1: Import EpubViewer and route by document_type**

Replace the direct `<PdfViewer>` render with a switch:

```typescript
import EpubViewer from "../features/epub/EpubViewer";

// In the render section, replace:
// <PdfViewer key={currentDocument.id} ... />
// with:

{currentDocument.document_type === 'epub' ? (
  <EpubViewer
    key={currentDocument.id}
    documentId={currentDocument.id}
    onBackHome={onBackHome}
    onOpenLibrary={onOpenLibrary}
    onOpenAi={onOpenAi}
  />
) : (
  <PdfViewer
    key={currentDocument.id}
    documentId={currentDocument.id}
    onBackHome={onBackHome}
    onOpenLibrary={onOpenLibrary}
    onOpenAi={onOpenAi}
  />
)}
```

- [ ] **Step 2: Update handleOpenPdf references to handleOpenDocument**

Replace all occurrences of `handleOpenPdf` with `handleOpenDocument` in CenterViewer.

Line 50: `onClick={() => handleOpenPdf(...)` → `onClick={() => handleOpenDocument(...)`
Line 72: `"Add a PDF to begin."` → `"Add a document to begin."`

- [ ] **Step 3: Update BookCover for EPUB**

The `BookCover` component currently calls `read_document_pdf` for all documents. Change the `renderCover` function to dispatch based on document type:

```typescript
async function renderCover(documentId: string, docType: string): Promise<string | null> {
  if (docType === 'epub') {
    try {
      const doc = useDocumentStore.getState().documents.find(d => d.id === documentId);
      if (!doc) return null;
      const cover = await invoke<number[] | null>("get_document_cover", {
        documentId, filePath: doc.file_path, documentType: docType,
      });
      if (!cover) return null;
      const blob = new Blob([new Uint8Array(cover)]);
      return URL.createObjectURL(blob);
    } catch { return null; }
  }
  // PDF: existing pdfjs rendering
  const data = await invoke<number[] | Uint8Array>("read_document_bytes", { documentId });
  // ... rest stays the same
}
```

Update the `doc_type` extraction in the `BookCover` component to add `doc.document_type` to the `renderCover` call.

Update the cover fallback text from "PDF" to "DOC" or show nothing:
```typescript
{src ? <img src={src} alt="" /> : <span>{doc.document_type === 'epub' ? 'EPUB' : 'PDF'}</span>}
```

- [ ] **Step 4: Fix library empty state text**

Line 47: Change `"Add a PDF to begin."` to `"Add a document to begin."`

---

### Task 9: Frontend — App.tsx and menu event updates

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Update menu event handlers**

In `App.tsx`, find the `menu-open-pdf` event listener and add `menu-open-document`:

The existing listener for `menu-open-pdf` currently calls `handleOpenPdf`. Update to call `handleOpenDocument`.

If the file-dialog-open logic is directly in the event handler, make sure it uses the new `import_document` command and the combined filter.

---

### Task 10: AI context builder — EPUB-aware text formatting

**Files:**
- Modify: `src-tauri/src/ai/context_builder.rs`

- [ ] **Step 1: Add EPUB-aware formatting to context builders**

The key change: EPUB chapters are stored as pages in the DB, but the context builder should format them with `[ch.N]` instead of `[p.N]`. However, the context builder already reads from the `pages` table and has no knowledge of the document type.

For v1, keep the existing `[p.N]` format — it works fine since EPUB chapters are stored as pages. The user sees `[p.1]` for chapter 1, which is slightly incongruous but functional. The `chapter_qa` mode already handles this correctly.

The more important change is in the prompts (not the context builder). The PDF prompts instruct the AI to use `[p.X]` citations. For EPUB, we want the AI to use position-based citations.

Since the document type isn't currently passed to the context builder, the simplest approach is:

1. Look up the document type in the context builder function (query the `documents` table)
2. Format text accordingly: `[p.{n}]` for PDF, `[ch.{n}]` for EPUB

Add a helper:
```rust
fn get_document_type(conn: &Connection, document_id: &str) -> String {
    conn.query_row(
        "SELECT document_type FROM documents WHERE id = ?1",
        rusqlite::params![document_id],
        |row| row.get::<_, String>(0),
    ).unwrap_or_else(|_| "pdf".to_string())
}
```

Then update each context builder's text formatting:
```rust
let doc_type = get_document_type(conn, document_id);
let label = if doc_type == "epub" { "ch" } else { "p" };
// Use label instead of "p" in format strings:
text: format!("[{}.{}]\n{}", label, page_number, text),
```

This changes only the format string prefix. The rest of the context builder logic stays identical.

- [ ] **Step 2: Verify compilation**

Run: `cargo build`
Expected: compiles.

---

### Task 11: Verify end-to-end

- [ ] **Step 1: Run tests**

```bash
npm test
```
Expected: all existing tests pass.

- [ ] **Step 2: Run Rust build**

```bash
cd src-tauri && cargo build
```
Expected: compiles without warnings.

- [ ] **Step 3: Manual verification checklist**
1. Open a `.pdf` — existing reader works as before
2. Open a `.epub` — renders in scrolling mode with proper chapter text
3. Library view shows both PDF and EPUB files
4. EPUB book covers display correctly (or fallback icon)
5. Folder scan imports both formats
6. Font size zoom works (+/- keys)
7. Reading position persists on re-open (scroll percentage saved to `last_page`)
8. AI features work with EPUB content
9. Search works across EPUB text
10. TOC sidebar shows EPUB chapter navigation

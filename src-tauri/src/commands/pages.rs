use chrono::Utc;
use serde::Serialize;
use std::collections::BTreeMap;
use std::env;
use std::path::Path;
use tauri::Manager;
use tauri::State;

use super::settings::DbState;
use crate::ai::context_builder::cache_page_text;

/// OCR command result status — serialized as plain string via serde.
#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OcrStatus {
    Ok,
    Empty,
    Skipped,
}

fn insert_page_text(
    conn: &rusqlite::Connection,
    document_id: &str,
    page_number: i64,
    text: &str,
    text_status: &str,
) -> Result<(), String> {
    let id = page_row_id(document_id, page_number);
    let now = Utc::now().to_rfc3339();
    let char_count = text.chars().count() as i64;
    conn.execute(
        "INSERT INTO pages (id, document_id, page_number, text, text_status, char_count, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(document_id, page_number) DO UPDATE SET
           text = excluded.text,
           text_status = excluded.text_status,
           char_count = excluded.char_count,
           updated_at = excluded.updated_at",
        rusqlite::params![id, document_id, page_number, text, text_status, char_count, now, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct PageText {
    pub id: String,
    pub document_id: String,
    pub page_number: i64,
    pub text: Option<String>,
    pub text_status: String,
    pub char_count: i64,
}

#[derive(Debug, Serialize, Clone)]
pub struct PageTextCoverage {
    pub page_number: i64,
    pub text_status: String,
    pub char_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSearchResult {
    pub page_num: i64,
    pub context: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearPageTextCacheResult {
    pub deleted_rows: usize,
}

pub(crate) fn page_row_id(document_id: &str, page_number: i64) -> String {
    // Deterministic ID from document_id + page_number so upserts don't orphan FKs
    format!("p_{}_{}", document_id, page_number)
}

#[tauri::command]
pub fn get_pages_text(
    db: State<DbState>,
    document_id: String,
    start_page: i64,
    end_page: i64,
) -> Result<Vec<PageText>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, document_id, page_number, text, text_status, char_count
             FROM pages WHERE document_id = ?1 AND page_number BETWEEN ?2 AND ?3
             ORDER BY page_number",
        )
        .map_err(|e| e.to_string())?;

    let pages = stmt
        .query_map(
            rusqlite::params![document_id, start_page, end_page],
            |row| {
                Ok(PageText {
                    id: row.get(0)?,
                    document_id: row.get(1)?,
                    page_number: row.get(2)?,
                    text: row.get(3)?,
                    text_status: row.get(4)?,
                    char_count: row.get(5)?,
                })
            },
        )
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(pages)
}

#[tauri::command]
pub fn get_pages_text_coverage(
    db: State<DbState>,
    document_id: String,
    start_page: i64,
    end_page: i64,
) -> Result<Vec<PageTextCoverage>, String> {
    let start = start_page.min(end_page).max(1);
    let end = start_page.max(end_page).max(start);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT page_number, text_status, char_count
             FROM pages WHERE document_id = ?1 AND page_number BETWEEN ?2 AND ?3
             ORDER BY page_number",
        )
        .map_err(|e| e.to_string())?;

    let rows: BTreeMap<i64, PageTextCoverage> = stmt
        .query_map(rusqlite::params![document_id, start, end], |row| {
            let page_number = row.get(0)?;
            Ok((
                page_number,
                PageTextCoverage {
                    page_number,
                    text_status: row.get(1)?,
                    char_count: row.get(2)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok((start..=end)
        .map(|page_number| {
            rows.get(&page_number).cloned().unwrap_or(PageTextCoverage {
                page_number,
                text_status: "missing".into(),
                char_count: 0,
            })
        })
        .collect())
}

#[tauri::command]
pub fn count_indexed_pages(db: State<DbState>, document_id: String) -> Result<i64, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT COUNT(*) FROM pages WHERE document_id = ?1 AND text_status = 'ready'",
        rusqlite::params![document_id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_pages_text(
    db: State<DbState>,
    document_id: String,
    query: String,
    limit: Option<i64>,
) -> Result<Vec<PageSearchResult>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let max_results = limit.unwrap_or(200).clamp(1, 1000);
    let like = format!("%{}%", escape_like(q.to_ascii_lowercase()));
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT page_number, text
             FROM pages
             WHERE document_id = ?1
               AND text_status = 'ready'
               AND LOWER(COALESCE(text, '')) LIKE ?2 ESCAPE '\\'
             ORDER BY page_number
             LIMIT ?3",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![document_id, like, max_results], |row| {
            let page_num: i64 = row.get(0)?;
            let text: String = row.get(1)?;
            Ok(PageSearchResult {
                page_num,
                context: snippet(&text, q, 40),
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}

fn escape_like(input: String) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn snippet(text: &str, query: &str, radius: usize) -> String {
    let haystack = text.to_ascii_lowercase();
    let needle = query.to_ascii_lowercase();
    let Some(pos) = haystack.find(&needle) else {
        return text.chars().take(radius * 2).collect();
    };
    let start = text[..pos]
        .char_indices()
        .rev()
        .nth(radius)
        .map(|(i, _)| i)
        .unwrap_or(0);
    let end = text[pos..]
        .char_indices()
        .nth(query.chars().count() + radius)
        .map(|(i, _)| pos + i)
        .unwrap_or(text.len());
    format!(
        "{}{}{}",
        if start > 0 { "..." } else { "" },
        text[start..end].trim(),
        if end < text.len() { "..." } else { "" },
    )
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageTextInput {
    pub page_number: i64,
    pub text: String,
}

#[tauri::command]
pub fn save_pages_text(
    db: State<DbState>,
    document_id: String,
    pages: Vec<PageTextInput>,
) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for p in &pages {
        insert_page_text(&tx, &document_id, p.page_number, &p.text, "ready")?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    for p in &pages {
        cache_page_text(&document_id, p.page_number, &p.text);
    }
    Ok(())
}

fn clear_pdf_page_text_cache_for_conn(
    conn: &rusqlite::Connection,
) -> Result<ClearPageTextCacheResult, String> {
    let deleted_rows = conn
        .execute(
            "DELETE FROM pages
             WHERE document_id IN (
               SELECT id FROM documents WHERE document_type = 'pdf'
             )",
            [],
        )
        .map_err(|e| e.to_string())?;
    Ok(ClearPageTextCacheResult { deleted_rows })
}

#[tauri::command]
pub fn clear_pdf_page_text_cache(db: State<DbState>) -> Result<ClearPageTextCacheResult, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    clear_pdf_page_text_cache_for_conn(&conn)
}

#[tauri::command]
pub fn mark_page_text_failed(
    db: State<DbState>,
    document_id: String,
    page_number: i64,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    insert_page_text(&conn, &document_id, page_number, "", "failed")
}

// ---------------------------------------------------------------------------
// OCR
// ---------------------------------------------------------------------------

fn resolve_tessdata(app: &tauri::AppHandle) -> Result<String, String> {
    if let Some(path) = crate::ocr::get_tessdata_path() {
        return Ok(path.to_string());
    }

    // 0. TESSDATA_PREFIX — the standard Tesseract discovery mechanism.
    if let Ok(val) = env::var("TESSDATA_PREFIX") {
        let p = Path::new(&val);
        if p.join("eng.traineddata").is_file() {
            let s = p.to_string_lossy().to_string();
            crate::ocr::init_tessdata_path(&s);
            return Ok(s);
        }
    }

    // 1. Homebrew (Apple Silicon) — common dev setup
    let homebrew = Path::new("/opt/homebrew/share/tessdata");
    if homebrew.join("eng.traineddata").is_file() {
        let p = homebrew.to_string_lossy().to_string();
        crate::ocr::init_tessdata_path(&p);
        return Ok(p);
    }

    // 2. Tauri bundled resources (production build)
    if let Ok(dir) = app.path().resource_dir() {
        let bundled = dir.join("assets/tessdata");
        if bundled.join("eng.traineddata").is_file() {
            let p = bundled.to_string_lossy().to_string();
            crate::ocr::init_tessdata_path(&p);
            return Ok(p);
        }
    }

    // 3. Homebrew (Intel macOS)
    let usr_local = Path::new("/usr/local/share/tessdata");
    if usr_local.join("eng.traineddata").is_file() {
        let p = usr_local.to_string_lossy().to_string();
        crate::ocr::init_tessdata_path(&p);
        return Ok(p);
    }

    // 4. Linux standard paths
    let linux_paths = [
        "/usr/share/tesseract-ocr/5/tessdata",
        "/usr/share/tesseract-ocr/4.00/tessdata",
        "/usr/share/tessdata",
    ];
    for path in &linux_paths {
        let p = Path::new(path);
        if p.join("eng.traineddata").is_file() {
            let s = p.to_string_lossy().to_string();
            crate::ocr::init_tessdata_path(&s);
            return Ok(s);
        }
    }

    Err("Tesseract training data not found. Install Tesseract or set TESSDATA_PREFIX.".to_string())
}

#[tauri::command]
pub fn ocr_page(
    app: tauri::AppHandle,
    db: State<DbState>,
    document_id: String,
    page_number: i64,
    image_png: Vec<u8>,
) -> Result<OcrStatus, String> {
    let tessdata_path = resolve_tessdata(&app)?;
    let text = crate::ocr::ocr_png_bytes(&image_png, &tessdata_path)?;

    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Don't overwrite higher-quality text-layer text if it already exists
    let id = page_row_id(&document_id, page_number);
    let existing: Option<String> = conn
        .query_row(
            "SELECT text_status FROM pages WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .ok();
    if existing.as_deref() == Some("ready") {
        return Ok(OcrStatus::Skipped);
    }

    if text.is_empty() {
        // Use INSERT OR REPLACE so the failure state is persisted even if no row existed
        insert_page_text(&conn, &document_id, page_number, "", "failed")?;
        return Ok(OcrStatus::Empty);
    }

    insert_page_text(&conn, &document_id, page_number, &text, "ready")?;
    cache_page_text(&document_id, page_number, &text);
    Ok(OcrStatus::Ok)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_text_upsert_preserves_existing_row_id() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE pages (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                page_number INTEGER NOT NULL,
                text TEXT,
                text_status TEXT DEFAULT 'pending',
                char_count INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(document_id, page_number)
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO pages (id, document_id, page_number, text, text_status, char_count, created_at, updated_at)
             VALUES ('existing_id', 'doc', 7, 'old', 'ready', 3, 'created', 'created')",
            [],
        )
        .unwrap();

        insert_page_text(&conn, "doc", 7, "new text", "ready").unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pages WHERE document_id = 'doc' AND page_number = 7",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let (id, text, char_count): (String, String, i64) = conn
            .query_row(
                "SELECT id, text, char_count FROM pages WHERE document_id = 'doc' AND page_number = 7",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(count, 1);
        assert_eq!(id, "existing_id");
        assert_eq!(text, "new text");
        assert_eq!(char_count, 8);
    }

    #[test]
    fn clears_only_pdf_page_text_cache() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE documents (id TEXT PRIMARY KEY, document_type TEXT DEFAULT 'pdf');
            CREATE TABLE pages (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                page_number INTEGER NOT NULL,
                text TEXT,
                text_status TEXT DEFAULT 'pending',
                char_count INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(document_id, page_number)
            );
            INSERT INTO documents (id, document_type) VALUES ('pdf1', 'pdf'), ('epub1', 'epub');
            INSERT INTO pages (id, document_id, page_number, text, created_at, updated_at)
              VALUES ('p1', 'pdf1', 1, 'pdf text', 'now', 'now'),
                     ('p2', 'epub1', 1, 'epub text', 'now', 'now');
            ",
        )
        .unwrap();

        let result = clear_pdf_page_text_cache_for_conn(&conn).unwrap();
        let remaining: i64 = conn
            .query_row("SELECT COUNT(*) FROM pages", [], |row| row.get(0))
            .unwrap();
        let epub_text: String = conn
            .query_row(
                "SELECT text FROM pages WHERE document_id = 'epub1'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(result.deleted_rows, 1);
        assert_eq!(remaining, 1);
        assert_eq!(epub_text, "epub text");
    }
}

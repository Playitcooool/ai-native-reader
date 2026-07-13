use crate::commands::settings::DbState;
use crate::epub;
use chrono::Utc;
use std::path::PathBuf;
use tauri::Manager;
use tauri::State;
use uuid::Uuid;

const MAX_COVER_BYTES: usize = 10 * 1024 * 1024;

fn validate_cover_size(size: usize) -> Result<(), String> {
    if size > MAX_COVER_BYTES {
        return Err("Cover image is too large to cache safely.".into());
    }
    Ok(())
}

fn covers_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("covers");
    std::fs::create_dir_all(&dir).ok();
    Ok(dir)
}

#[tauri::command]
pub fn extract_epub_content(db: State<DbState>, document_id: String) -> Result<i32, String> {
    let (stored_path, access_bookmark, document_type): (String, Option<Vec<u8>>, String) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT file_path, access_bookmark, document_type FROM documents WHERE id = ?1",
            rusqlite::params![document_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => "Document not found".to_string(),
            _ => e.to_string(),
        })?
    };
    if document_type != "epub" {
        return Err("Content extraction only supports EPUB documents.".into());
    }
    let (chapters, total, toc, meta_title, meta_author) =
        crate::file_access::with_access(&stored_path, access_bookmark.as_deref(), || {
            epub::extractor::extract_chapters(&stored_path)
        })?;

    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();

    tx.execute(
        "DELETE FROM pages WHERE document_id = ?1",
        rusqlite::params![document_id],
    )
    .map_err(|e| e.to_string())?;

    for ch in &chapters {
        let page_id = format!("p_{}_{}", document_id, ch.index + 1);
        tx.execute(
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
        )
        .map_err(|e| e.to_string())?;
    }

    tx.execute(
        "DELETE FROM toc_nodes WHERE document_id = ?1 AND source = 'epub_nav'",
        rusqlite::params![document_id],
    )
    .map_err(|e| e.to_string())?;

    // Save TOC
    for (order, (label, level)) in toc.iter().enumerate() {
        let node_id = Uuid::new_v4().to_string();
        let start_page = ((order + 1).min(total.max(1))) as i64;
        let end_page = toc
            .iter()
            .enumerate()
            .skip(order + 1)
            .find(|(_, (_, next_level))| next_level <= level)
            .map(|(next_order, _)| (next_order as i64).min(total as i64))
            .unwrap_or(total as i64);
        tx.execute(
            "INSERT INTO toc_nodes (id, document_id, parent_id, title, level, order_index, start_page, end_page, source, confidence, created_at, updated_at)
             VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, 'epub_nav', 1.0, ?8, ?8)",
            rusqlite::params![node_id, document_id, label, level, order as i64, start_page, end_page, now],
        )
        .map_err(|e| e.to_string())?;
    }

    // Update document metadata (title, author) from EPUB
    if meta_title.is_some() || meta_author.is_some() {
        tx.execute(
            "UPDATE documents SET title = COALESCE(NULLIF(?1, ''), title), author = COALESCE(NULLIF(?2, ''), author) WHERE id = ?3",
            rusqlite::params![meta_title, meta_author, document_id],
        )
        .map_err(|e| e.to_string())?;
    }

    // Update page_count and has_native_toc
    tx.execute(
        "UPDATE documents SET page_count = ?1, has_native_toc = 1, parse_status = 'ready' WHERE id = ?2",
        rusqlite::params![total as i64, document_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;

    Ok(chapters.len() as i32)
}

#[tauri::command]
pub fn get_document_cover(
    db: State<DbState>,
    document_id: String,
    app: tauri::AppHandle,
) -> Result<Option<Vec<u8>>, String> {
    validate_document_id(&document_id)?;
    let (stored_path, access_bookmark, document_type): (String, Option<Vec<u8>>, String) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT file_path, access_bookmark, document_type FROM documents WHERE id = ?1",
            rusqlite::params![document_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => "Document not found".to_string(),
            _ => e.to_string(),
        })?
    };
    if document_type != "epub" {
        return Ok(None);
    }

    let cached = get_cached_cover_inner(&app, &document_id);
    if let Some(data) = cached {
        return Ok(Some(data));
    }

    match crate::file_access::with_access(&stored_path, access_bookmark.as_deref(), || {
        Ok(epub::cover::extract_cover(&stored_path))
    })? {
        Some((data, _mime)) => {
            validate_cover_size(data.len())?;
            let _ = std::fs::write(cover_path(&app, &document_id)?, &data);
            Ok(Some(data))
        }
        None => Ok(None),
    }
}

fn validate_document_id(document_id: &str) -> Result<(), String> {
    Uuid::parse_str(document_id)
        .map(|_| ())
        .map_err(|_| "Invalid document id".to_string())
}

fn cover_path(app: &tauri::AppHandle, document_id: &str) -> Result<PathBuf, String> {
    validate_document_id(document_id)?;
    Ok(covers_dir(app)?.join(document_id))
}

fn get_cached_cover_inner(app: &tauri::AppHandle, document_id: &str) -> Option<Vec<u8>> {
    let path = cover_path(app, document_id).ok()?;
    if path.exists()
        && path
            .metadata()
            .ok()
            .is_some_and(|meta| meta.len() <= MAX_COVER_BYTES as u64)
    {
        std::fs::read(path).ok()
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_oversized_cover_cache_payloads() {
        assert!(validate_cover_size(MAX_COVER_BYTES).is_ok());
        assert!(validate_cover_size(MAX_COVER_BYTES + 1).is_err());
    }

    #[test]
    fn rejects_unsafe_cover_cache_ids() {
        assert!(validate_document_id(&Uuid::new_v4().to_string()).is_ok());
        assert!(validate_document_id("../reader.db").is_err());
    }
}

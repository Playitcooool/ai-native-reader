use super::settings::DbState;
use crate::db::models::{Collection, Document, DocumentCollection};
use chrono::Utc;
use std::path::PathBuf;
use tauri::{ipc::Response, State};
use uuid::Uuid;

const MAX_DOCUMENT_BYTES: u64 = 512 * 1024 * 1024;

fn binary_response(bytes: Vec<u8>) -> Response {
    Response::new(bytes)
}

fn validate_document_size_value(size: u64) -> Result<(), String> {
    if size > MAX_DOCUMENT_BYTES {
        return Err("Document is too large to open safely. Limit is 512 MiB.".into());
    }
    Ok(())
}

pub(crate) fn validate_document_size(file_path: &str) -> Result<(), String> {
    let metadata =
        std::fs::metadata(file_path).map_err(|e| format!("Failed to inspect document: {}", e))?;
    if !metadata.is_file() {
        return Err("Selected document is not a file.".into());
    }
    validate_document_size_value(metadata.len())
}

#[tauri::command]
pub fn import_document(db: State<DbState>, file_path: String) -> Result<Document, String> {
    let path = PathBuf::from(&file_path);
    let filename = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| "Invalid file path".to_string())?;

    let doc_type = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| match e.to_lowercase().as_str() {
            "epub" => "epub".to_string(),
            "pdf" => "pdf".to_string(),
            _ => "unsupported".to_string(),
        })
        .unwrap_or_else(|| "unsupported".to_string());
    if doc_type == "unsupported" {
        return Err("Only PDF and EPUB documents can be imported.".into());
    }
    let access_bookmark = crate::file_access::create_bookmark(&file_path, false);
    crate::file_access::with_access(&file_path, access_bookmark.as_deref(), || {
        validate_document_size(&file_path)
    })?;

    // Extract metadata from PDFs; EPUB metadata extracted later by extract_epub_content
    let (meta_title, meta_author) = if doc_type == "pdf" {
        crate::file_access::with_access(&file_path, access_bookmark.as_deref(), || {
            Ok(crate::pdf::extract_metadata(&file_path))
        })?
    } else {
        (None, None)
    };

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    let title = meta_title.clone().unwrap_or_else(|| filename.clone());

    conn.execute(
        "INSERT INTO documents (id, title, original_filename, file_path, file_sha256, page_count, created_at, updated_at, last_opened_at, parse_status, has_native_toc, document_type, author, access_bookmark)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8, 'pending', 0, ?9, ?10, ?11)",
        rusqlite::params![id, title, filename, file_path, Option::<String>::None, now, now, now, doc_type, meta_author, access_bookmark],
    )
    .map_err(|e| format!("Failed to insert document: {}", e))?;

    Ok(Document {
        id,
        title: Some(title),
        original_filename: filename,
        file_path,
        file_sha256: None,
        page_count: None,
        created_at: now.clone(),
        updated_at: now.clone(),
        last_opened_at: Some(now),
        last_page: Some(1),
        last_zoom: Some(1.0),
        parse_status: Some("pending".into()),
        has_native_toc: Some(false),
        document_type: doc_type,
        author: meta_author,
    })
}

#[tauri::command]
pub fn get_documents(db: State<DbState>) -> Result<Vec<Document>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    get_documents_for_conn(&conn)
}

fn get_documents_for_conn(conn: &rusqlite::Connection) -> Result<Vec<Document>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, original_filename, file_path, file_sha256, page_count,
                    created_at, updated_at, last_opened_at, last_page, last_zoom,
                    parse_status, has_native_toc, document_type, author
             FROM documents WHERE removed_at IS NULL
             ORDER BY last_opened_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let docs = stmt
        .query_map([], |row| {
            Ok(Document {
                id: row.get(0)?,
                title: row.get(1)?,
                original_filename: row.get(2)?,
                file_path: row.get(3)?,
                file_sha256: row.get(4)?,
                page_count: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                last_opened_at: row.get(8)?,
                last_page: row.get(9)?,
                last_zoom: row.get(10)?,
                parse_status: row.get(11)?,
                has_native_toc: row.get(12)?,
                document_type: row.get(13)?,
                author: row.get(14)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<_>>()
        .map_err(|e| e.to_string())?;

    Ok(docs)
}

#[tauri::command]
pub fn get_document(db: State<DbState>, document_id: String) -> Result<Option<Document>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, title, original_filename, file_path, file_sha256, page_count,
                    created_at, updated_at, last_opened_at, last_page, last_zoom,
                    parse_status, has_native_toc, document_type, author
             FROM documents WHERE id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let mut rows = stmt
        .query_map(rusqlite::params![document_id], |row| {
            Ok(Document {
                id: row.get(0)?,
                title: row.get(1)?,
                original_filename: row.get(2)?,
                file_path: row.get(3)?,
                file_sha256: row.get(4)?,
                page_count: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                last_opened_at: row.get(8)?,
                last_page: row.get(9)?,
                last_zoom: row.get(10)?,
                parse_status: row.get(11)?,
                has_native_toc: row.get(12)?,
                document_type: row.get(13)?,
                author: row.get(14)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.next().transpose().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_document_bytes(db: State<DbState>, document_id: String) -> Result<Response, String> {
    let (file_path, access_bookmark): (String, Option<Vec<u8>>) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT file_path, access_bookmark FROM documents WHERE id = ?1",
            rusqlite::params![document_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => "Document not found".to_string(),
            _ => e.to_string(),
        })?
    };

    crate::file_access::with_access(&file_path, access_bookmark.as_deref(), || {
        validate_document_size(&file_path)
    })?;
    crate::file_access::read(&file_path, access_bookmark.as_deref()).map(binary_response)
}

#[tauri::command]
pub fn mark_document_opened(db: State<DbState>, document_id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE documents SET last_opened_at = ?1, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, document_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_last_page(
    db: State<DbState>,
    document_id: String,
    page_number: i64,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE documents SET last_page = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![page_number, now, document_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_last_zoom(db: State<DbState>, document_id: String, zoom: f64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE documents SET last_zoom = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![zoom, now, document_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_page_count(
    db: State<DbState>,
    document_id: String,
    page_count: i64,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE documents SET page_count = ?1 WHERE id = ?2",
        rusqlite::params![page_count, document_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn refresh_document_metadata(
    db: State<DbState>,
    document_id: String,
) -> Result<Document, String> {
    let (file_path, access_bookmark, document_type): (String, Option<Vec<u8>>, String) = {
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
    if document_type != "pdf" {
        return Err("Metadata refresh only supports PDF documents.".into());
    }
    let (meta_title, meta_author) =
        crate::file_access::with_access(&file_path, access_bookmark.as_deref(), || {
            Ok(crate::pdf::extract_metadata(&file_path))
        })?;

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    if meta_title.is_some() || meta_author.is_some() {
        conn.execute(
            "UPDATE documents SET title = COALESCE(NULLIF(?1, ''), title), author = COALESCE(NULLIF(?2, ''), author) WHERE id = ?3",
            rusqlite::params![meta_title, meta_author, document_id],
        )
        .map_err(|e| e.to_string())?;
    }

    // Return the updated document
    let mut stmt = conn
        .prepare(
            "SELECT id, title, original_filename, file_path, file_sha256, page_count,
                    created_at, updated_at, last_opened_at, last_page, last_zoom,
                    parse_status, has_native_toc, document_type, author
             FROM documents WHERE id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let doc = stmt
        .query_row(rusqlite::params![document_id], |row| {
            Ok(Document {
                id: row.get(0)?,
                title: row.get(1)?,
                original_filename: row.get(2)?,
                file_path: row.get(3)?,
                file_sha256: row.get(4)?,
                page_count: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                last_opened_at: row.get(8)?,
                last_page: row.get(9)?,
                last_zoom: row.get(10)?,
                parse_status: row.get(11)?,
                has_native_toc: row.get(12)?,
                document_type: row.get(13)?,
                author: row.get(14)?,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(doc)
}

#[tauri::command]
pub fn delete_document(db: State<DbState>, document_id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    hide_document_for_conn(&conn, &document_id)
}

fn hide_document_for_conn(conn: &rusqlite::Connection, document_id: &str) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE documents SET removed_at = ?1, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, document_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_collections(db: State<DbState>) -> Result<Vec<Collection>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, created_at, updated_at FROM collections ORDER BY name COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;

    let collections = stmt
        .query_map([], |row| {
            Ok(Collection {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<_>>()
        .map_err(|e| e.to_string())?;

    Ok(collections)
}

#[tauri::command]
pub fn create_collection(db: State<DbState>, name: String) -> Result<Collection, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Collection name cannot be empty.".into());
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO collections (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![id, name, now, now],
    )
    .map_err(|e| {
        if matches!(e, rusqlite::Error::SqliteFailure(ref err, _) if err.code == rusqlite::ErrorCode::ConstraintViolation)
        {
            "Collection name already exists.".to_string()
        } else {
            e.to_string()
        }
    })?;

    Ok(Collection {
        id,
        name: name.to_string(),
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn get_collection_memberships(db: State<DbState>) -> Result<Vec<DocumentCollection>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT document_id, collection_id FROM document_collections")
        .map_err(|e| e.to_string())?;
    let memberships = stmt
        .query_map([], |row| {
            Ok(DocumentCollection {
                document_id: row.get(0)?,
                collection_id: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<_>>()
        .map_err(|e| e.to_string())?;

    Ok(memberships)
}

#[tauri::command]
pub fn add_document_to_collection(
    db: State<DbState>,
    document_id: String,
    collection_id: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO document_collections (document_id, collection_id) VALUES (?1, ?2)",
        rusqlite::params![document_id, collection_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn remove_document_from_collection(
    db: State<DbState>,
    document_id: String,
    collection_id: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM document_collections WHERE document_id = ?1 AND collection_id = ?2",
        rusqlite::params![document_id, collection_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn_with_documents() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE documents (
                id TEXT PRIMARY KEY,
                title TEXT,
                original_filename TEXT NOT NULL,
                file_path TEXT NOT NULL,
                file_sha256 TEXT,
                page_count INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_opened_at TEXT,
                last_page INTEGER DEFAULT 1,
                last_zoom REAL DEFAULT 1.0,
                parse_status TEXT DEFAULT 'pending',
                has_native_toc INTEGER DEFAULT 0,
                document_type TEXT DEFAULT 'pdf',
                author TEXT,
                removed_at TEXT
            );
            CREATE TABLE annotations (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                page_number INTEGER NOT NULL,
                type TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
            );
            ",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO documents (id, title, original_filename, file_path, created_at, updated_at, last_opened_at, document_type)
             VALUES ('doc1', 'Book', 'book.pdf', '/tmp/book.pdf', 'now', 'now', 'now', 'pdf')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO annotations (id, document_id, page_number, type, created_at, updated_at)
             VALUES ('note1', 'doc1', 1, 'note', 'now', 'now')",
            [],
        )
        .unwrap();
        conn
    }

    #[test]
    fn hiding_document_removes_it_from_library_without_deleting_notes() {
        let conn = conn_with_documents();

        hide_document_for_conn(&conn, "doc1").unwrap();

        assert!(get_documents_for_conn(&conn).unwrap().is_empty());
        let notes: i64 = conn
            .query_row("SELECT COUNT(*) FROM annotations", [], |row| row.get(0))
            .unwrap();
        assert_eq!(notes, 1);
    }

    #[test]
    fn rejects_oversized_documents() {
        assert!(validate_document_size_value(MAX_DOCUMENT_BYTES).is_ok());
        assert!(validate_document_size_value(MAX_DOCUMENT_BYTES + 1).is_err());
        assert!(validate_document_size(std::env::temp_dir().to_str().unwrap()).is_err());
    }

    #[test]
    fn returns_document_bytes_without_json_encoding() {
        use tauri::ipc::{InvokeResponseBody, IpcResponse};

        let bytes = vec![0, 1, 127, 128, 255];
        match binary_response(bytes.clone()).body().unwrap() {
            InvokeResponseBody::Raw(body) => assert_eq!(body, bytes),
            InvokeResponseBody::Json(_) => panic!("document bytes were JSON encoded"),
        }
    }
}

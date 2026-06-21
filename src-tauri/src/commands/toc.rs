use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;
use chrono::Utc;

use super::settings::DbState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TocNodeInput {
    pub parent_id: Option<String>,
    pub title: String,
    pub level: i64,
    pub order_index: i64,
    pub start_page: i64,
    pub end_page: Option<i64>,
    /// Temporary client-side ID like "toc_1". The backend maps this to UUIDs.
    pub temp_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TocNode {
    pub id: String,
    pub document_id: String,
    pub parent_id: Option<String>,
    pub title: String,
    pub level: i64,
    pub order_index: i64,
    pub start_page: i64,
    pub end_page: Option<i64>,
    pub source: String,
    pub confidence: f64,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn save_toc_nodes(
    db: State<DbState>,
    document_id: String,
    nodes: Vec<TocNodeInput>,
) -> Result<Vec<TocNode>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();

    // Delete existing native TOC nodes for this document
    conn.execute(
        "DELETE FROM toc_nodes WHERE document_id = ?1 AND source = 'native_outline'",
        rusqlite::params![document_id],
    )
    .map_err(|e| e.to_string())?;

    // Two-pass insert: first generate UUIDs and build temp_id→UUID map,
    // then insert with resolved parent references to avoid FK violations.
    let mut id_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut enriched: Vec<(String, TocNodeInput)> = Vec::new();

    for node in &nodes {
        let uuid = Uuid::new_v4().to_string();
        if let Some(ref tid) = node.temp_id {
            id_map.insert(tid.clone(), uuid.clone());
        }
        enriched.push((uuid, node.clone()));
    }

    let mut saved = Vec::new();
    for (uuid, node) in &enriched {
        // Resolve parent_id: if it looks like a temp ID, map to UUID
        let resolved_parent = node.parent_id.as_ref().and_then(|pid| {
            if pid.starts_with("toc_") { id_map.get(pid).cloned() } else { Some(pid.clone()) }
        });

        conn.execute(
            "INSERT INTO toc_nodes (id, document_id, parent_id, title, level, order_index, start_page, end_page, source, confidence, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'native_outline', 1.0, ?9, ?10)",
            rusqlite::params![uuid, document_id, resolved_parent, node.title, node.level,
                node.order_index, node.start_page, node.end_page, now, now],
        )
        .map_err(|e| e.to_string())?;

        saved.push(TocNode {
            id: uuid.clone(),
            document_id: document_id.clone(),
            parent_id: resolved_parent,
            title: node.title.clone(),
            level: node.level,
            order_index: node.order_index,
            start_page: node.start_page,
            end_page: node.end_page,
            source: "native_outline".into(),
            confidence: 1.0,
            created_at: now.clone(),
            updated_at: now.clone(),
        });
    }

    // Update document has_native_toc flag
    conn.execute(
        "UPDATE documents SET has_native_toc = ?1 WHERE id = ?2",
        rusqlite::params![if !saved.is_empty() { 1 } else { 0 }, document_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(saved)
}

#[tauri::command]
pub fn get_toc_tree(
    db: State<DbState>,
    document_id: String,
) -> Result<Vec<TocNode>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, document_id, parent_id, title, level, order_index, start_page, end_page,
                    source, confidence, created_at, updated_at
             FROM toc_nodes WHERE document_id = ?1
             ORDER BY order_index",
        )
        .map_err(|e| e.to_string())?;

    let nodes = stmt
        .query_map(rusqlite::params![document_id], |row| {
            Ok(TocNode {
                id: row.get(0)?,
                document_id: row.get(1)?,
                parent_id: row.get(2)?,
                title: row.get(3)?,
                level: row.get(4)?,
                order_index: row.get(5)?,
                start_page: row.get(6)?,
                end_page: row.get(7)?,
                source: row.get(8)?,
                confidence: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(nodes)
}

#[tauri::command]
pub fn get_toc_node_for_page(
    db: State<DbState>,
    document_id: String,
    page_number: i64,
) -> Result<Option<TocNode>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, document_id, parent_id, title, level, order_index, start_page, end_page,
                    source, confidence, created_at, updated_at
             FROM toc_nodes
             WHERE document_id = ?1 AND start_page <= ?2 AND (?3 <= end_page OR end_page IS NULL)
             ORDER BY level DESC, start_page ASC
             LIMIT 1",
        )
        .map_err(|e| e.to_string())?;

    let mut rows = stmt
        .query_map(rusqlite::params![document_id, page_number, page_number], |row| {
            Ok(TocNode {
                id: row.get(0)?,
                document_id: row.get(1)?,
                parent_id: row.get(2)?,
                title: row.get(3)?,
                level: row.get(4)?,
                order_index: row.get(5)?,
                start_page: row.get(6)?,
                end_page: row.get(7)?,
                source: row.get(8)?,
                confidence: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.next().and_then(|r| r.ok()))
}

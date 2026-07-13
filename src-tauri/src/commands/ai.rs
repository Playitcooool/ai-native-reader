use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashSet};
use std::sync::Mutex;
use tauri::Emitter;
use tauri::State;
use uuid::Uuid;

use crate::ai::context_builder::{self, ContextPack};
use crate::ai::provider::{self, ChatMessage};
use crate::commands::settings::DbState;

pub struct AiCancelState(pub Mutex<HashSet<String>>);

// ---------------------------------------------------------------------------
// Session commands
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AiSession {
    pub id: String,
    pub document_id: String,
    pub title: Option<String>,
    pub scope_type: String,
    pub scope_json: String,
    pub session_summary: Option<String>,
    pub last_compacted_message_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AiSessionListItem {
    pub id: String,
    pub document_id: String,
    pub title: Option<String>,
    pub scope_type: String,
    pub scope_json: String,
    pub created_at: String,
    pub updated_at: String,
    pub message_count: i64,
    pub last_message_preview: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearAiHistoryResult {
    pub deleted_sessions: i64,
    pub deleted_messages: i64,
    pub deleted_memories: i64,
}

fn list_ai_sessions_for_conn(
    conn: &rusqlite::Connection,
    document_id: &str,
    limit: i64,
) -> Result<Vec<AiSessionListItem>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.document_id, s.title, s.scope_type, s.scope_json, s.created_at, s.updated_at,
                    COUNT(m.id) AS message_count,
                    (
                        SELECT lm.content
                        FROM ai_messages lm
                        WHERE lm.session_id = s.id
                        ORDER BY lm.created_at DESC, lm.rowid DESC
                        LIMIT 1
                    ) AS last_message_preview
             FROM ai_sessions s
             JOIN ai_messages m ON m.session_id = s.id
             WHERE s.document_id = ?1
             GROUP BY s.id
             HAVING message_count > 0
             ORDER BY s.updated_at DESC, s.rowid DESC
             LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;

    let sessions = stmt
        .query_map(rusqlite::params![document_id, limit.max(1)], |row| {
            let preview = row
                .get::<_, Option<String>>(8)?
                .map(|s| s.chars().take(120).collect());
            Ok(AiSessionListItem {
                id: row.get(0)?,
                document_id: row.get(1)?,
                title: row.get(2)?,
                scope_type: row.get(3)?,
                scope_json: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                message_count: row.get(7)?,
                last_message_preview: preview,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(sessions)
}

#[tauri::command]
pub fn list_ai_sessions(
    db: State<DbState>,
    document_id: String,
    limit: Option<i64>,
) -> Result<Vec<AiSessionListItem>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    list_ai_sessions_for_conn(&conn, &document_id, limit.unwrap_or(25))
}

fn clear_ai_history_for_conn(
    conn: &mut rusqlite::Connection,
) -> Result<ClearAiHistoryResult, String> {
    let deleted_sessions: i64 = conn
        .query_row("SELECT COUNT(*) FROM ai_sessions", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let deleted_messages: i64 = conn
        .query_row("SELECT COUNT(*) FROM ai_messages", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let deleted_memories: i64 = conn
        .query_row("SELECT COUNT(*) FROM learning_memories", [], |row| {
            row.get(0)
        })
        .unwrap_or(0);

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM ai_answer_citations", []).ok();
    tx.execute("DELETE FROM ai_messages", [])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM ai_sessions", [])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM learning_memories", []).ok();
    tx.commit().map_err(|e| e.to_string())?;

    Ok(ClearAiHistoryResult {
        deleted_sessions,
        deleted_messages,
        deleted_memories,
    })
}

#[tauri::command]
pub fn clear_ai_history(db: State<DbState>) -> Result<ClearAiHistoryResult, String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    clear_ai_history_for_conn(&mut conn)
}

fn get_session_messages_for_conn(
    conn: &rusqlite::Connection,
    session_id: &str,
    limit: i64,
) -> Result<Vec<serde_json::Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, role, content, citations_json, context_snapshot_json, page_number, selection_anchor_json, is_compacted, created_at
             FROM ai_messages WHERE session_id = ?1
             ORDER BY created_at ASC, rowid ASC LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;

    let messages = stmt
        .query_map(rusqlite::params![session_id, limit.max(1)], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "session_id": row.get::<_, String>(1)?,
                "role": row.get::<_, String>(2)?,
                "content": row.get::<_, String>(3)?,
                "citations_json": row.get::<_, Option<String>>(4)?,
                "context_snapshot_json": row.get::<_, Option<String>>(5)?,
                "page_number": row.get::<_, Option<i64>>(6)?,
                "selection_anchor_json": row.get::<_, Option<String>>(7)?,
                "is_compacted": row.get::<_, bool>(8)?,
                "created_at": row.get::<_, String>(9)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(messages)
}

fn extract_citation_pages(text: &str, max_page: Option<i64>) -> Vec<i64> {
    let bytes = text.as_bytes();
    let mut pages = BTreeSet::new();
    let mut i = 0;
    while i + 2 < bytes.len() {
        if bytes[i] != b'[' || !bytes[i + 1].eq_ignore_ascii_case(&b'p') {
            i += 1;
            continue;
        }
        let mut j = i + 2;
        if j < bytes.len() && bytes[j] == b'.' {
            j += 1;
        }
        while j < bytes.len() && bytes[j].is_ascii_whitespace() {
            j += 1;
        }
        let start = j;
        while j < bytes.len() && bytes[j].is_ascii_digit() {
            j += 1;
        }
        if start < j && j < bytes.len() && bytes[j] == b']' {
            if let Ok(page) = text[start..j].parse::<i64>() {
                if page >= 1 && max_page.is_none_or(|max| page <= max) {
                    pages.insert(page);
                }
            }
            i = j + 1;
        } else {
            i += 1;
        }
    }
    pages.into_iter().collect()
}

fn quote_for_citation(
    conn: &rusqlite::Connection,
    document_id: &str,
    page_number: i64,
) -> Option<String> {
    let text: String = conn
        .query_row(
            "SELECT text FROM pages
             WHERE document_id = ?1 AND page_number = ?2 AND text_status = 'ready' AND char_count > 0",
            rusqlite::params![document_id, page_number],
            |row| row.get(0),
        )
        .ok()?;
    Some(text.chars().take(240).collect())
}

fn save_citations_for_message(
    conn: &rusqlite::Connection,
    message_id: &str,
    document_id: &str,
    content: &str,
    now: &str,
) -> Result<(), String> {
    let page_count: Option<i64> = conn
        .query_row(
            "SELECT page_count FROM documents WHERE id = ?1",
            rusqlite::params![document_id],
            |row| row.get(0),
        )
        .ok()
        .flatten();

    for page_number in extract_citation_pages(content, page_count) {
        let Some(quote) = quote_for_citation(conn, document_id, page_number) else {
            continue;
        };
        let toc_node_id: Option<String> = conn
            .query_row(
                "SELECT id FROM toc_nodes
                 WHERE document_id = ?1 AND start_page <= ?2 AND (end_page IS NULL OR end_page >= ?2)
                 ORDER BY level DESC, start_page DESC
                 LIMIT 1",
                rusqlite::params![document_id, page_number],
                |row| row.get(0),
            )
            .ok();
        conn.execute(
            "INSERT INTO ai_answer_citations (id, message_id, document_id, page_number, toc_node_id, quote, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                Uuid::new_v4().to_string(),
                message_id,
                document_id,
                page_number,
                toc_node_id,
                quote,
                now
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_session_messages(
    db: State<DbState>,
    session_id: String,
    limit: Option<i64>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    get_session_messages_for_conn(&conn, &session_id, limit.unwrap_or(50))
}

// ---------------------------------------------------------------------------
// Compaction
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn compact_session(
    http_client: State<'_, reqwest::Client>,
    db: State<'_, DbState>,
    session_id: String,
) -> Result<AiSession, String> {
    let (_document_id, old_messages) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;

        // Get document_id
        let doc_id: String = conn
            .query_row(
                "SELECT document_id FROM ai_sessions WHERE id = ?1",
                rusqlite::params![session_id],
                |row| row.get(0),
            )
            .map_err(|_| "Session not found".to_string())?;

        // Get compactable messages (older, not already compacted)
        let mut stmt = conn
            .prepare(
                "SELECT role, content FROM ai_messages
                 WHERE session_id = ?1 AND is_compacted = 0
                 ORDER BY created_at ASC",
            )
            .map_err(|e| e.to_string())?;

        let msgs: Vec<(String, String)> = stmt
            .query_map(rusqlite::params![session_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<rusqlite::Result<_>>()
            .map_err(|e| e.to_string())?;

        (doc_id, msgs)
    };

    // Build compaction prompt
    let summary_prompt = old_messages
        .iter()
        .map(|(role, content)| format!("[{}]\n{}", role, content))
        .collect::<Vec<_>>()
        .join("\n\n");

    let compact_prompt = format!(
        "Summarize the following PDF reading session conversation. Include:\n\
         - What section/page the user was reading\n\
         - Important explanations already given\n\
         - Unresolved questions\n\
         - Concepts the user struggled with\n\
         - Saved notes or citations that matter\n\n\
         Conversation:\n{}",
        summary_prompt
    );

    // Get provider settings for compaction
    let (provider_id, provider_type, base_url, api_key, model) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, provider_type, base_url, api_key, model FROM provider_settings WHERE is_default = 1 LIMIT 1",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        match rows.next() {
            Some(Ok(r)) => r,
            _ => return Err("No default provider configured".to_string()),
        }
    };

    let base_url = base_url.ok_or("Missing base_url")?;
    let api_key = crate::secrets::provider_api_key(&provider_id, api_key)?;
    let api_key = match api_key {
        Some(key) => key,
        None if crate::ai::provider::provider_requires_api_key(&provider_type) => {
            return Err("Missing api_key".into())
        }
        None => String::new(),
    };

    // Call AI for compaction
    let result = provider::chat_completion(
        &http_client,
        &provider_type,
        &base_url,
        &api_key,
        &model,
        vec![ChatMessage {
            role: "user".into(),
            content: compact_prompt,
        }],
        Some(0.3),
        Some(1000),
    )
    .await;

    let summary = match result {
        Ok(resp) => resp
            .choices
            .first()
            .map(|c| c.message.content.clone())
            .unwrap_or_default(),
        Err(e) => return Err(format!("Compaction failed: {}", e)),
    };

    if summary.is_empty() {
        return Err("Compaction produced empty summary".to_string());
    }

    // Save compaction atomically
    let now = Utc::now().to_rfc3339();
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE ai_sessions SET session_summary = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![summary.trim(), now, session_id],
    )
    .map_err(|e| e.to_string())?;

    // Mark all old messages as compacted (keep them, just mark them)
    conn.execute(
        "UPDATE ai_messages SET is_compacted = 1 WHERE session_id = ?1 AND is_compacted = 0",
        rusqlite::params![session_id],
    )
    .map_err(|e| e.to_string())?;

    // Return updated session
    let mut stmt = conn
        .prepare(
            "SELECT id, document_id, title, scope_type, scope_json, session_summary, last_compacted_message_id, created_at, updated_at
             FROM ai_sessions WHERE id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let session = stmt
        .query_row(rusqlite::params![session_id], |row| {
            Ok(AiSession {
                id: row.get(0)?,
                document_id: row.get(1)?,
                title: row.get(2)?,
                scope_type: row.get(3)?,
                scope_json: row.get(4)?,
                session_summary: row.get(5)?,
                last_compacted_message_id: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(session)
}

// ---------------------------------------------------------------------------
// Reading State
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReadingState {
    pub document_id: String,
    pub current_page_number: i64,
    pub current_toc_node_id: Option<String>,
    pub progress_ratio: Option<f64>,
    pub recent_pages_json: Option<String>,
    pub last_selection_anchor_json: Option<String>,
    pub last_opened_at: Option<String>,
    pub updated_at: String,
}

#[tauri::command]
pub fn get_reading_state(
    db: State<DbState>,
    document_id: String,
) -> Result<Option<ReadingState>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT document_id, current_page_number, current_toc_node_id, progress_ratio,
                    recent_pages_json, last_selection_anchor_json, last_opened_at, updated_at
             FROM reading_states WHERE document_id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let mut rows = stmt
        .query_map(rusqlite::params![document_id], |row| {
            Ok(ReadingState {
                document_id: row.get(0)?,
                current_page_number: row.get(1)?,
                current_toc_node_id: row.get(2)?,
                progress_ratio: row.get(3)?,
                recent_pages_json: row.get(4)?,
                last_selection_anchor_json: row.get(5)?,
                last_opened_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.next().transpose().map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_citations_for_message(
    db: State<DbState>,
    message_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, message_id, document_id, page_number, toc_node_id, quote, anchor_json
             FROM ai_answer_citations WHERE message_id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let citations = stmt
        .query_map(rusqlite::params![message_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "message_id": row.get::<_, String>(1)?,
                "document_id": row.get::<_, String>(2)?,
                "page_number": row.get::<_, i64>(3)?,
                "toc_node_id": row.get::<_, Option<String>>(4)?,
                "quote": row.get::<_, Option<String>>(5)?,
                "anchor_json": row.get::<_, Option<String>>(6)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<_>>()
        .map_err(|e| e.to_string())?;

    Ok(citations)
}

// ---------------------------------------------------------------------------
// AI Workflow: generic runner for all modes
// ---------------------------------------------------------------------------

/// Input accepted by run_ai_workflow.
/// All modes use the same input shape; the handler picks the relevant fields.
#[derive(Debug, Deserialize)]
pub struct RunAiWorkflowInput {
    pub document_id: String,
    pub document_title: Option<String>,
    /// One of: selection_explain | page_summary | range_summary | chapter_qa | range_qa | pages_qa
    pub mode: String,
    pub page_number: i64,
    pub selected_text: Option<String>,
    pub start_page: Option<i64>,
    pub end_page: Option<i64>,
    pub page_numbers: Option<Vec<i64>>,
    pub question: Option<String>,
    /// If provided, reuse/save to this session; if empty, a new session is created.
    pub existing_session_id: Option<String>,
    /// Optional TOC node ID for toc_index_qa mode.
    pub toc_node_id: Option<String>,
}

#[tauri::command]
pub fn cancel_ai_workflow(
    cancel_state: State<AiCancelState>,
    document_id: String,
) -> Result<(), String> {
    cancel_state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(document_id);
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct AiWorkflowResult {
    pub message_id: String,
    pub session_id: String,
    pub answer_md: String,
    pub context_snapshot: ContextPack,
}

#[tauri::command]
pub async fn run_ai_workflow(
    app: tauri::AppHandle,
    http_client: State<'_, reqwest::Client>,
    db: State<'_, DbState>,
    cancel_state: State<'_, AiCancelState>,
    input: RunAiWorkflowInput,
) -> Result<AiWorkflowResult, String> {
    cancel_state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&input.document_id);

    // 1. Resolve session
    let scope_type = &input.mode;
    let (scope_json, session_id) = {
        let sid = input
            .existing_session_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let scope = format!("{{\"scopeType\":\"{}\"}}", input.mode);
        (scope, sid)
    };

    // 2. Build context & read provider settings (single DB lock)
    app.emit(
        "ai-phase-change",
        serde_json::json!({"phase": "building_context"}),
    )
    .ok();
    let title = input.document_title.as_deref().unwrap_or("Untitled");

    let context_pack;
    let (section_start, section_end);
    let (provider_type, base_url, api_key, model);
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        context_pack = context_builder::build_context_pack_for_mode(
            &conn,
            &input.document_id,
            title,
            &input.mode,
            input.page_number,
            input.selected_text.as_deref(),
            input.start_page,
            input.end_page,
            input.page_numbers.as_deref(),
            input.question.as_deref(),
            Some(&session_id),
            input.toc_node_id.as_deref(),
        );

        // Read provider settings
        let provider_row = {
            let mut stmt = conn
                .prepare(
                    "SELECT id, provider_type, base_url, api_key, model FROM provider_settings WHERE is_default = 1 LIMIT 1",
                )
                .map_err(|e| e.to_string())?;
            let mut rows = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                })
                .map_err(|e| e.to_string())?;
            match rows.next() {
                Some(Ok(r)) => r,
                _ => {
                    return Err(
                        "No default provider configured. Open Settings to add one.".to_string()
                    )
                }
            }
        };
        let (provider_id, pt, bu, ak, m) = provider_row;
        let base_url_val = bu.ok_or("Missing base_url")?;
        let ak = crate::secrets::provider_api_key(&provider_id, ak)?;
        let api_key_val = match ak {
            Some(key) => key,
            None if crate::ai::provider::provider_requires_api_key(&pt) => {
                return Err("Missing api_key".into())
            }
            None => String::new(),
        };
        provider_type = pt;
        base_url = base_url_val;
        api_key = api_key_val;
        model = m;

        section_start = if input.mode == "chapter_qa" {
            if let Some(start) = input.start_page {
                start
            } else if let Some(ref nid) = input.toc_node_id {
                conn.query_row(
                    "SELECT start_page FROM toc_nodes WHERE id = ?1",
                    rusqlite::params![nid],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap_or(input.page_number)
            } else {
                input.page_number
            }
        } else {
            1
        };
        section_end = if input.mode == "chapter_qa" {
            if let Some(end) = input.end_page {
                end
            } else if let Some(ref nid) = input.toc_node_id {
                conn.query_row(
                    "SELECT COALESCE(end_page, start_page) FROM toc_nodes WHERE id = ?1",
                    rusqlite::params![nid],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap_or(input.page_number)
            } else {
                input.page_number
            }
        } else {
            1
        };
    } // DB lock released here

    // 3. Build prompt messages
    let mut evidence_text = context_pack
        .hard_evidence
        .iter()
        .map(|item| item.text.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    if !context_pack.warnings.is_empty() {
        evidence_text = format!(
            "[Context warnings]\n- {}\n\n{}",
            context_pack.warnings.join("\n- "),
            evidence_text
        );
    }

    let has_pdf_text = context_pack.hard_evidence.iter().any(|item| {
        matches!(
            item.kind.as_str(),
            "page_text" | "range_text" | "page_set_text" | "selected_text"
        )
    });
    if !has_pdf_text {
        return Err("No readable text is available for this request yet. OCR may still be running; try again after it finishes.".into());
    }

    let toc_path = context_pack
        .hard_evidence
        .iter()
        .find(|item| item.kind == "toc_breadcrumb")
        .map(|item| item.text.trim_start_matches("Section: "))
        .unwrap_or("");

    let memory_text = context_pack
        .soft_memory
        .iter()
        .map(|item| item.text.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");

    let (system_prompt, user_prompt) = match input.mode.as_str() {
        "selection_explain" => {
            let sel = input.selected_text.as_deref().unwrap_or("");
            crate::ai::prompts::explain_selection(
                title,
                input.page_number,
                toc_path,
                sel,
                &evidence_text,
            )
        }
        "page_summary" => {
            crate::ai::prompts::summarize_page(title, input.page_number, toc_path, &evidence_text)
        }
        "range_summary" => {
            let sp = input.start_page.unwrap_or(input.page_number);
            let ep = input.end_page.unwrap_or(input.page_number);
            crate::ai::prompts::summarize_range(title, sp, ep, toc_path, &evidence_text)
        }
        "chapter_qa" => {
            let q = input.question.as_deref().unwrap_or("");
            crate::ai::prompts::ask_current_section(
                title,
                input.page_number,
                toc_path,
                section_start,
                section_end,
                q,
                &evidence_text,
            )
        }
        "range_qa" => {
            let q = input.question.as_deref().unwrap_or("");
            let sp = input.start_page.unwrap_or(input.page_number);
            let ep = input.end_page.unwrap_or(input.page_number);
            crate::ai::prompts::ask_page_range(title, sp, ep, q, &evidence_text)
        }
        "pages_qa" => {
            let q = input.question.as_deref().unwrap_or("");
            let pages = input
                .page_numbers
                .clone()
                .unwrap_or_else(|| vec![input.page_number]);
            crate::ai::prompts::ask_pages(title, &pages, q, &evidence_text)
        }
        "toc_index_qa" => {
            let toc_index = context_pack
                .hard_evidence
                .iter()
                .find(|item| item.kind == "full_toc_index")
                .map(|item| item.text.as_str())
                .unwrap_or("");
            let q = input
                .question
                .as_deref()
                .unwrap_or("Summarize this section");
            crate::ai::prompts::toc_index_qa(title, toc_index, q, &evidence_text)
        }
        _ => return Err(format!("Unknown mode: {}", input.mode)),
    };

    let mut messages = vec![ChatMessage {
        role: "system".into(),
        content: system_prompt,
    }];

    // Add memory context
    if !memory_text.is_empty() {
        messages.push(ChatMessage {
            role: "user".into(),
            content: format!("[Previous context]\n{}", memory_text),
        });
        messages.push(ChatMessage {
            role: "assistant".into(),
            content: "Understood. I'll consider this context in my response.".into(),
        });
    }

    messages.push(ChatMessage {
        role: "user".into(),
        content: user_prompt,
    });

    // 4. Call AI provider with streaming
    app.emit(
        "ai-phase-change",
        serde_json::json!({"phase": "calling_ai"}),
    )
    .ok();
    let answer = provider::chat_completion_stream(
        &http_client,
        &provider_type,
        &base_url,
        &api_key,
        &model,
        messages,
        Some(0.3),
        Some(4096),
        |token| {
            app.emit("ai-stream-chunk", serde_json::json!({"token": token}))
                .ok();
        },
        || {
            cancel_state
                .0
                .lock()
                .map(|set| set.contains(&input.document_id))
                .unwrap_or(true)
        },
    )
    .await
    .map_err(|e| format!("AI request failed: {}", e))?;

    if cancel_state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&input.document_id)
    {
        app.emit("ai-phase-change", serde_json::json!({"phase": "cancelled"}))
            .ok();
        return Err("cancelled".to_string());
    }

    if answer.is_empty() {
        return Err("AI returned empty response".to_string());
    }

    // 6. Save messages
    let now = Utc::now().to_rfc3339();
    let user_msg_id = Uuid::new_v4().to_string();
    let assistant_msg_id = Uuid::new_v4().to_string();
    let context_json = serde_json::to_string(&context_pack).unwrap_or_default();

    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;

        // Ensure session exists
        conn.execute(
            "INSERT OR IGNORE INTO ai_sessions (id, document_id, scope_type, scope_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![session_id, input.document_id, scope_type, scope_json, now, now],
        )
        .map_err(|e| e.to_string())?;

        // Save user message
        let user_content: String = input
            .selected_text
            .clone()
            .or(input.question.clone())
            .unwrap_or_else(|| match input.mode.as_str() {
                "page_summary" => format!("Summarize page {}", input.page_number),
                "range_summary" => format!(
                    "Summarize pages {}–{}",
                    input.start_page.unwrap_or(input.page_number),
                    input.end_page.unwrap_or(input.page_number)
                ),
                "range_qa" => input.question.clone().unwrap_or_else(|| input.mode.clone()),
                _ => input.mode.clone(),
            });
        conn.execute(
            "INSERT INTO ai_messages (id, session_id, role, content, page_number, context_snapshot_json, created_at)
             VALUES (?1, ?2, 'user', ?3, ?4, ?5, ?6)",
            rusqlite::params![user_msg_id, session_id, user_content,
                input.page_number, context_json, now],
        )
        .map_err(|e| e.to_string())?;

        // Save assistant message
        conn.execute(
            "INSERT INTO ai_messages (id, session_id, role, content, page_number, context_snapshot_json, created_at)
             VALUES (?1, ?2, 'assistant', ?3, ?4, ?5, ?6)",
            rusqlite::params![assistant_msg_id, session_id, answer, input.page_number, context_json, now],
        )
        .map_err(|e| e.to_string())?;
        save_citations_for_message(&conn, &assistant_msg_id, &input.document_id, &answer, &now)?;

        // Update session timestamp
        conn.execute(
            "UPDATE ai_sessions SET updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, session_id],
        )
        .map_err(|e| e.to_string())?;
    }

    // 7. Signal streaming complete
    app.emit(
        "ai-stream-end",
        serde_json::json!({
            "message_id": assistant_msg_id,
            "session_id": session_id,
        }),
    )
    .ok();

    Ok(AiWorkflowResult {
        message_id: assistant_msg_id,
        session_id,
        answer_md: answer,
        context_snapshot: context_pack,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn_with_ai_tables() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE ai_sessions (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                title TEXT,
                scope_type TEXT NOT NULL,
                scope_json TEXT NOT NULL,
                session_summary TEXT,
                last_compacted_message_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE ai_messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                citations_json TEXT,
                context_snapshot_json TEXT,
                page_number INTEGER,
                selection_anchor_json TEXT,
                is_compacted INTEGER DEFAULT 0,
                created_at TEXT NOT NULL
            );
            CREATE TABLE documents (
                id TEXT PRIMARY KEY,
                page_count INTEGER
            );
            CREATE TABLE pages (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                page_number INTEGER NOT NULL,
                text TEXT,
                text_status TEXT DEFAULT 'pending',
                char_count INTEGER DEFAULT 0
            );
            CREATE TABLE toc_nodes (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                title TEXT NOT NULL,
                level INTEGER NOT NULL,
                start_page INTEGER NOT NULL,
                end_page INTEGER
            );
            CREATE TABLE ai_answer_citations (
                id TEXT PRIMARY KEY,
                message_id TEXT NOT NULL,
                document_id TEXT NOT NULL,
                page_number INTEGER NOT NULL,
                toc_node_id TEXT,
                quote TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE learning_memories (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                concept TEXT NOT NULL
            );
            ",
        )
        .unwrap();
        conn
    }

    #[test]
    fn clears_ai_history_and_cascaded_rows() {
        let mut conn = conn_with_ai_tables();
        conn.execute("PRAGMA foreign_keys=ON", []).unwrap();
        conn.execute(
            "INSERT INTO documents (id, page_count) VALUES ('doc', 1)",
            [],
        )
        .unwrap();
        insert_session(&conn, "s1", "doc", "2026-01-02T00:00:00Z");
        conn.execute(
            "INSERT INTO ai_messages (id, session_id, role, content, created_at)
             VALUES ('m1', 's1', 'assistant', 'answer', 'now')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO ai_answer_citations (id, message_id, document_id, page_number, created_at)
             VALUES ('c1', 'm1', 'doc', 1, 'now')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO learning_memories (id, document_id, concept) VALUES ('lm1', 'doc', 'x')",
            [],
        )
        .unwrap();

        let result = clear_ai_history_for_conn(&mut conn).unwrap();
        let sessions: i64 = conn
            .query_row("SELECT COUNT(*) FROM ai_sessions", [], |row| row.get(0))
            .unwrap();
        let messages: i64 = conn
            .query_row("SELECT COUNT(*) FROM ai_messages", [], |row| row.get(0))
            .unwrap();
        let citations: i64 = conn
            .query_row("SELECT COUNT(*) FROM ai_answer_citations", [], |row| {
                row.get(0)
            })
            .unwrap();
        let memories: i64 = conn
            .query_row("SELECT COUNT(*) FROM learning_memories", [], |row| {
                row.get(0)
            })
            .unwrap();

        assert_eq!(result.deleted_sessions, 1);
        assert_eq!(result.deleted_messages, 1);
        assert_eq!(result.deleted_memories, 1);
        assert_eq!(sessions + messages + citations + memories, 0);
    }

    #[test]
    fn saves_only_verified_citations_for_message() {
        let conn = conn_with_ai_tables();
        conn.execute(
            "INSERT INTO documents (id, page_count) VALUES ('doc', 3)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO pages (id, document_id, page_number, text, text_status, char_count)
             VALUES ('p1', 'doc', 1, 'source text page one', 'ready', 20),
                    ('p2', 'doc', 2, '', 'failed', 0)",
            [],
        )
        .unwrap();

        save_citations_for_message(
            &conn,
            "m1",
            "doc",
            "Use [p.1], [p.2], [p.9], and [p 1].",
            "now",
        )
        .unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM ai_answer_citations", [], |row| {
                row.get(0)
            })
            .unwrap();
        let (page, quote): (i64, String) = conn
            .query_row(
                "SELECT page_number, quote FROM ai_answer_citations",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();

        assert_eq!(count, 1);
        assert_eq!(page, 1);
        assert_eq!(quote, "source text page one");
    }

    fn insert_session(conn: &rusqlite::Connection, id: &str, doc: &str, updated: &str) {
        conn.execute(
            "INSERT INTO ai_sessions (id, document_id, scope_type, scope_json, created_at, updated_at)
             VALUES (?1, ?2, 'ask', '{}', '2026-01-01T00:00:00Z', ?3)",
            rusqlite::params![id, doc, updated],
        )
        .unwrap();
    }

    fn insert_message(
        conn: &rusqlite::Connection,
        id: &str,
        session: &str,
        role: &str,
        content: &str,
    ) {
        conn.execute(
            "INSERT INTO ai_messages (id, session_id, role, content, created_at)
             VALUES (?1, ?2, ?3, ?4, '2026-01-01T00:00:00Z')",
            rusqlite::params![id, session, role, content],
        )
        .unwrap();
    }

    #[test]
    fn lists_sessions_newest_first_for_document_and_skips_empty() {
        let conn = conn_with_ai_tables();
        insert_session(&conn, "old", "doc1", "2026-01-01T00:00:00Z");
        insert_session(&conn, "new", "doc1", "2026-01-02T00:00:00Z");
        insert_session(&conn, "empty", "doc1", "2026-01-03T00:00:00Z");
        insert_session(&conn, "other", "doc2", "2026-01-04T00:00:00Z");
        insert_message(&conn, "m1", "old", "user", "old question");
        insert_message(&conn, "m2", "new", "assistant", "new answer");
        insert_message(&conn, "m3", "other", "user", "other doc");

        let sessions = list_ai_sessions_for_conn(&conn, "doc1", 25).unwrap();
        let ids: Vec<_> = sessions.iter().map(|s| s.id.as_str()).collect();

        assert_eq!(ids, vec!["new", "old"]);
        assert_eq!(sessions[0].message_count, 1);
        assert_eq!(
            sessions[0].last_message_preview.as_deref(),
            Some("new answer")
        );
    }

    #[test]
    fn loaded_messages_include_session_id_and_keep_insert_order_for_tied_times() {
        let conn = conn_with_ai_tables();
        insert_session(&conn, "s1", "doc1", "2026-01-01T00:00:00Z");
        insert_message(&conn, "u1", "s1", "user", "question");
        insert_message(&conn, "a1", "s1", "assistant", "answer");

        let messages = get_session_messages_for_conn(&conn, "s1", 50).unwrap();

        assert_eq!(messages[0]["session_id"], "s1");
        assert_eq!(messages[0]["role"], "user");
        assert_eq!(messages[1]["role"], "assistant");
    }
}

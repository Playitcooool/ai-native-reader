use super::settings::DbState;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub fn record_reading_heartbeat(state: State<'_, DbState>, seconds: u64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    conn.execute(
        "INSERT INTO reading_sessions (id, duration_seconds, session_date) VALUES (?1, ?2, ?3)",
        rusqlite::params![id, seconds, today],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_reading_stats(state: State<'_, DbState>) -> Result<serde_json::Value, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let now = chrono::Utc::now();
    let today = now.format("%Y-%m-%d").to_string();

    // Monday of current week (ISO weekday: 1=Monday … 7=Sunday)
    let weekday = now.format("%u").to_string().parse::<i64>().unwrap_or(7);
    let days_from_monday = weekday - 1;
    let week_start = (now - chrono::Duration::days(days_from_monday))
        .format("%Y-%m-%d")
        .to_string();

    let today_seconds: i64 = conn.query_row(
        "SELECT COALESCE(SUM(duration_seconds), 0) FROM reading_sessions WHERE session_date = ?1",
        rusqlite::params![today],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;

    let week_seconds: i64 = conn.query_row(
        "SELECT COALESCE(SUM(duration_seconds), 0) FROM reading_sessions WHERE session_date >= ?1",
        rusqlite::params![week_start],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "today_seconds": today_seconds,
        "week_seconds": week_seconds,
    }))
}

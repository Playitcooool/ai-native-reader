use super::settings::DbState;
use tauri::State;

fn record_daily(conn: &rusqlite::Connection, seconds: u64, date: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO reading_sessions (id, duration_seconds, session_date) VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET duration_seconds = duration_seconds + excluded.duration_seconds",
        rusqlite::params![format!("daily:{date}"), seconds, date],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn record_reading_heartbeat(state: State<'_, DbState>, seconds: u64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    record_daily(&conn, seconds, &today)
}

#[tauri::command]
pub fn get_reading_stats(state: State<'_, DbState>) -> Result<serde_json::Value, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let now = chrono::Local::now();
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aggregates_heartbeats_by_local_day() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE reading_sessions (id TEXT PRIMARY KEY, duration_seconds INTEGER NOT NULL, session_date TEXT NOT NULL);").unwrap();
        record_daily(&conn, 15, "2026-07-10").unwrap();
        record_daily(&conn, 30, "2026-07-10").unwrap();
        let row: (i64, i64) = conn
            .query_row(
                "SELECT COUNT(*), SUM(duration_seconds) FROM reading_sessions",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(row, (1, 45));
    }
}

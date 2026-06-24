# Reading Time Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show daily & weekly reading time totals on the home page.

**Architecture:** Frontend sends heartbeats every 15s while a document is open → new Rust commands store raw sessions in SQLite → home page queries aggregates.

**Tech Stack:** Rust (rusqlite, uuid), React/TypeScript, Zustand, SQLite

---

### Task 1: Database migration — `reading_sessions` table

**Files:**
- Modify: `src-tauri/src/db/migrations.rs`

- [ ] **Add migration table + index**

After the `provider_settings` table creation (last table), add:

```sql
CREATE TABLE IF NOT EXISTS reading_sessions (
    id TEXT PRIMARY KEY,
    duration_seconds INTEGER NOT NULL,
    session_date TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reading_sessions_date ON reading_sessions(session_date);
```

- [ ] **Commit**

```bash
git add src-tauri/src/db/migrations.rs
git commit -m "feat: add reading_sessions table for reading time tracking"
```

---

### Task 2: New `commands/stats.rs` — heartbeat + stats commands

**Files:**
- Create: `src-tauri/src/commands/stats.rs`

- [ ] **Create stats.rs with two Tauri commands**

```rust
use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;
use crate::commands::DbState;

#[tauri::command]
pub fn record_reading_heartbeat(state: State<'_, DbState>, seconds: u64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    conn.execute(
        "INSERT INTO reading_sessions (id, duration_seconds, session_date) VALUES (?1, ?2, ?3)",
        rusqlite::params![id, seconds, today],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_reading_stats(state: State<'_, DbState>) -> Result<serde_json::Value, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();

    // Monday of current week (ISO weekday 1=Monday)
    let weekday = chrono::Utc::now().format("%u").to_string().parse::<i64>().unwrap_or(7);
    let days_from_monday = weekday - 1;
    let week_start = (chrono::Utc::now() - chrono::Duration::days(days_from_monday))
        .format("%Y-%m-%d").to_string();

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
```

- [ ] **Commit**

```bash
git add src-tauri/src/commands/stats.rs
git commit -m "feat: add record_reading_heartbeat and get_reading_stats commands"
```

---

### Task 3: Register stats commands

**Files:**
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Add `pub mod stats` to commands/mod.rs**

```rust
pub mod stats;
```

- [ ] **Register commands in lib.rs**

Add `stats::record_reading_heartbeat` and `stats::get_reading_stats` to the `generate_handler![]` macro.

- [ ] **Commit**

```bash
git add src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat: register reading time commands"
```

---

### Task 4: Frontend — add heartbeat timer to documentStore

**Files:**
- Modify: `src/stores/documentStore.ts`

- [ ] **Add heartbeat interval + stats state**

Add to the `DocumentStore` interface:
```typescript
dailyStats: { todaySeconds: number; weekSeconds: number } | null;
heartbeatInterval: ReturnType<typeof setInterval> | null;
startHeartbeat: () => void;
stopHeartbeat: () => void;
loadReadingStats: () => Promise<void>;
```

Add to the store implementation:
```typescript
dailyStats: null,
heartbeatInterval: null,

startHeartbeat: () => {
  const { heartbeatInterval } = get();
  if (heartbeatInterval) return;

  const tick = () => {
    invoke("record_reading_heartbeat", { seconds: 15 });
  };

  const interval = setInterval(tick, 15000);

  // Pause/resume on visibility change
  const onVisibility = () => {
    if (document.hidden) {
      clearInterval(interval);
      get().heartbeatInterval = null;
    } else {
      get().startHeartbeat();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  set({ heartbeatInterval: interval, _onVisibility: onVisibility });
},

stopHeartbeat: () => {
  const { heartbeatInterval, _onVisibility } = get();
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  if (_onVisibility) document.removeEventListener("visibilitychange", _onVisibility as () => void);
  set({ heartbeatInterval: null, _onVisibility: null });
},

loadReadingStats: async () => {
  const stats = await invoke<{ today_seconds: number; week_seconds: number }>("get_reading_stats");
  set({ dailyStats: { todaySeconds: stats.today_seconds, weekSeconds: stats.week_seconds } });
},
```

Add `_onVisibility` to the interface as `unknown` (internal, not exported).

- [ ] **Wire heartbeat lifecycle in `setCurrentDocument`**

In `setCurrentDocument`, when a document is set (not null), call `get().startHeartbeat()`. When set to null, call `get().stopHeartbeat()`.

- [ ] **Commit**

```bash
git add src/stores/documentStore.ts
git commit -m "feat: add reading heartbeat timer and stats state"
```

---

### Task 5: Frontend — add stats bar to CenterViewer home page

**Files:**
- Modify: `src/components/CenterViewer.tsx`

- [ ] **Add formatTime helper + stats bar**

Add a helper function at the top of the component file:
```typescript
function formatTime(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  if (hours < 24) return remMin ? `${hours}h ${remMin}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}
```

In the home page return block (when no `currentDocument`), after the header section, add:
```tsx
{/* Reading stats */}
{dailyStats && (dailyStats.todaySeconds > 0 || dailyStats.weekSeconds > 0) && (
  <div className="reading-stats">
    <span>📖 Today: {formatTime(dailyStats.todaySeconds)}</span>
    <span className="reading-stats-sep">•</span>
    <span>Week: {formatTime(dailyStats.weekSeconds)}</span>
  </div>
)}
```

Add a `useEffect` to load reading stats on mount and call `loadReadingStats()`:
```tsx
useEffect(() => {
  loadReadingStats();
}, [loadReadingStats]);
```

- [ ] **Commit**

```bash
git add src/components/CenterViewer.tsx
git commit -m "feat: add reading time stats bar to home page"
```

---

### Task 6: CSS for stats bar

**Files:**
- Modify: `src/index.css`

- [ ] **Add `.reading-stats` styles**

```css
.reading-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  font-size: 0.9em;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border-color, rgba(128,128,128,0.2));
}
.reading-stats-sep {
  color: var(--border-color, rgba(128,128,128,0.3));
}
```

- [ ] **Commit**

```bash
git add src/index.css
git commit -m "style: add reading stats bar styles"
```

---

### Verification

1. `cd src-tauri && cargo build` — Rust side compiles clean
2. `npm run build` — frontend builds clean
3. `npm run tauri dev` — open a PDF, read for 30+ seconds, return to home page, verify stats show
4. Check that tab switch pauses timer (doesn't count background time)
5. Edge cases: first-ever open (bar hidden), cross-midnight, cross-week boundaries

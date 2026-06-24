# Reading Time Statistics — Daily & Weekly

## Problem

The home page shows a book grid but no feedback on how much the user is reading.
There's no record of reading time anywhere in the app.

## Goal

Show two numbers on the home page: today's total reading time and this week's
total. Tracked automatically while reading any document.

## Design

### Storage — new `reading_sessions` table

One row per heartbeat. 3 columns, no FK (pure analytics, shouldn't block doc
deletion).

```sql
CREATE TABLE IF NOT EXISTS reading_sessions (
    id TEXT PRIMARY KEY,
    duration_seconds INTEGER NOT NULL,
    session_date TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reading_sessions_date ON reading_sessions(session_date);
```

### Backend — new `commands/stats.rs`

Two Tauri commands:

| Command | Signature | Behaviour |
|---|---|---|
| `record_reading_heartbeat` | `(seconds: u64)` | Insert row with UUID, `seconds`, today's `YYYY-MM-DD` |
| `get_reading_stats` | → `{today_seconds, week_seconds}` | SUM where `session_date = today` and SUM where `session_date >= week_start` (Monday) |

`lib.rs` — register both commands + add `pub mod stats` to `commands/mod.rs`.

### Frontend — timer + display

**`documentStore.ts`** — add heartbeat timer management:
- `startHeartbeat()` — called when a document opens. Sets a 15s `setInterval` that calls `invoke("record_reading_heartbeat", {seconds: 15})`. Pauses on `document.hidden` (visibilitychange), resumes on visible.
- `stopHeartbeat()` — clears interval, called on document close.
- `dailyStats: { todaySeconds: number, weekSeconds: number } | null` — state for display.
- `loadReadingStats()` — calls `invoke("get_reading_stats")`, updates state.

**`CenterViewer.tsx`** — home page (no document open):
- Below the book grid header, show a compact stats bar: `📖 Today: 32 min  •  This week: 2h 14m`
- Hide if both are zero (no reading done yet).
- Call `loadReadingStats()` on mount.

**CSS** — one rule for `.reading-stats` (flex row, muted color, some padding).

### Edge cases / Ponytail notes

- **Drift/missed ticks:** 15s interval ± a few seconds doesn't matter for daily/weekly aggregates.
- **Tab hidden:** Timer pauses on `visibilitychange` (not counting background time).
- **App quit mid-tick:** At most ~15s of time lost per crash. Last heartbeat is always committed.
- **No reading today/week:** Show nothing (hide the bar) rather than "0 min".
- **Time formatting:** Show `X min` under 60 min, `Xh Ym` over 60 min, `Xd Xh` over 24h.

### Files changed

| File | Change |
|---|---|
| `src-tauri/src/db/migrations.rs` | Add `reading_sessions` table + index |
| `src-tauri/src/commands/mod.rs` | Add `pub mod stats` |
| `src-tauri/src/commands/stats.rs` | New file — 2 commands |
| `src-tauri/src/lib.rs` | Register stats commands |
| `src/stores/documentStore.ts` | Add heartbeat timer + stats state |
| `src/components/CenterViewer.tsx` | Add stats bar to home page |
| `src/index.css` | Add `.reading-stats` styles |

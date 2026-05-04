# CLAUDE.md — 21-Day Tracker

## File Structure

Each page is split into three files:

| Page    | HTML shell  | CSS       | JS       |
|---------|-------------|-----------|----------|
| Tracker | app.html    | app.css   | app.js   |
| Admin   | admin.html  | admin.css | admin.js |
| Cohort  | cohort.html | cohort.css| cohort.js|
| Profile | me.html     | me.css    | me.js    |

**When editing:** read only the relevant `.js` or `.css` file — never the HTML shell unless you're changing DOM structure. The HTML shells are ~50–150 lines each.

No build step. GitHub Pages serves the repo root directly.

## Architecture: Skool vs Exclusive

There are two member types — routing logic differs throughout:

| | Skool | Exclusive |
|---|---|---|
| Membership table | `skool_members` | `cohort_members` |
| Cycle table | `skool_cycles` | `cohort_members` (same row) |
| `cohort_id` used in goals/stakes | `skool_cycles.id` | `cohort_members.cohort_id` |
| Start date | User picks any Monday | Fixed per cohort |

`_fetchFreshApp()` in `app.js`: checks `skool_members` first — if found, uses `skool_cycles`; else falls back to `cohort_members`.

## Key DB Tables

- `profiles` — one row per user (id = auth.uid)
- `skool_members` — user_id only (marks someone as Skool)
- `skool_cycles` — id, user_id, start_date (one per 21-day run)
- `cohort_members` — user_id, cohort_id, start_date (exclusive users)
- `cohorts` — exclusive cohort definitions
- `goals` — user_id, cohort_id (= skool_cycle.id for Skool), type, title, config (JSONB)
- `checkins` — goal_id, date, value
- `stakes` — user_id, cohort_id, fields (s1–s4)
- `journal_entries` — user_id, date, content
- `redemptions` — user_id, cohort_id
- `pending_requests` — onboarding approval queue

**No FK constraint** on `goals.cohort_id` — was dropped to allow skool_cycle.id there.

## Goal Types

| Frame | Types |
|---|---|
| Daily | `daily_boolean`, `daily_count`, `daily_time_min`, `daily_time_max` |
| Weekly | `weekly_boolean`, `weekly_days`, `weekly_count`, `daily_count_weekly`, `weekly_time_min`, `weekly_time_max` |
| 21-Day | `milestone`, `total_count`, `total_time_min`, `total_time_max` |

Config stored in `goals.config` JSONB. Time values stored in **minutes** internally; `config.timeUnit` ('min' or 'hr') controls display.

## Goal Locking

Goals lock after **Day 2** (start of Day 3). Before lock, user can add/delete goals and finalize with "I'm Done". `finalized` flag stored in local state `_c.finalized`.

## Key Functions in app.js

- `_fetchFreshApp()` — fetches all data, resolves Skool vs Exclusive routing
- `_buildDayHTML(date)` — renders the full day page HTML (goal setup at top when !locked && !finalized)
- `renderContent()` — re-renders current day without full page rebuild
- `renderNoCohort()` — shown to Skool members who haven't picked a start Monday yet
- `renderGoalCard(g, date, locked)` — renders a single goal card
- `setAddColor(hex)` / `setAddTimeUnit(unit)` — update color/unit in-place without re-render (preserves typed values)
- `_getMondays()` — always returns [last Monday, next Monday]
- `showCycleEndOverlay()` — full-screen takeover when Skool member day > 21

## Supabase Notes

- Anon key is client-side (safe — RLS policies enforce access)
- Use `.maybeSingle()` not `.single()` when a row might not exist
- `skool_members` has no FK to `profiles` — fetch user_ids then profiles separately (direct join returns 400)

## Deleting a Member (admin.js)

`deleteMemberEntirely(userId, key)` order:
1. Fetch goal IDs → delete `checkins` (FK on goal_id)
2. Parallel delete: `goals`, `stakes`, `redemptions`, `journal_entries`, `skool_cycles`, `skool_members`, `cohort_members`, `pending_requests`
3. Delete `profiles` last

## Tooltip CSS Fix

Tooltips use `left:0; transform:none` (not `left:50%; translateX(-50%)`) to prevent left-edge clipping.

## Dev Server

No local server needed — open HTML files directly or via any static server.
GitHub Pages: `https://thimith.github.io/21-days-tracker/`

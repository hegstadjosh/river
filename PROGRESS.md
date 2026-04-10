# River — Build Progress

## Status: COMPLETE (v0.3.0 — Unified Task Store)

## What's Built

### Backend (src/)
- **MCP server**: 6 tools (put, move, look, branch, sweep, plan)
- **SQLite storage**: tasks (with energy), timelines, meta tables
- **Modular architecture**: state.ts composes 8 db modules:
  - `db/tasks.ts` — CRUD
  - `db/move.ts` — positioning
  - `db/look.ts` — river view + breathing room
  - `db/recirculate.ts` — past-due task handling
  - `db/branches.ts` — timeline branching
  - `db/sweep.ts` — bulk operations
  - `db/plan.ts` — plan mode (5 lanes, fill, name, commit, lane manipulation)
  - `db/types.ts` — shared row types
- **HTTP API**: 14 plan actions (start, end, commit, lane_put, update_task, to_cloud, add, remove, reposition, move, copy) + core CRUD
- **39 tests**: 13 core CRUD + 26 plan mode operations

### Viewer (viewer/)
- **11 modular JS files** sharing `window.River` namespace:
  - `river-core.js` — constants, state, canvas
  - `river-layout.js` — positioning, snap math
  - `river-render.js` — world, streaks, now-line, past fade
  - `river-grid.js` — time markers, local-time boundaries
  - `river-blobs.js` — unified blob rendering (RGB energy color)
  - `river-store.js` — **UNIFIED TASK STORE** (one array, selectors, save/delete/position, SSE, sync)
  - `river-panel.js` — detail panel, duration/time inputs
  - `river-input.js` — mouse handlers, drag, resize, hit testing
  - `river-plan.js` — plan mode lanes, commit buttons
  - `river-drag-wizard.js` — cloud→river wizard, horizon dwell switch
  - `river-main.js` — frame loop, horizon bar

### Architecture (v0.3.0 refactor)
- **One task array** (`R.tasks`) — no more `animTasks` + `planAnimTasks` split
- **Task context**: each task carries `ctx: {type:'main'}` or `ctx: {type:'lane', lane:N}`
- **Selectors**: `findTask`, `mainTasks`, `riverTasks`, `cloudTasks`, `tasksInLane`, `laneTasks`, `visibleTasks`
- **Single save path**: `R.save(id, changes)` resolves HTTP action from task context
- **Store abstractions**: `savePosition`, `deleteTask`, `moveToCloud`, `moveToLane`, `copyToLane`
- **One physics loop** — no separate planPhysicsStep
- **One hit test** — searches all tasks regardless of context

### Features
- 3 task dimensions: duration (horizontal), commitment (shape), energy (color)
- 4 drag handles per task: left/right=duration, top=commitment, bottom=energy
- Horizon selector: 6h, day, 4d, week, month, quarter, year
- Horizontal scrolling + frame navigation
- Sticky snap-to-grid on visible time boundaries
- Double-click to create tasks (in cloud, river, or plan lanes)
- Cloud-to-river drag wizard (duration→commitment→energy in one gesture)
- Drag-to-horizon timeframe switch (dwell 0.5s to zoom)
- Plan mode: 5 swim lanes, fill via MCP or viewer, commit/discard
- Plan button (top-right) toggles plan mode
- Right-click context menu (copy/dissolve)
- Detail panel with start/end times, duration presets, energy slider

## Git Log (refactor branch)
```
ed28c61 refactor: address code review findings
83aa37a refactor: update river-blobs.js to use R.tasks
7639a31 refactor: rewrite plan/main/panel to use unified task store
9f111d8 refactor: river-input.js uses unified store
3ed0fcd refactor: remove river-sse.js (merged into river-store.js)
c18e42b refactor: add unified task store (river-store.js)
9d76748 feat: plan mode fully interactive from viewer
```

## Known Issues
- customY never clears — dragged tasks permanently ignore server Y
- Module load order in index.html is fragile (no enforcement)
- R.planMode still checked 6 times in river-input.js (plan-specific features, not duplicated branching)

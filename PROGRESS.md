# River — Build Progress

## Status: COMPLETE (v0.2.0)

## What's Built

### Backend (src/)
- **MCP server**: 6 tools (put, move, look, branch, sweep, plan)
- **SQLite storage**: tasks (with energy), timelines, meta tables
- **Modular architecture**: state.ts (249 lines) composes 8 db modules:
  - `db/tasks.ts` — CRUD
  - `db/move.ts` — positioning
  - `db/look.ts` — river view + breathing room
  - `db/recirculate.ts` — past-due task handling
  - `db/branches.ts` — timeline branching
  - `db/sweep.ts` — bulk operations
  - `db/plan.ts` — plan mode (5 lanes, fill, name, commit)
  - `db/types.ts` — shared row types

### Viewer (viewer/)
- **11 modular JS files** sharing `window.River` namespace (no build step):
  - `river-core.js` — constants, state, canvas
  - `river-layout.js` — positioning, snap math
  - `river-render.js` — world, streaks, now-line, past fade
  - `river-grid.js` — time markers, local-time boundaries
  - `river-blobs.js` — unified blob rendering (RGB energy color)
  - `river-sse.js` — SSE + sync
  - `river-panel.js` — detail panel, duration/time inputs
  - `river-input.js` — mouse handlers, drag, resize, hit testing
  - `river-plan.js` — plan mode lanes, palette, commit buttons
  - `river-drag-wizard.js` — cloud→river wizard, horizon dwell switch
  - `river-main.js` — frame loop, horizon bar

### Features
- 3 task dimensions: duration (horizontal), commitment (shape), energy (color)
- 4 drag handles per task: left/right=duration, top=commitment, bottom=energy
- Horizon selector: 6h, day, 4d, week, month, quarter, year
- Horizontal scrolling + frame navigation (step by 1 unit)
- Sticky snap-to-grid on visible time boundaries
- Double-click to create tasks
- Cloud-to-river drag wizard (duration→commitment→energy in one gesture)
- Drag-to-horizon timeframe switch (dwell 0.5s to zoom)
- Plan mode: 5 swim lanes, Claude fills 3, palette zone for cloning
- Adaptive time grid (local timezone, intuitive boundaries)
- Detail panel with start/end times, duration presets, energy slider
- Panel follows task during drag/scroll

### Code Review Fixes
- Path traversal vulnerability in static file serving — fixed
- Silent no-op plan actions — now return 501
- Dead code (energyColor HSL, tagHue) — removed

## Known Issues (from code review)
- customY never clears — dragged tasks permanently ignore server Y
- No test coverage for plan mode (13 tests cover only basic CRUD/look)
- look() calls recirculate() on every invocation — performance concern at scale
- Module load order in index.html is fragile (no enforcement)

## Git Log (recent)
```
08b8c3e fix: path traversal vulnerability, silent no-op plan actions, dead code
5192425 feat: cloud-to-river drag wizard + drag-to-horizon timeframe switch
2a55418 feat: enrich SSE plan state with lane tasks
3ee1eb0 feat: plan mode viewer — 5-lane swim lanes, palette zone
0b0fe8e feat: register plan MCP tool
3944267 feat: add plan mode schema, db module, state wiring
4f7f4f2 refactor: viewer into 10 modules
... (refactor: backend into 8 db modules)
```

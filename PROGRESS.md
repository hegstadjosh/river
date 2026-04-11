# River — Build Progress

## Status: COMPLETE (v0.4.0 — Window-Locked Plan Mode)

## What's Built

### Backend (src/)
- **MCP server**: 6 tools (put, move, look, branch, sweep, plan)
- **SQLite storage**: tasks with energy, cloud_x/cloud_y, river_y, timelines, meta
- **Modular architecture**: state.ts composes 8 db modules
- **HTTP API**: 14 plan actions + core CRUD
- **50 tests**: 13 core CRUD + 37 plan mode operations

### Viewer (viewer/)
- **11 modular JS files** sharing `window.River` namespace via unified task store
- **Unified task store** (`river-store.js`): one array, selectors, save/delete/position, SSE, sync
- **No duplicate code paths**: one physics loop, one hit test, one save path

### Architecture
- **One task array** (`R.tasks`) with `ctx` field: `{type:'main'}` or `{type:'lane', lane:N}`
- **Selectors**: findTask, mainTasks, riverTasks, cloudTasks, tasksInLane, laneTasks, visibleTasks
- **Single save path**: `R.save(id, changes)` resolves HTTP action from task context
- **Persistent positions**: cloud_x/cloud_y and river_y stored in DB (no more customY hack)

### Plan Mode v2 (Window-Locked)
- Click "Plan" to lock current visible time range as the plan window
- **Lane 1**: read-only snapshot of current river tasks in window (labeled "current")
- **Lanes 2-4**: Claude fills via MCP, or user fills manually
- **Lane 5**: empty scratch lane for user
- **Window-scoped commit**: "Use this" only replaces tasks within the plan window — everything outside untouched
- **Plan window outline**: warm border on river showing the locked time range, visible at all zoom/scroll
- **Lane 1 protections**: no drag, no resize handles, no commit button, no quick-add, dimmer rendering
- **Escape key** exits plan mode
- **MCP tool** rejects lane 1 modifications, includes window_start/window_end in status

### Features
- 3 task dimensions: duration (horizontal), commitment (shape), energy (color)
- 4 drag handles per task: left/right=duration, top=commitment, bottom=energy
- Horizon selector: 6h, day, 4d, week, month, quarter, year
- Horizontal scrolling + frame navigation
- Sticky snap-to-grid on visible time boundaries
- Double-click to create tasks (in cloud, river, or plan lanes)
- Cloud-to-river drag wizard (duration→commitment→energy in one gesture)
- Drag-to-horizon timeframe switch (dwell 0.5s to zoom)
- Persistent cloud positions (arrangeable, saved to DB)
- Persistent river Y positions (vertical arrangement saved to DB)
- Detail panel with start/end times, duration presets, energy slider

## Known Issues
- Module load order in index.html is fragile (no enforcement)
- R.planMode still checked in river-input.js for genuinely plan-specific behaviors (lane detection, commit buttons)

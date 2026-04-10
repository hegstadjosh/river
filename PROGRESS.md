# River — Build Progress

## Status: REFACTOR IN PROGRESS

## Current Task
Refactoring river.js (1687 lines) and state.ts (711 lines) into focused modules.
Then building Plan Mode on the clean architecture.

## What Exists (all working)
- **MCP server**: 5 tools (put, move, look, branch, sweep) + energy dimension
- **SQLite storage**: tasks, timelines, meta tables. Energy column added.
- **Viewer**: Canvas 2D with warm dark theme
  - Unified blob→rectangle rendering (solidity-driven shape morph)
  - Energy-based color: dark blue → light blue → gold → mid red → dark red
  - 4 drag handles: left/right=duration, top=commitment, bottom=energy
  - Horizon selector: 6h, day, 4d, week, month, quarter, year
  - Horizontal scrolling with frame navigation
  - Snap-to-grid (sticky zones on visible lines)
  - Double-click to create tasks
  - Detail panel with duration presets, commitment/energy sliders, start/end times
  - Panel follows task during drag/scroll
  - Resize handles with live time labels
  - SSE real-time updates from MCP tools
  - Adaptive time grid (local timezone, intuitive boundaries)
  - Past fade, flow streaks, breathing now-line

## Refactor Plan

### river.js → viewer/ modules
- `viewer/core.js` — canvas setup, resize, DPR, state vars
- `viewer/layout.js` — position calculations, hoursToX, cloudPos, riverPos, taskStretch
- `viewer/render.js` — drawWorld, drawStreaks, drawNowLine, drawPastFade
- `viewer/blobs.js` — drawBlob (unified rendering), energy color
- `viewer/grid.js` — drawTimeMarkers, all the boundary helpers
- `viewer/input.js` — mouse handlers, drag, resize handles, snap, hit testing
- `viewer/panel.js` — detail panel, duration presets, time inputs, show/hide
- `viewer/sse.js` — SSE connection, fetch, sync
- `viewer/river.js` — main IIFE, imports everything, runs the frame loop

### state.ts → src/ modules
- `src/state.ts` — RiverState class (slim: constructor, DB init, SSE, close)
- `src/db/tasks.ts` — putTask, getTask, deleteTask, moveTask, moveTasks
- `src/db/look.ts` — look(), recirculate(), breathing room
- `src/db/branches.ts` — create/list/switch/commit/diff/delete branches
- `src/db/sweep.ts` — sweep filter + actions

## Plan Mode (Round 2)
See docs/plan-mode.md for full spec.

## Known Issues
- Snap feel still not perfect
- Position = center in data model (causes edge-pinning complexity)

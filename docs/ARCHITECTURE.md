# Architecture

River is a single Node.js process that runs an MCP server (stdio) and an HTTP server (default port 7433) side by side. Claude talks to River over MCP; a browser-based viewer connects over HTTP.

## File Tree

```
src/
  index.ts          Entry point — wires MCP + HTTP, signal handlers
  state.ts          RiverState class — composes all db/ modules, owns SQLite + SSE
  schema.ts         Zod schemas, TypeScript types, constants
  http.ts           HTTP server — static files, REST endpoints, SSE
  db/
    tasks.ts        CRUD: insert, update, delete, list tasks
    move.ts         Reposition a task (anchor + vertical offset)
    look.ts         Query: river window, cloud contents, timeline
    recirculate.ts  Silently move drifted-past tasks back to the cloud
    branches.ts     Branch/lane management for plan mode
    sweep.ts        Bulk dissolve: remove old or low-solidity tasks
    plan.ts         Plan mode state: lanes, commit, task arrangement
    types.ts        Shared DB row types
  tools/
    put.ts          MCP tool: create or update a task
    move.ts         MCP tool: reposition a task in time
    look.ts         MCP tool: read the current river/cloud state
    branch.ts       MCP tool: create/manage plan branches
    sweep.ts        MCP tool: dissolve tasks in bulk
    plan.ts         MCP tool: enter/exit plan mode, manage lanes

viewer/
  index.html             Shell: canvas, horizon bar, panel, quick-add input
  style.css              All styling
  river-core.js          Namespace init (window.River), world constants, physics tunables
  river-layout.js        Spatial math: positions, hit geometry, snap physics
  river-render.js        World drawing: streaks, now-line, past fade, sky/water gradient
  river-grid.js          Time markers, date/hour labels, boundary helpers
  river-blobs.js         Blob rendering: radial gradients, color-by-time stops
  river-plan.js          Plan mode: swim-lane rendering and lane interaction
  river-sse.js           SSE connection, initial fetch, state sync into animation tasks
  river-panel.js         Detail panel: show/hide, duration presets, field listeners
  river-drag-wizard.js   Drag-through wizard: cloud-to-river transformation zones
  river-input.js         Mouse/touch handlers: hit test, drag, resize, quick-add
  river-main.js          Canvas setup, horizon bar, requestAnimationFrame loop
```

## Backend

### Entry Point (`src/index.ts`)

1. Creates `RiverState` with SQLite stored at `~/.river/river.db`
2. Registers six MCP tools (put, move, look, branch, sweep, plan)
3. Connects MCP over stdio — this happens first so Claude's handshake isn't blocked
4. Starts the HTTP server for the viewer on port 7433 (falls back to 7434 if busy)

### State Layer (`src/state.ts`)

`RiverState` is the central class. It owns the SQLite database and composes functionality from `src/db/` modules via factory functions (`createTaskCrud`, `createMoveFns`, etc.). It also manages SSE client connections and broadcasts state changes.

### HTTP Server (`src/http.ts`)

- `GET /` — serves the viewer (static files from `viewer/`)
- `GET /state` — JSON snapshot of the current river + cloud
- `GET /events` — SSE stream; pushes full state on every mutation
- `GET /plan` — plan mode state with lane details
- `POST /state` — viewer mutations (move, put, delete, plan_commit)

## Viewer

Eleven vanilla JS files share the `window.River` namespace. No framework, no build step — just `<script>` tags loaded in dependency order. The canvas fills the viewport and redraws every frame via `requestAnimationFrame`.

State flows in one direction: the viewer receives state from SSE and renders it. User interactions (drag, quick-add, panel edits) POST back to `/state`, which mutates SQLite and triggers a new SSE broadcast.

## Data Flow

```
Claude ──MCP stdio──▶ tool handler ──▶ RiverState ──▶ SQLite
                                            │
                                            ▼
Viewer ◀──SSE /events── HTTP server ◀── notify()
  │
  └──POST /state──▶ HTTP server ──▶ RiverState ──▶ SQLite ──▶ SSE broadcast
```

## Storage

SQLite database at `~/.river/river.db`, WAL mode, foreign keys enabled. The database is created automatically on first run. All task state — positions, metadata, plan lanes — lives in this single file.

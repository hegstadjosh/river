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
  river-store.js         Unified task store: R.tasks, selectors, save path, SSE sync
  river-layout.js        Spatial math: positions, hit geometry, snap physics
  river-render.js        World drawing: streaks, now-line, past fade, sky/water gradient
  river-grid.js          Time markers, date/hour labels, boundary helpers
  river-blobs.js         Blob rendering: radial gradients, color-by-time stops
  river-plan.js          Plan mode: swim-lane rendering and lane interaction
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
- `POST /state` — viewer mutations. The request body carries an `action` field. Supported actions:

    | Action | Purpose |
    |---|---|
    | `put` | Create or update a task (main or cloud) |
    | `move` | Reposition an existing task in time |
    | `delete` | Dissolve a task |
    | `tag_create` | Add a tag to the known-tags list |
    | `plan_start` | Enter plan mode, lock the current visible window |
    | `plan_end` | Exit plan mode without committing |
    | `plan_commit` | Replace main-river tasks inside the plan window with a lane's contents |
    | `plan_lane_put` | Create or update a task inside a specific plan lane |
    | `plan_update_task` | Edit fields on an existing lane task |
    | `plan_to_cloud` | Remove a task from a lane, sending it back to the cloud |
    | `plan_add` | Add an existing task into a lane at a position |
    | `plan_remove` | Remove a task from a lane |
    | `plan_reposition` | Move a task within its current lane |
    | `plan_move` | Move a task from one lane to another |
    | `plan_copy` | Duplicate a task into a lane (leaves the original) |

## Viewer State

### Unified Task Store (`river-store.js`)

All task state in the viewer lives in a single array, `R.tasks`. Each task carries a `ctx` field that tags which surface it belongs to:

- `ctx = { type: 'main' }` — a real task (cloud or river)
- `ctx = { type: 'lane', lane: N }` — a plan-mode snapshot task in lane N (1-5)

This replaces the previous split between cloud tasks, river tasks, and plan tasks as separate collections. Everything that reads the world goes through selectors on the store:

| Selector | Returns |
|---|---|
| `R.findTask(id)` | A task by id, from any surface |
| `R.mainTasks()` | All main tasks (cloud + river) |
| `R.riverTasks()` | Main tasks currently anchored to a time |
| `R.cloudTasks()` | Main tasks in the cloud (no anchor) |
| `R.tasksInLane(n)` | Lane tasks for lane `n` |
| `R.laneTasks()` | All lane tasks across every lane |
| `R.visibleTasks()` | Whatever should render given the current mode |

Mutations funnel through a **single save path** so plan-mode and main-mode writes stay consistent:

- `R.save(task)` — upsert, routes to `put` or `plan_lane_put` depending on `ctx`
- `R.savePosition(task)` — anchor/lane position update, routes to `move` or `plan_reposition`
- `R.deleteTask(id)` — routes to `delete` or `plan_remove`
- `R.moveToCloud(id)` — from river or lane back to cloud
- `R.moveToLane(id, lane)` / `R.copyToLane(id, lane)` — lane placement and duplication

### SSE Sync and the Dirty Flag

The store owns the SSE connection. When a new server snapshot arrives, it **merges** rather than replaces: existing task objects keep their in-flight animation state (positions, easing, drag offsets) and only have their data fields updated. New tasks are appended; missing tasks are removed.

Every local save sets a **dirty flag** on the task with a short TTL. While the flag is live, incoming SSE frames skip that task -- otherwise a slow server round-trip could overwrite a just-edited field with a stale value. Once the flag expires (or the server echoes back the change), SSE sync resumes normally for that task.

## Persistence

### Task Positions

Tasks persist their spatial positions across sessions. The `tasks` table carries:

- `cloud_x`, `cloud_y` — normalized 0-1 position within the cloud zone
- `river_y` — normalized 0-1 vertical offset within the river zone (the horizontal position is derived from the task's anchor time)

This lets the cloud stay visually stable across reloads instead of reshuffling every time.

### Tag Persistence

All tags ever created are stored in the `meta` table under the key `known_tags` as a JSON array of `{name, color}` entries. The list is returned inside every `look()` response so the viewer's tag bar and panel tag checkboxes can show tags that no task currently uses.

### Plan Mode v2

Plan mode is persisted in the `meta` table via two keys:

- `plan_window_start` — absolute ISO timestamp of the window start
- `plan_window_end` — absolute ISO timestamp of the window end

When `plan_start` is called, the server snapshots every main task whose anchor falls inside the window into **lane 1** as a starting point for editing. Lanes 2-5 start empty. `plan_commit` is window-scoped: it deletes main tasks whose anchors fall inside the window and inserts the chosen lane's tasks in their place, leaving everything outside the window alone.

## Viewer

A set of vanilla JS files sharing the `window.River` namespace. No framework, no build step — just `<script>` tags loaded in dependency order. The canvas fills the viewport and redraws every frame via `requestAnimationFrame`.

State flows in one direction: the viewer receives state from SSE (via `river-store.js`) and renders it. User interactions (drag, quick-add, panel edits) POST back to `/state`, which mutates SQLite and triggers a new SSE broadcast.

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

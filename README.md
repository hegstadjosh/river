# River

Physics-based spatial task scheduling MCP server + Canvas viewer.

Time is a river, not a grid. Tasks are organic blobs that drift in a current — big ones take up space, committed ones are vivid, maybes are wisps. An MCP server exposes six tools so Claude (or any MCP client) can arrange the river by conversation; a vanilla-JS Canvas viewer at `localhost:7433` renders everything live via SSE.

## What Makes It Different

- **Organic blobs, not boxes.** Duration is horizontal span, commitment is opacity, energy is color temperature. You see the shape of your day.
- **Warm palette only.** Earth tones, watercolors, amber. No red, no alerts, no spreadsheet feel.
- **No guilt.** No "overdue," no task counts, no productivity language. Tasks that drift past now silently recirculate to the cloud.
- **Commitment is a 0–1 gradient.** A wisp at 0.1 is barely a thought; crystalline at 0.9 is locked in. There's no binary "scheduled / not scheduled" to break.
- **Plan mode.** Lock a time window, explore alternative arrangements in five swim lanes, commit one — overwriting only that window.

## Quick Start

```bash
pnpm install
pnpm dev
```

Open `http://localhost:7433` to see the viewer. The dev command runs the MCP server over stdio and the HTTP/SSE server side by side.

## MCP Registration

Build once, then register the compiled entry point with Claude Code:

```bash
pnpm build
claude mcp add --scope user river -- node /Users/josh/river/dist/index.js
```

## MCP Tools

Six tools are exposed to the client:

- **put** — create or update tasks (name, duration, position, commitment, energy, tags); single or batch.
- **move** — reposition in time; absolute, relative shift, or batch. `position: null` sends a task back to the cloud.
- **look** — read the current river, cloud, breathing room, known tags, and plan state.
- **branch** — fork the timeline, diff against main, commit or discard.
- **sweep** — bulk-modify tasks matching a filter (shift, set, remove).
- **plan** — enter plan mode with a locked window, fill lanes with alternatives, commit one.

## Key Features

- **Tag system** — persistent tags, colored swatches, click to filter, double-click label to rename, `+` button to create. See [docs/README.md](docs/README.md).
- **Multi-select** — shift-click to build a selection, group drag/resize, batch edits from the panel.
- **Plan mode v2** — window-locked, lane 1 is a read-only snapshot, lanes 2–5 editable, commit is window-scoped. See [docs/plan-mode-v2.md](docs/plan-mode-v2.md).
- **Drag wizard** — dragging a cloud task across the surface sweeps it through duration → commitment → energy zones before it settles into the river. See [docs/INTERACTIONS.md](docs/INTERACTIONS.md).
- **Persistent positions** — `cloud_x/cloud_y` and `river_y` are stored, so the cloud and vertical lane stay put across reloads.
- **Back to cloud** — tasks that drift past now recirculate silently unless the per-task toggle is off.

## Documentation

- [docs/README.md](docs/README.md) — feature overview and design principles
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — file tree, data flow, storage
- [docs/INTERACTIONS.md](docs/INTERACTIONS.md) — every viewer gesture
- [docs/plan-mode-v2.md](docs/plan-mode-v2.md) — plan mode design

## Tech Stack

TypeScript, `@modelcontextprotocol/sdk`, `better-sqlite3`, Zod. Vanilla HTML Canvas 2D viewer — no framework, no build step for the viewer. Built with `tsup`, developed with `tsx`, tested with `vitest`. pnpm as package manager.

## Notes

River is local-only. It runs on your machine, writes SQLite to `~/.river/river.db`, and is not deployed anywhere. There is no account, no sync, no server to call home to.

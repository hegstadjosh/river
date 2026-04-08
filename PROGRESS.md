# River — Build Progress

## Status: COMPLETE (v0.1.0)

## What Is River
A physics-based spatial task scheduling MCP server + web viewer. Tasks are organic blobs floating in a river of time. Controlled via 5 MCP tools from Claude Code. See design spec for the full emotional design philosophy.

## What's Done

### Foundation
- **Project scaffolding:** package.json, tsconfig, vitest, pnpm deps (including better-sqlite3 native module)
- **Schema & types:** `src/schema.ts` — Zod schemas for all 5 tools, TypeScript interfaces, position/anchor conversion helpers, constants

### State Layer
- **RiverState class:** `src/state.ts` — SQLite storage via better-sqlite3, task CRUD, move (absolute + batch shift), look (with recirculation), sweep (filter + shift/set/remove), timeline branching (create/list/switch/commit/diff/delete), SSE client management
- **Unit tests:** `tests/state.test.ts` — 13 tests covering init, putTask, moveTask, look, breathing room, horizon filter

### MCP Tools (5 tools)
- **put:** `src/tools/put.ts` — create/update tasks, single + batch
- **move:** `src/tools/move.ts` — absolute position, relative shift, batch shift
- **look:** `src/tools/look.ts` — read state with recirculation + breathing room
- **branch:** `src/tools/branch.ts` — timeline versioning (create/list/switch/commit/diff/delete)
- **sweep:** `src/tools/sweep.ts` — bulk filter + shift/set/remove

### HTTP Server
- **HTTP server:** `src/http.ts` — static file serving for viewer, GET /state, POST /state (viewer mutations), GET /events (SSE)
- **Entry point:** `src/index.ts` — MCP server (stdio) + HTTP server in single process, graceful shutdown

### Viewer
- **HTML:** `viewer/index.html` — canvas + click panel (name, size, commitment, pin, dissolve)
- **CSS:** `viewer/style.css` — dark warm theme (#1a1614), frosted glass panel, amber accent
- **Canvas engine:** `viewer/river.js` — blob rendering with solidity-based opacity/blur, rocks as rounded rects, now-line with breathing glow, flow streaks, cloud/river zones, drag-and-drop, click panel, SSE live updates, spring animation

## How to Use

### Development
```bash
cd ~/river && pnpm dev
# Opens viewer at http://localhost:7433
# MCP server runs on stdio
```

### Build
```bash
pnpm build  # → dist/index.js
```

### Tests
```bash
pnpm test  # 13 tests, all passing
```

### MCP Registration
Add to `~/.claude/mcp.json`:
```json
{
  "mcpServers": {
    "river": {
      "command": "npx",
      "args": ["tsx", "/Users/josh/river/src/index.ts"]
    }
  }
}
```

## Architectural Decisions
- **Single process:** MCP server (stdio) and HTTP server share the same RiverState instance — mutations via MCP tools instantly push SSE updates to the viewer
- **Lazy recirculation:** Tasks past "now" are recirculated to cloud on every `look()` and `/state` read — no background timer needed since MCP server only runs when Claude Code is connected
- **Full-snapshot branching:** Branch `create` copies all tasks, `commit` replaces parent by moving tasks — simple, no merge conflicts for personal scheduling
- **Position ↔ anchor conversion:** MCP tools accept `position` (hours-from-now), stored as absolute `anchor` (ISO timestamp) — stable in DB, relative in display

## Known Issues
- None blocking

## Design Spec
`~/OneDrive/Obsidian Vault/Planning/APRIL/River - Design Spec.md`

## Implementation Plan
`~/OneDrive/Obsidian Vault/Planning/APRIL/River - Implementation Plan.md`

## Git Log
```
2b41bcb feat: HTTP server + entry point — static viewer, SSE, POST mutations, MCP stdio
dbfe835 feat: web viewer — Canvas 2D rendering engine with warm dark theme
6ce615b feat: MCP tool — sweep (bulk filter + shift/set/remove)
039e78f feat: MCP tool — branch (create, list, switch, commit, diff, delete)
11fc270 feat: MCP tool — look (view river, cloud, breathing room)
847b1b4 feat: MCP tool — move (absolute, relative, batch shift)
1db5f90 feat: MCP tool — put (create/update tasks, single + batch)
e8e8299 feat: RiverState — SQLite storage, task CRUD, timelines, recirculation, sweep, SSE
794c565 feat: Zod schemas, types, and conversion helpers
326abb0 chore: project scaffolding — package.json, tsconfig, vitest, deps installed
6627bc7 chore: autonomous build setup — CLAUDE.md, PROGRESS.md, directory structure
```

# River

A physics-based spatial task scheduling tool built as an MCP server. Time is a river, not a grid. Tasks are shapes that drift in a current -- big ones take up space, committed ones are vivid, maybes are wisps. Nothing is overdue. Nothing judges you.

River connects to Claude (or any MCP client). You talk naturally -- "push that to after lunch," "give me a chill afternoon" -- and Claude arranges the river using six tools. A Canvas viewer at `localhost:7433` renders everything live via SSE.

## Install

```bash
pnpm install
```

Register River as an MCP server in Claude Code:

```bash
pnpm build
claude mcp add --scope user river -- node /Users/josh/river/dist/index.js
```

Start the dev server directly (also serves the viewer):

```bash
pnpm dev
```

Open `http://localhost:7433` to see the viewer.

## MCP Tools

River exposes six tools to the AI client:

**put** -- Create or update tasks. Set name, duration, position (hours from now), commitment, energy, tags. Supports single or batch mode.

**move** -- Reposition tasks in time. Absolute (`position`), relative (`shift`), or batch. Set position to `null` to send a task back to the cloud.

**look** -- See the river. Returns scheduled tasks, cloud (unscheduled) tasks, breathing room (free minutes in the next 4 hours and rest of day), known tags, and plan state.

**branch** -- Fork your timeline. Try a different arrangement, compare branches with diff, then commit or discard.

**sweep** -- Bulk-modify tasks matching a filter. Shift them in time, update properties, or remove them.

**plan** -- Lock a time window and explore up to 5 swim lanes of alternative arrangements, then commit one -- overwriting only that window. See [plan-mode-v2.md](plan-mode-v2.md).

## Task Dimensions

Every task has three visual dimensions:

| Dimension | Field | Range | Visual encoding |
|-----------|-------|-------|-----------------|
| **Duration** | `mass` | Minutes (default 30) | Horizontal width of the shape |
| **Commitment** | `solidity` | 0 -- 1 (default 0.1) | Opacity and sharpness. A wisp at 0.1, crystalline at 0.9 |
| **Energy** | `energy` | 0 -- 1 | Color temperature. Cool/blue at 0, warm/amber at 1 |

Position is hours from now. Positive = future, negative = past, `null` = cloud (unscheduled, floating above the river).

Tasks can also be `fixed` (immovable, like a class or meeting) or `alive` (the thing you're doing right now).

Each task persists its own spatial state: `cloud_x` / `cloud_y` (normalized position within the cloud zone) and `river_y` (vertical offset within the river lane). Drag a task to reposition it and that position survives reloads.

## Viewer

The Canvas viewer at `http://localhost:7433` shows:

- A river flowing left to right, with a thin amber **now-line**
- Scheduled tasks as organic blobs in the current
- Unscheduled tasks floating in the **cloud** above
- Free time as warm, glowing gaps between tasks
- A tag bar along the edge
- Plan mode with swim lanes when active

The viewer updates in real-time via SSE whenever Claude (or any MCP client) modifies the river.

### Unified Task Store

The viewer runs against a single `R.tasks` array. Every task carries a `ctx` field — `{ type: 'main' }` for river/cloud tasks or `{ type: 'lane', lane: N }` for plan lane tasks — and selectors (`R.mainTasks()`, `R.riverTasks()`, `R.cloudTasks()`, `R.tasksInLane(n)`) filter off that. A single `R.save(id, changes)` routes edits to the right endpoint based on context. See [ARCHITECTURE.md](ARCHITECTURE.md).

### Tags

Tags are persistent on the server (not derived from task metadata). The tag bar shows every known tag as a colored swatch:

- **Click a swatch** to toggle visibility — hidden tags dim their tasks out of the render.
- **`all` toggle** — flip every tag at once.
- **Double-click a tag label** to rename it. Every task carrying that tag is updated server-side.
- **`+` button** — inline popup to create a new tag (`tag_create`).
- In the detail panel, a row of colored dots lets you add/remove tags from the selected task(s).

### Multi-Select

- **Shift-click** a task to add it to the current selection (or remove it if already selected).
- Dragging any selected task drags the whole group. Resize handles apply to the whole group.
- The detail panel shows shared fields and writes changes to every selected task at once (including tag toggles, duration presets, commitment/energy sliders).

### Back to Cloud

The panel has a **Back to cloud** toggle (per task). When on, a task that drifts past the now-line silently recirculates to the cloud. When off, the task stays fixed in place even after it's gone by. Replaces the old "Pinned" label — same idea, warmer name.

## Plan Mode v2

Plan mode is window-locked. You navigate to the view you want to plan, click **Plan**, and the currently visible time range becomes the plan window (stored as absolute timestamps). Five swim lanes drop in below the surface:

- **Lane 1** is a live snapshot of the current river within the window — editable in place. Changes there flow straight back to the main river.
- **Lanes 2–5** start empty. Claude fills lanes 2–4 with alternative arrangements via the `plan` tool; lane 5 is scratch space.
- **Commit ("Use this")** deletes main river tasks whose centers fall within the plan window, inserts the chosen lane's tasks, and exits plan mode. Everything outside the window is untouched.
- Scrolling, zooming, and the horizon bar all work normally during plan mode; the window outline stays visible as a warm border.

See [plan-mode-v2.md](plan-mode-v2.md) for the full design.

## Design Principles

River is built around a few deliberate constraints:

- **No red.** No "overdue." No shame. Tasks that drift past now recirculate silently to the cloud.
- **No counts.** No "you have 23 tasks." The spatial layout gives you a felt sense of volume without a number to judge yourself by.
- **No productivity language.** No "productive," "efficient," or "optimize." The vocabulary is spatial: *flow, drift, float, settle, clear, open.*
- **Warm palette only.** Earth tones, watercolors, amber, muted colors. The viewer should feel like a landscape, not a spreadsheet.
- **Commitment is a gradient.** A task at 0.1 solidity is barely a thought. At 0.9 it's locked in. There's no moment where scheduling becomes a promise you'll break.

## Tech Stack

TypeScript, `@modelcontextprotocol/sdk`, `better-sqlite3`, Zod. Vanilla HTML Canvas 2D viewer (no framework, no build step). Built with `tsup`, developed with `tsx`, tested with `vitest`.

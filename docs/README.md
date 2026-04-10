# River

A physics-based spatial task scheduling tool built as an MCP server. Time is a river, not a grid. Tasks are shapes that drift in a current -- big ones take up space, committed ones are vivid, maybes are wisps. Nothing is overdue. Nothing judges you.

River connects to Claude (or any MCP client). You talk naturally -- "push that to after lunch," "give me a chill afternoon" -- and Claude arranges the river using six tools. A Canvas viewer at `localhost:7433` renders everything live via SSE.

## Install

```bash
pnpm install
```

Register River as an MCP server in Claude Code:

```bash
claude mcp add river -- pnpm --prefix /path/to/river dev
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

**look** -- See the river. Returns scheduled tasks, cloud (unscheduled) tasks, and breathing room (free minutes in the next 4 hours and rest of day).

**branch** -- Fork your timeline. Try a different arrangement, compare branches with diff, then commit or discard.

**sweep** -- Bulk-modify tasks matching a filter. Shift them in time, update properties, or remove them.

**plan** -- Explore different arrangements with swim lanes. Start a plan with a timeframe (6h to year), fill up to 5 lanes with different approaches, then commit the one you like.

## Task Dimensions

Every task has three visual dimensions:

| Dimension | Field | Range | Visual encoding |
|-----------|-------|-------|-----------------|
| **Duration** | `mass` | Minutes (default 30) | Horizontal width of the shape |
| **Commitment** | `solidity` | 0 -- 1 (default 0.1) | Opacity and sharpness. A wisp at 0.1, crystalline at 0.9 |
| **Energy** | `energy` | 0 -- 1 | Color temperature. Cool/blue at 0, warm/amber at 1 |

Position is hours from now. Positive = future, negative = past, `null` = cloud (unscheduled, floating above the river).

Tasks can also be `fixed` (immovable, like a class or meeting) or `alive` (the thing you're doing right now).

## Viewer

The Canvas viewer at `http://localhost:7433` shows:

- A river flowing left to right, with a thin amber **now-line**
- Scheduled tasks as shapes in the current
- Unscheduled tasks floating in the **cloud** above
- Free time as warm, glowing gaps between tasks
- Plan mode with swim lanes when active

The viewer updates in real-time via SSE whenever Claude (or any MCP client) modifies the river.

## Design Principles

River is built around a few deliberate constraints:

- **No red.** No "overdue." No shame. Tasks that drift past now recirculate silently to the cloud.
- **No counts.** No "you have 23 tasks." The spatial layout gives you a felt sense of volume without a number to judge yourself by.
- **No productivity language.** No "productive," "efficient," or "optimize." The vocabulary is spatial: *flow, drift, float, settle, clear, open.*
- **Warm palette only.** Earth tones, watercolors, amber, muted colors. The viewer should feel like a landscape, not a spreadsheet.
- **Commitment is a gradient.** A task at 0.1 solidity is barely a thought. At 0.9 it's locked in. There's no moment where scheduling becomes a promise you'll break.

## Tech Stack

TypeScript, `@modelcontextprotocol/sdk`, `better-sqlite3`, Zod. Vanilla HTML Canvas 2D viewer (no framework, no build step). Built with `tsup`, developed with `tsx`, tested with `vitest`.

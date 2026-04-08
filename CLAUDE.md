# River — Autonomous Build Protocol

## What This Is
A physics-based spatial task scheduling MCP server + web viewer. See the design spec and implementation plan for full details.

## Key Files
- **Design Spec:** `~/OneDrive/Obsidian Vault/Planning/APRIL/River - Design Spec.md`
- **Implementation Plan:** `~/OneDrive/Obsidian Vault/Planning/APRIL/River - Implementation Plan.md`
- **Progress:** `PROGRESS.md` (this repo)

## Build Rules
- Commit after every meaningful unit of work
- Update PROGRESS.md after each major milestone
- Write PROGRESS.md assuming the next reader has ZERO context
- Each teammate should own different files to avoid conflicts — see the parallelization guide in the implementation plan
- Test with `pnpm test` after writing state layer code
- Test the viewer by opening http://localhost:7433 after starting with `pnpm dev`

## Tech Stack
- TypeScript, @modelcontextprotocol/sdk, better-sqlite3, Zod
- Vanilla HTML Canvas 2D viewer (no framework, no build step)
- tsup for build, tsx for dev, vitest for tests
- pnpm as package manager

## MCP SDK API (verified April 2026)
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'river', version: '0.1.0' });

// v2 API — registerTool with inputSchema as raw Zod shape
server.registerTool('tool_name', {
  description: '...',
  inputSchema: {
    field: z.string().describe('...'),
  },
}, async (args) => ({
  content: [{ type: 'text', text: JSON.stringify(result) }],
}));

const transport = new StdioServerTransport();
await server.connect(transport);
// IMPORTANT: use console.error for logging — stdout is reserved for MCP protocol
```

## Emotional Design Constraints (CRITICAL)
The viewer and any text output must follow these rules:
- NO red, NO "overdue", NO counts of tasks, NO streaks
- NO productivity language ("productive", "efficient", "optimize")
- Warm palette only: earth tones, watercolors, amber, muted
- Commitment is a 0-1 gradient (solidity), never binary
- Tasks that drift past "now" recirculate silently — no shame

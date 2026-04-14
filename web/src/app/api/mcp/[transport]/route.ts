import { AsyncLocalStorage } from 'node:async_hooks'
import { createMcpHandler } from 'mcp-handler'
import { resolveUser, type McpUser } from '@/lib/mcp/auth'
import { registerRiverTools } from '@/lib/mcp/tools'

// Request-scoped user context via AsyncLocalStorage (safe for concurrent requests)
const userStore = new AsyncLocalStorage<McpUser>()

const getUser = (): McpUser => {
  const user = userStore.getStore()
  if (!user) throw new Error('Not authenticated')
  return user
}

const handler = createMcpHandler(
  (server) => {
    // ── Context Resource ───────────────────────────────────────
    server.resource(
      'river_context',
      'river://context',
      {
        description: 'Overview of River — what it is and how to use it',
        mimeType: 'text/markdown',
      },
      async () => ({
        contents: [
          {
            uri: 'river://context',
            mimeType: 'text/markdown',
            text: RIVER_CONTEXT,
          },
        ],
      }),
    )

    // ── River Tools ────────────────────────────────────────────
    registerRiverTools(server, getUser)
  },
  {
    capabilities: { logging: {}, resources: {} },
    serverInfo: { name: 'river', version: '0.5.0' },
  },
  {
    basePath: '/api/mcp',
    maxDuration: 60,
    redisUrl: process.env.REDIS_URL || process.env.KV_URL,
    disableSse: !process.env.REDIS_URL && !process.env.KV_URL,
    verboseLogs: process.env.NODE_ENV !== 'production',
  },
)

// Auth wrapper: resolve user, run MCP handler within request-scoped context
async function authHandler(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  }

  const user = await resolveUser(authHeader.slice(7))
  if (!user) {
    return new Response(JSON.stringify({ error: 'invalid api key' }), { status: 401 })
  }

  return userStore.run(user, () => handler(req))
}

export { authHandler as GET, authHandler as POST, authHandler as DELETE }
export const maxDuration = 60

const RIVER_CONTEXT = `# River — Physics-Based Spatial Task Scheduler

## What is River?

River is a task scheduling tool where time is a river, not a grid. Tasks are organic shapes that drift in a current — big ones take up space, committed ones are vivid, maybes are wisps. Nothing is overdue. Nothing judges you.

## Task Dimensions

Every task has three visual dimensions:
- **Duration** (mass): Minutes. Controls horizontal size.
- **Commitment** (solidity): 0–1 gradient. Wisp at 0.1, crystalline at 0.9.
- **Energy** (energy): 0–1. Color temperature: cool/blue (low) → warm/amber (mid) → hot/red (high).

Position is hours from now. Positive = future, null = cloud (unscheduled).

## Available Tools

- **look** — See the current state of the river and cloud
- **put** — Create or update tasks
- **move** — Reposition tasks in time
- **sweep** — Delete tasks
- **plan** — Enter plan mode to explore alternative arrangements
- **branch** — Manage tags

## Design Principles

- No red. No "overdue." No shame.
- Commitment is a gradient, not a promise.
- Tasks that drift past now recirculate silently to the cloud.
- Vocabulary is spatial: flow, drift, float, settle, clear, open.
`

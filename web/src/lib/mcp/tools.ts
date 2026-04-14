// Remote MCP tools — registers all 6 River tools against a WebState instance
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebState } from '@/lib/river/state'
import { taskWithPosition } from '@/lib/river/schema'
import type { McpUser } from './auth'
import { createClient } from '@supabase/supabase-js'

function createServiceState(user: McpUser): WebState {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  return new WebState(supabase, user.id)
}

export function registerRiverTools(
  server: McpServer,
  getUser: () => McpUser,
): void {
  // ── look ──────────────────────────────────────────────────────
  server.registerTool(
    'look',
    {
      description:
        'See the river. Returns tasks in the river (scheduled) and cloud (unscheduled), ' +
        'plus breathing room (free minutes in next 4h and rest of day).',
      inputSchema: {
        horizon: z.number().positive().optional().describe('Only show river tasks within this many hours from now'),
        id: z.string().optional().describe('Look up a single task by ID'),
        cloud: z.boolean().optional().describe('If true, only return cloud tasks'),
      },
    },
    async (args) => {
      const state = createServiceState(getUser())
      await state.ensureUser()
      const result = await state.look({ horizon: args.horizon, id: args.id, cloud: args.cloud })
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  // ── put ────────────────────────────────────────────────────────
  server.registerTool(
    'put',
    {
      description:
        'Create or update tasks. Omit `id` to create; include `id` to update. ' +
        'Position is hours from now (null = cloud, unscheduled). ' +
        'Tasks can overlap — leave breathing room between focused tasks.',
      inputSchema: {
        id: z.string().optional().describe('Task ID — omit to create, include to update'),
        name: z.string().optional().describe('Task name (required when creating)'),
        mass: z.number().positive().optional().describe('Duration in minutes (default 30)'),
        position: z.number().nullable().optional().describe('Hours from now (null = cloud)'),
        solidity: z.number().min(0).max(1).optional().describe('Commitment 0-1 (default 0.1)'),
        energy: z.number().min(0).max(1).optional().describe('Energy 0-1 (0=autopilot, 1=deep focus)'),
        fixed: z.boolean().optional().describe('If true, task never recirculates'),
        alive: z.boolean().optional().describe('Mark as currently active task'),
        tags: z.array(z.string()).optional().describe('Freeform tags'),
        cloud_x: z.number().min(0).max(1).nullable().optional().describe('Cloud X position 0-1'),
        cloud_y: z.number().min(0).max(1).nullable().optional().describe('Cloud Y position 0-1'),
        river_y: z.number().min(0).max(1).nullable().optional().describe('River Y position 0-1'),
      },
    },
    async (args) => {
      const state = createServiceState(getUser())
      await state.ensureUser()
      const task = await state.putTask(args)
      if (args.tags) await state.ensureTaskTags(args.tags)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(taskWithPosition(task), null, 2) }],
      }
    },
  )

  // ── move ───────────────────────────────────────────────────────
  server.registerTool(
    'move',
    {
      description:
        'Move a task in time. Position is hours from now (null = send to cloud).',
      inputSchema: {
        id: z.string().describe('Task ID to move'),
        position: z.number().nullable().describe('Hours from now (null = cloud)'),
      },
    },
    async (args) => {
      const state = createServiceState(getUser())
      await state.ensureUser()
      await state.moveTask(args.id, args.position)
      return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, id: args.id, position: args.position }) }] }
    },
  )

  // ── sweep ─────────────────────────────────────────────────────
  server.registerTool(
    'sweep',
    {
      description:
        'Delete a task by ID.',
      inputSchema: {
        id: z.string().describe('Task ID to delete'),
      },
    },
    async (args) => {
      const state = createServiceState(getUser())
      await state.ensureUser()
      await state.deleteTask(args.id)
      return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, deleted: args.id }) }] }
    },
  )

  // ── plan ───────────────────────────────────────────────────────
  server.registerTool(
    'plan',
    {
      description:
        'Plan mode — explore different arrangements for a time window.\n' +
        'Actions: start, commit, end, status.\n' +
        '- start: Enter plan mode with window_start/window_end ISO timestamps\n' +
        '- commit: Accept a lane (2-4), replacing main tasks in the window\n' +
        '- end: Exit plan mode without committing\n' +
        '- status: Check current plan state',
      inputSchema: {
        action: z.enum(['start', 'commit', 'end', 'status']).describe('Plan operation'),
        window_start: z.string().optional().describe('ISO timestamp for plan window start'),
        window_end: z.string().optional().describe('ISO timestamp for plan window end'),
        lane: z.number().int().min(1).max(4).optional().describe('Lane number for commit (2-4, lane 1 is read-only)'),
      },
    },
    async (args) => {
      const state = createServiceState(getUser())
      await state.ensureUser()

      try {
        let result: unknown
        switch (args.action) {
          case 'start':
            if (!args.window_start || !args.window_end) {
              return { content: [{ type: 'text' as const, text: 'window_start and window_end required' }], isError: true }
            }
            await state.startPlan(args.window_start, args.window_end)
            result = await state.getPlanState()
            break
          case 'commit':
            if (!args.lane) {
              return { content: [{ type: 'text' as const, text: 'lane required for commit' }], isError: true }
            }
            await state.commitLane(args.lane)
            result = { committed: args.lane }
            break
          case 'end':
            await state.endPlan()
            result = { ended: true }
            break
          case 'status':
            result = await state.getPlanState()
            break
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
      } catch (err) {
        return { content: [{ type: 'text' as const, text: String(err) }], isError: true }
      }
    },
  )

  // ── clear ─────────────────────────────────────────────────────
  server.registerTool(
    'clear',
    {
      description:
        'Wipe all tasks, or all tasks within a time window. ' +
        'If no args, clears everything. If start and/or end (hours from now) ' +
        'are provided, only clears river tasks in that window.',
      inputSchema: {
        start: z.number().optional().describe('Start of time window in hours from now'),
        end: z.number().optional().describe('End of time window in hours from now'),
      },
    },
    async (args) => {
      const state = createServiceState(getUser())
      await state.ensureUser()
      const timeRange =
        args.start !== undefined || args.end !== undefined
          ? { start: args.start, end: args.end }
          : undefined
      const count = await state.clear(timeRange)
      return { content: [{ type: 'text' as const, text: JSON.stringify({ cleared: count }, null, 2) }] }
    },
  )

  // ── bulk_sweep ────────────────────────────────────────────────
  server.registerTool(
    'bulk_sweep',
    {
      description: 'Batch delete tasks by ID array. Deletes all tasks whose IDs are in the array.',
      inputSchema: {
        ids: z.array(z.string()).describe('Array of task IDs to delete'),
      },
    },
    async (args) => {
      const state = createServiceState(getUser())
      await state.ensureUser()
      const count = await state.bulkSweep(args.ids)
      return { content: [{ type: 'text' as const, text: JSON.stringify({ deleted: count, requested: args.ids.length }, null, 2) }] }
    },
  )

  // ── rename ────────────────────────────────────────────────────
  server.registerTool(
    'rename',
    {
      description: 'Edit a task name after creation.',
      inputSchema: {
        id: z.string().describe('Task ID to rename'),
        name: z.string().describe('New name for the task'),
      },
    },
    async (args) => {
      const state = createServiceState(getUser())
      await state.ensureUser()
      const task = await state.rename(args.id, args.name)
      return { content: [{ type: 'text' as const, text: JSON.stringify(taskWithPosition(task), null, 2) }] }
    },
  )

  // ── tag ───────────────────────────────────────────────────────
  server.registerTool(
    'tag',
    {
      description: 'Add or remove tags from a task without touching anything else.',
      inputSchema: {
        id: z.string().describe('Task ID to tag/untag'),
        tags: z.array(z.string()).describe('Tags to add or remove'),
        action: z.enum(['add', 'remove']).describe('Whether to add or remove the specified tags'),
      },
    },
    async (args) => {
      const state = createServiceState(getUser())
      await state.ensureUser()
      const task = await state.tag(args.id, args.tags, args.action)
      if (args.action === 'add') await state.ensureTaskTags(args.tags)
      return { content: [{ type: 'text' as const, text: JSON.stringify(taskWithPosition(task), null, 2) }] }
    },
  )

  // ── stats ─────────────────────────────────────────────────────
  server.registerTool(
    'stats',
    {
      description:
        'Get summary statistics: total task count, river vs cloud count, ' +
        'tag distribution, average solidity, average energy, and breathing room.',
      inputSchema: {},
    },
    async () => {
      const state = createServiceState(getUser())
      await state.ensureUser()
      const result = await state.stats()
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  // ── branch ────────────────────────────────────────────────────
  server.registerTool(
    'branch',
    {
      description: 'Tag management — create new tags.',
      inputSchema: {
        tag: z.string().describe('Tag name to create'),
      },
    },
    async (args) => {
      const state = createServiceState(getUser())
      await state.ensureUser()
      await state.addKnownTag(args.tag)
      return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, tag: args.tag }) }] }
    },
  )
}

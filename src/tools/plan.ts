import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RiverState } from '../state.js';
import { PlanTaskSchema } from '../schema.js';

export function registerPlan(server: McpServer, state: RiverState): void {
  server.registerTool(
    'plan',
    {
      description:
        'Plan mode — explore different arrangements for a specific time window.\n\n' +
        'Actions:\n' +
        '- start: Enter plan mode. Provide window_start and window_end as ISO timestamps.\n' +
        '  Lane 1 auto-fills with current river tasks in that window (read-only reference).\n' +
        '  Lanes 2-4 start empty.\n' +
        '- fill: Populate a lane (2-4) with tasks. Lane 1 is read-only.\n' +
        '- name: Give a lane a label describing its philosophy.\n' +
        '- commit: Accept a lane — replaces ONLY main tasks within the plan window. Everything outside is untouched.\n' +
        '- end: Exit plan mode without committing.\n' +
        '- status: Check current plan state (window, lanes).\n\n' +
        'IMPORTANT guidance for Claude:\n' +
        '- Use "status" first to see lane 1 (the current arrangement) before generating alternatives.\n' +
        '- Ask clarifying questions BEFORE generating alternatives.\n' +
        '- Generate genuinely DIFFERENT approaches in lanes 2-4, not permutations.\n' +
        '  Each lane should embody a different philosophy.\n' +
        '- Name each lane with its philosophy.\n' +
        '- NEVER fill lane 1 — it is the user\'s current plan as reference.',
      inputSchema: {
        action: z
          .enum(['start', 'fill', 'name', 'commit', 'end', 'status'])
          .describe('Plan operation to perform'),
        window_start: z
          .string()
          .optional()
          .describe('ISO timestamp for plan window start (required for "start")'),
        window_end: z
          .string()
          .optional()
          .describe('ISO timestamp for plan window end (required for "start")'),
        lane: z
          .number()
          .int()
          .min(1)
          .max(4)
          .optional()
          .describe('Lane number 1-4. Lane 1 is read-only. Required for fill, name, commit.'),
        label: z
          .string()
          .optional()
          .describe('Human-readable label for the lane philosophy (required for "name")'),
        tasks: z
          .array(PlanTaskSchema)
          .optional()
          .describe('Tasks to populate the lane with (required for "fill"). Each task: { name, mass?, position?, solidity?, energy?, fixed?, tags? }'),
      },
    },
    async (args) => {
      try {
        let result: unknown;

        switch (args.action) {
          case 'start': {
            if (!args.window_start || !args.window_end) {
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({ error: 'window_start and window_end (ISO timestamps) are required for start' }) }],
                isError: true,
              };
            }
            result = state.startPlan(args.window_start, args.window_end);
            state.notify();
            break;
          }

          case 'fill': {
            if (args.lane === undefined) {
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Lane number (2-4) is required for fill. Lane 1 is read-only.' }) }],
                isError: true,
              };
            }
            if (!args.tasks || args.tasks.length === 0) {
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Tasks array is required for fill' }) }],
                isError: true,
              };
            }
            result = state.fillLane(args.lane, args.tasks);
            state.notify();
            break;
          }

          case 'name': {
            if (args.lane === undefined) {
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Lane number is required for name' }) }],
                isError: true,
              };
            }
            if (!args.label) {
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Label is required for name' }) }],
                isError: true,
              };
            }
            result = state.nameLane(args.lane, args.label);
            state.notify();
            break;
          }

          case 'commit': {
            if (args.lane === undefined) {
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Lane number (2-4) is required for commit. Lane 1 is read-only.' }) }],
                isError: true,
              };
            }
            result = state.commitLane(args.lane);
            state.notify();
            break;
          }

          case 'end': {
            result = state.endPlan();
            state.notify();
            break;
          }

          case 'status': {
            result = state.getPlanState();
            break;
          }
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }],
          isError: true,
        };
      }
    },
  );
}

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RiverState } from '../state.js';
import { PLAN_TIMEFRAMES, PlanTaskSchema } from '../schema.js';

export function registerPlan(server: McpServer, state: RiverState): void {
  server.registerTool(
    'plan',
    {
      description:
        'Plan mode — explore different arrangements of your time.\n\n' +
        'Actions:\n' +
        '- start: Enter plan mode with a timeframe. Creates 5 swim lanes.\n' +
        '- fill: Populate a lane (1-5) with tasks. Replaces existing tasks in that lane.\n' +
        '- name: Give a lane a human-readable label describing its philosophy.\n' +
        '- commit: Accept a lane — merges its tasks into main and exits plan mode.\n' +
        '- end: Exit plan mode without committing. All lanes are discarded.\n' +
        '- status: Check current plan state (active, timeframe, lanes).\n\n' +
        'IMPORTANT guidance for Claude when using plan mode:\n' +
        '- Ask clarifying questions BEFORE generating alternatives:\n' +
        '  "What are you trying to figure out?"\n' +
        '  "Anything you\'re considering that isn\'t in your cloud?"\n' +
        '  "Hard constraints — things that can\'t move?"\n' +
        '- Generate genuinely DIFFERENT approaches, not permutations.\n' +
        '  Each lane should embody a different philosophy (e.g., "focused blocks",\n' +
        '  "spacious day", "front-loaded", "energy-matched").\n' +
        '- Name each lane with its philosophy using the "name" action.\n' +
        '- Don\'t assume the user has listed everything — suggest things they haven\'t mentioned.\n' +
        '- Fill 3 lanes by default, leave lanes 4 and 5 empty for the user.\n' +
        '- Use "fill" to set complete task lists, not incremental adds.\n' +
        '- After filling lanes, summarize each approach briefly so the user can compare.',
      inputSchema: {
        action: z
          .enum(['start', 'fill', 'name', 'commit', 'end', 'status'])
          .describe('Plan operation to perform'),
        timeframe: z
          .enum(PLAN_TIMEFRAMES)
          .optional()
          .describe('Planning horizon (required for "start"): 6h, day, 4d, week, month, quarter, year'),
        lane: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe('Lane number 1-5 (required for fill, name, commit)'),
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
            if (!args.timeframe) {
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Timeframe is required for start (6h, day, 4d, week, month, quarter, year)' }) }],
                isError: true,
              };
            }
            result = state.startPlan(args.timeframe);
            state.notify();
            break;
          }

          case 'fill': {
            if (args.lane === undefined) {
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Lane number (1-5) is required for fill' }) }],
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
                content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Lane number (1-5) is required for name' }) }],
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
                content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Lane number (1-5) is required for commit' }) }],
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

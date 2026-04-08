import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RiverState } from '../state.js';
import { taskWithPosition } from '../schema.js';

export function registerMove(server: McpServer, state: RiverState): void {
  server.registerTool(
    'move',
    {
      description:
        'Move tasks in time. Three modes:\n' +
        '1. Single absolute: `id` + `position` (hours from now, null = send to cloud)\n' +
        '2. Single relative: `id` + `shift` (relative hours, e.g. +2 = two hours later)\n' +
        '3. Batch relative: `ids` + `shift` (shift multiple tasks by the same amount)',
      inputSchema: {
        id: z.string().optional().describe('Single task ID to move'),
        ids: z.array(z.string()).optional().describe('Array of task IDs for batch shift'),
        position: z
          .number()
          .nullable()
          .optional()
          .describe('Absolute position in hours from now (null = cloud). Use with `id`.'),
        shift: z
          .number()
          .optional()
          .describe('Relative shift in hours (e.g. +2 = later, -1 = earlier). Use with `id` or `ids`.'),
      },
    },
    async (args) => {
      let results;

      if (args.ids && args.shift !== undefined) {
        // Batch relative move
        const tasks = state.moveTasks(args.ids, args.shift);
        results = tasks.map(taskWithPosition);
      } else if (args.id && args.shift !== undefined && args.position === undefined) {
        // Single relative move — compute new absolute position from current anchor
        const tasks = state.moveTasks([args.id], args.shift);
        results = tasks.map(taskWithPosition);
      } else if (args.id && args.position !== undefined) {
        // Single absolute move
        const task = state.moveTask(args.id, args.position);
        results = [taskWithPosition(task)];
      } else {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error:
                  'Provide `id` + `position`, `id` + `shift`, or `ids` + `shift`.',
              }),
            },
          ],
          isError: true,
        };
      }

      state.notify();

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              results.length === 1 ? results[0] : results,
              null,
              2
            ),
          },
        ],
      };
    }
  );
}

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RiverState } from '../state.js';

export function registerClear(server: McpServer, state: RiverState): void {
  server.registerTool(
    'clear',
    {
      description:
        'Wipe all tasks, or all tasks within a time window. ' +
        'If no args, clears everything. If start and/or end (hours from now) ' +
        'are provided, only clears river tasks in that window.',
      inputSchema: {
        start: z
          .number()
          .optional()
          .describe('Start of time window in hours from now'),
        end: z
          .number()
          .optional()
          .describe('End of time window in hours from now'),
      },
    },
    async (args) => {
      const timeRange =
        args.start !== undefined || args.end !== undefined
          ? { start: args.start, end: args.end }
          : undefined;

      const count = state.clear(timeRange);
      state.notify();

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ cleared: count }, null, 2),
          },
        ],
      };
    }
  );
}

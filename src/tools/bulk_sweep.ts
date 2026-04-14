import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RiverState } from '../state.js';

export function registerBulkSweep(server: McpServer, state: RiverState): void {
  server.registerTool(
    'bulk_sweep',
    {
      description: 'Batch delete tasks by ID array. Deletes all tasks whose IDs are in the array.',
      inputSchema: {
        ids: z.array(z.string()).describe('Array of task IDs to delete'),
      },
    },
    async (args) => {
      const count = state.bulkSweep(args.ids);
      state.notify();

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ deleted: count, requested: args.ids.length }, null, 2),
          },
        ],
      };
    }
  );
}

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RiverState } from '../state.js';

export function registerLook(server: McpServer, state: RiverState): void {
  server.registerTool(
    'look',
    {
      description:
        'See the river. Returns tasks in the river (scheduled) and cloud (unscheduled), ' +
        'plus breathing room (free minutes in next 4h and rest of day). ' +
        'Optionally filter by horizon, single task ID, or cloud-only.',
      inputSchema: {
        horizon: z
          .number()
          .positive()
          .optional()
          .describe('Only show river tasks within this many hours from now'),
        id: z.string().optional().describe('Look up a single task by ID'),
        cloud: z
          .boolean()
          .optional()
          .describe('If true, only return cloud (unscheduled) tasks'),
      },
    },
    async (args) => {
      const result = state.look({
        horizon: args.horizon,
        id: args.id,
        cloud: args.cloud,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );
}

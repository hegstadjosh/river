import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RiverState } from '../state.js';
import { taskWithPosition } from '../schema.js';

export function registerRename(server: McpServer, state: RiverState): void {
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
      const task = state.rename(args.id, args.name);
      state.notify();

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(taskWithPosition(task), null, 2),
          },
        ],
      };
    }
  );
}

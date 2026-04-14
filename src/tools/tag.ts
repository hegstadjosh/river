import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RiverState } from '../state.js';
import { taskWithPosition } from '../schema.js';

export function registerTag(server: McpServer, state: RiverState): void {
  server.registerTool(
    'tag',
    {
      description:
        'Add or remove tags from a task without touching anything else.',
      inputSchema: {
        id: z.string().describe('Task ID to tag/untag'),
        tags: z.array(z.string()).describe('Tags to add or remove'),
        action: z
          .enum(['add', 'remove'])
          .describe('Whether to add or remove the specified tags'),
      },
    },
    async (args) => {
      const task = state.tag(args.id, args.tags, args.action);

      // If adding tags, also register them as known tags
      if (args.action === 'add') {
        state.ensureTaskTags(args.tags);
      }

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

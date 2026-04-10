import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RiverState } from '../state.js';
import { PutSingleSchema, taskWithPosition } from '../schema.js';

export function registerPut(server: McpServer, state: RiverState): void {
  server.registerTool(
    'put',
    {
      description:
        'Create or update tasks. Pass a single task inline, or a `tasks` array for batch operations. ' +
        'Omit `id` to create; include `id` to update. ' +
        'Position is hours from now (null = cloud, unscheduled). ' +
        'Tasks can overlap in time — small tasks or multitaskable things (listening to a podcast while cooking) ' +
        'can share the same time slot. Leave breathing room between focused tasks. ' +
        'Ask the user what they\'re considering before arranging — don\'t assume they\'ve listed everything.',
      inputSchema: {
        // Single-task fields (flat)
        id: z.string().optional().describe('Task ID — omit to create, include to update'),
        name: z.string().optional().describe('Task name (required when creating)'),
        mass: z.number().positive().optional().describe('Duration in minutes (default 30)'),
        position: z
          .number()
          .nullable()
          .optional()
          .describe('Hours from now to place the task (null = cloud)'),
        solidity: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe('Commitment gradient 0-1 (default 0.1)'),
        energy: z.number().min(0).max(1).optional().describe('Cognitive energy required 0-1 (0=autopilot, 1=deep focus). Affects color: blue(low) → amber(mid) → red(high)'),
        fixed: z.boolean().optional().describe('If true, task never recirculates'),
        alive: z.boolean().optional().describe('Mark as the currently active task'),
        tags: z.array(z.string()).optional().describe('Freeform tags'),
        cloud_x: z.number().min(0).max(1).nullable().optional().describe('Cloud zone X position 0-1 (left to right). Use to arrange cloud tasks spatially.'),
        cloud_y: z.number().min(0).max(1).nullable().optional().describe('Cloud zone Y position 0-1 (top to bottom). Use to arrange cloud tasks spatially.'),
        river_y: z.number().min(0).max(1).nullable().optional().describe('River zone Y position 0-1 (top to bottom). Use to arrange river tasks vertically.'),

        // Batch
        tasks: z
          .array(PutSingleSchema)
          .optional()
          .describe('Array of tasks for batch create/update'),
      },
    },
    async (args) => {
      const results = [];

      if (args.tasks && args.tasks.length > 0) {
        // Batch mode
        for (const taskInput of args.tasks) {
          const task = state.putTask(taskInput);
          results.push(taskWithPosition(task));
        }
      } else {
        // Single mode — pull fields from top-level args
        const task = state.putTask({
          id: args.id,
          name: args.name,
          mass: args.mass,
          position: args.position,
          solidity: args.solidity,
          fixed: args.fixed,
          alive: args.alive,
          tags: args.tags,
          cloud_x: args.cloud_x,
          cloud_y: args.cloud_y,
          river_y: args.river_y,
        });
        results.push(taskWithPosition(task));
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

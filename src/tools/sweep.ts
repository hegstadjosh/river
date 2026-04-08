import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RiverState } from '../state.js';
import { SweepFilterSchema } from '../schema.js';

export function registerSweep(server: McpServer, state: RiverState): void {
  server.registerTool(
    'sweep',
    {
      description:
        'Bulk-modify tasks matching a filter. Actions:\n' +
        '- shift: move matching river tasks by `shift` hours\n' +
        '- set: update `solidity`, `mass`, or `position` on matching tasks\n' +
        '- remove: delete matching tasks\n' +
        'Filter narrows which tasks are affected.',
      inputSchema: {
        filter: SweepFilterSchema.optional().describe(
          'Filter criteria: in_river, cloud, solidity_above, solidity_below, tag, fixed, id_not, alive'
        ),
        action: z
          .enum(['shift', 'set', 'remove'])
          .describe('What to do with matching tasks'),
        shift: z
          .number()
          .optional()
          .describe('Hours to shift (for action=shift)'),
        solidity: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe('New solidity value (for action=set)'),
        mass: z
          .number()
          .positive()
          .optional()
          .describe('New mass/duration in minutes (for action=set)'),
        position: z
          .number()
          .nullable()
          .optional()
          .describe('New position in hours from now, null = cloud (for action=set)'),
      },
    },
    async (args) => {
      const filter = args.filter ?? {};
      const count = state.sweep(filter, args.action, {
        shift: args.shift,
        solidity: args.solidity,
        mass: args.mass,
        position: args.position,
      });

      state.notify();

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { action: args.action, affected: count },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}

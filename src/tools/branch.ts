import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RiverState } from '../state.js';

export function registerBranch(server: McpServer, state: RiverState): void {
  server.registerTool(
    'branch',
    {
      description:
        'Manage timeline branches. Actions:\n' +
        '- create: fork current timeline into a named branch\n' +
        '- list: show all branches\n' +
        '- switch: change active branch\n' +
        '- commit: merge branch back into its parent\n' +
        '- diff: compare two branches (use `a` and `b`, or defaults to current vs named)\n' +
        '- delete: remove a branch',
      inputSchema: {
        action: z
          .enum(['create', 'list', 'switch', 'commit', 'diff', 'delete'])
          .describe('Branch operation to perform'),
        name: z
          .string()
          .optional()
          .describe('Branch name (required for create, switch, commit, delete)'),
        a: z
          .string()
          .optional()
          .describe('First branch name for diff (defaults to "current")'),
        b: z
          .string()
          .optional()
          .describe('Second branch name for diff'),
      },
    },
    async (args) => {
      let result: unknown;

      switch (args.action) {
        case 'create': {
          if (!args.name) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Branch name is required for create' }) }],
              isError: true,
            };
          }
          result = state.createBranch(args.name);
          state.notify();
          break;
        }

        case 'list': {
          result = state.listBranches();
          break;
        }

        case 'switch': {
          if (!args.name) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Branch name is required for switch' }) }],
              isError: true,
            };
          }
          state.switchBranch(args.name);
          state.notify();
          result = { switched: args.name, timeline: state.getCurrentTimeline() };
          break;
        }

        case 'commit': {
          if (!args.name) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Branch name is required for commit' }) }],
              isError: true,
            };
          }
          state.commitBranch(args.name);
          state.notify();
          result = { committed: args.name, timeline: state.getCurrentTimeline() };
          break;
        }

        case 'diff': {
          const a = args.a ?? 'current';
          const b = args.b ?? args.name;
          if (!b) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Provide `b` (or `name`) for the branch to diff against' }) }],
              isError: true,
            };
          }
          result = state.diffBranches(a, b);
          break;
        }

        case 'delete': {
          if (!args.name) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Branch name is required for delete' }) }],
              isError: true,
            };
          }
          state.deleteBranch(args.name);
          state.notify();
          result = { deleted: args.name };
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
    }
  );
}

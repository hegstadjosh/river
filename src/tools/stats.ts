import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RiverState } from '../state.js';

export function registerStats(server: McpServer, state: RiverState): void {
  server.registerTool(
    'stats',
    {
      description:
        'Get summary statistics: total task count, river vs cloud count, ' +
        'tag distribution, average solidity, average energy, and breathing room.',
      inputSchema: {},
    },
    async () => {
      const result = state.stats();

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

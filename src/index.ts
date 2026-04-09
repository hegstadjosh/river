import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { RiverState } from './state.js';
import { HTTP_PORT, DB_DIR } from './schema.js';
import { createHttpServer } from './http.js';
import { registerPut } from './tools/put.js';
import { registerMove } from './tools/move.js';
import { registerLook } from './tools/look.js';
import { registerBranch } from './tools/branch.js';
import { registerSweep } from './tools/sweep.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const dbDir = join(homedir(), DB_DIR);
  const state = new RiverState(dbDir);

  const mcpServer = new McpServer({
    name: 'river',
    version: '0.1.0',
  });

  registerPut(mcpServer, state);
  registerMove(mcpServer, state);
  registerLook(mcpServer, state);
  registerBranch(mcpServer, state);
  registerSweep(mcpServer, state);

  // Connect MCP FIRST — Claude Code needs the handshake immediately
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error('River MCP server running on stdio');

  // Start HTTP server for viewer AFTER MCP is connected
  const viewerDir = join(__dirname, '..', 'viewer');
  const httpServer = createHttpServer(state, viewerDir);

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${HTTP_PORT} in use, trying ${HTTP_PORT + 1}...`);
      httpServer.listen(HTTP_PORT + 1, () => {
        console.error(`River viewer: http://localhost:${HTTP_PORT + 1}`);
      });
    }
  });

  httpServer.listen(HTTP_PORT, () => {
    console.error(`River viewer: http://localhost:${HTTP_PORT}`);
  });

  process.on('SIGINT', () => { state.close(); httpServer.close(); process.exit(0); });
  process.on('SIGTERM', () => { state.close(); httpServer.close(); process.exit(0); });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

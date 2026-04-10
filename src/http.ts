import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { type RiverState } from './state.js';
import { HTTP_PORT } from './schema.js';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
};

export function createHttpServer(state: RiverState, viewerDir: string): Server {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';

    // CORS headers for local dev
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // SSE endpoint
    if (url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      // Send initial state
      const initialData = JSON.stringify(state.look());
      res.write(`data: ${initialData}\n\n`);

      state.addSSEClient(res);

      req.on('close', () => {
        // Cleanup handled by state.addSSEClient
      });
      return;
    }

    // POST /state — viewer mutations
    if (req.method === 'POST' && url === '/state') {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);

          if (data.action === 'move') {
            state.moveTask(data.id, data.position);
          } else if (data.action === 'put') {
            const { action, ...rest } = data;
            state.putTask(rest);
          } else if (data.action === 'delete') {
            state.deleteTask(data.id);
          }

          state.notify();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
      return;
    }

    // GET /state — read current state
    if (url === '/state') {
      const data = JSON.stringify(state.look());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
      return;
    }

    // GET /plan — plan mode state with lane task details
    if (url === '/plan') {
      const planState = state.getPlanState();
      if (planState.active) {
        const lanes = planState.lanes.map((lane) => {
          const tasks = state.getLaneTasks(lane.number);
          return {
            ...lane,
            river: tasks.river,
            cloud: tasks.cloud,
          };
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...planState, lanes }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(planState));
      }
      return;
    }

    // Static file serving for viewer
    let filePath = url === '/' ? '/index.html' : url;
    const fullPath = join(viewerDir, filePath);

    if (!existsSync(fullPath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = extname(fullPath);
    const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
    const content = readFileSync(fullPath);

    res.writeHead(200, { 'Content-Type': mime });
    res.end(content);
  });

  return server;
}

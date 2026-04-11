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
          } else if (data.action === 'plan_start') {
            state.startPlan(data.window_start, data.window_end);
          } else if (data.action === 'plan_end') {
            state.endPlan();
          } else if (data.action === 'plan_commit') {
            // "Use this" button — commit a lane's arrangement to the main river
            // Viewer uses 0-indexed lanes, server uses 1-indexed
            state.commitLane((data.lane ?? 0) + 1);
          } else if (data.action === 'plan_lane_put') {
            // Create a new task directly in a lane (double-click in plan mode)
            state.putTaskInLane((data.lane ?? 0) + 1, data.name, data.position ?? null);
          } else if (data.action === 'plan_update_task') {
            state.updateTaskInLane((data.lane ?? 0) + 1, data.task_id, {
              mass: data.mass, solidity: data.solidity, energy: data.energy, position: data.position,
            });
          } else if (data.action === 'plan_to_cloud') {
            state.laneToCloud((data.lane ?? 0) + 1, data.task_id);
          } else if (data.action === 'plan_add') {
            // Viewer uses 0-indexed lanes, server uses 1-indexed
            state.addToLane((data.lane ?? 0) + 1, data.task_id, data.position ?? null, !!data.copy);
          } else if (data.action === 'plan_remove') {
            state.removeFromLane((data.lane ?? 0) + 1, data.task_id);
          } else if (data.action === 'plan_reposition') {
            state.repositionInLane((data.lane ?? 0) + 1, data.task_id, data.position);
          } else if (data.action === 'plan_move') {
            state.moveBetweenLanes((data.from_lane ?? 0) + 1, (data.to_lane ?? 0) + 1, data.task_id, data.position);
          } else if (data.action === 'plan_copy') {
            state.copyBetweenLanes((data.from_lane ?? 0) + 1, (data.to_lane ?? 0) + 1, data.task_id, data.position);
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

    // Static file serving for viewer — sanitize path to prevent traversal
    let filePath = url === '/' ? '/index.html' : url;
    const fullPath = join(viewerDir, filePath);
    if (!fullPath.startsWith(viewerDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

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

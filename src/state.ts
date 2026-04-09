import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { type ServerResponse } from 'http';
import {
  type Task,
  type TaskWithPosition,
  type Timeline,
  type LookResult,
  type BranchDiff,
  type PutSingleInput,
  taskWithPosition,
  positionToAnchor,
  anchorToPosition,
  DEFAULT_MASS,
  DEFAULT_SOLIDITY,
  DB_NAME,
} from './schema.js';

// ── Row types (SQLite stores booleans as 0/1, tags as JSON string) ───

interface TaskRow {
  id: string;
  timeline_id: string;
  name: string;
  mass: number;
  anchor: string | null;
  solidity: number;
  energy: number;
  fixed: number;
  alive: number;
  tags: string;
  created: string;
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    name: row.name,
    mass: row.mass,
    anchor: row.anchor,
    solidity: row.solidity,
    energy: row.energy,
    fixed: row.fixed === 1,
    alive: row.alive === 1,
    tags: JSON.parse(row.tags),
    created: row.created,
  };
}

// ── RiverState ───────────────────────────────────────────────────────

export class RiverState {
  private db: Database.Database;
  private sseClients: Set<ServerResponse> = new Set();

  constructor(dbDir: string) {
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }
    this.db = new Database(join(dbDir, DB_NAME));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS timelines (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        parent_id TEXT,
        created TEXT NOT NULL,
        committed_at TEXT,
        FOREIGN KEY (parent_id) REFERENCES timelines(id)
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        timeline_id TEXT NOT NULL,
        name TEXT NOT NULL,
        mass REAL NOT NULL DEFAULT ${DEFAULT_MASS},
        anchor TEXT,
        solidity REAL NOT NULL DEFAULT ${DEFAULT_SOLIDITY},
        energy REAL NOT NULL DEFAULT 0.5,
        fixed INTEGER NOT NULL DEFAULT 0,
        alive INTEGER NOT NULL DEFAULT 0,
        tags TEXT NOT NULL DEFAULT '[]',
        created TEXT NOT NULL,
        FOREIGN KEY (timeline_id) REFERENCES timelines(id)
      );

      CREATE TABLE IF NOT EXISTS timeline_tasks (
        timeline_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        name TEXT NOT NULL,
        mass REAL NOT NULL,
        anchor TEXT,
        solidity REAL NOT NULL,
        fixed INTEGER NOT NULL,
        alive INTEGER NOT NULL,
        tags TEXT NOT NULL,
        created TEXT NOT NULL,
        PRIMARY KEY (timeline_id, task_id),
        FOREIGN KEY (timeline_id) REFERENCES timelines(id)
      );

      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Ensure a default "main" timeline exists
    const existing = this.db
      .prepare('SELECT id FROM timelines WHERE name = ?')
      .get('main') as { id: string } | undefined;

    if (!existing) {
      const id = randomUUID();
      this.db
        .prepare('INSERT INTO timelines (id, name, created) VALUES (?, ?, ?)')
        .run(id, 'main', new Date().toISOString());
      this.db
        .prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
        .run('current_timeline_id', id);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────

  close() {
    this.db.close();
  }

  getTableNames(): string[] {
    const rows = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  private currentTimelineId(): string {
    const row = this.db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get('current_timeline_id') as { value: string };
    return row.value;
  }

  getCurrentTimeline(): Timeline {
    const id = this.currentTimelineId();
    return this.db
      .prepare('SELECT * FROM timelines WHERE id = ?')
      .get(id) as Timeline;
  }

  // ── Task CRUD ────────────────────────────────────────────────────

  putTask(input: PutSingleInput & { position?: number | null }): Task {
    const timelineId = this.currentTimelineId();

    // Convert position to anchor if provided
    let anchor: string | null | undefined = undefined;
    if (input.position !== undefined) {
      anchor = input.position === null ? null : positionToAnchor(input.position);
    }

    if (input.id) {
      // Update existing task
      const existing = this.db
        .prepare('SELECT * FROM tasks WHERE id = ? AND timeline_id = ?')
        .get(input.id, timelineId) as TaskRow | undefined;

      if (!existing) {
        throw new Error(`Task ${input.id} not found`);
      }

      // If setting alive=true, clear other alive tasks
      if (input.alive === true) {
        this.db
          .prepare('UPDATE tasks SET alive = 0 WHERE timeline_id = ? AND alive = 1')
          .run(timelineId);
      }

      const updates: string[] = [];
      const values: Record<string, unknown> = { id: input.id, tid: timelineId };

      if (input.name !== undefined) { updates.push('name = @name_val'); values.name_val = input.name; }
      if (input.mass !== undefined) { updates.push('mass = @mass_val'); values.mass_val = input.mass; }
      if (anchor !== undefined) { updates.push('anchor = @anchor_val'); values.anchor_val = anchor; }
      if (input.solidity !== undefined) { updates.push('solidity = @sol_val'); values.sol_val = input.solidity; }
      if (input.energy !== undefined) { updates.push('energy = @energy_val'); values.energy_val = input.energy; }
      if (input.fixed !== undefined) { updates.push('fixed = @fixed_val'); values.fixed_val = input.fixed ? 1 : 0; }
      if (input.alive !== undefined) { updates.push('alive = @alive_val'); values.alive_val = input.alive ? 1 : 0; }
      if (input.tags !== undefined) { updates.push('tags = @tags_val'); values.tags_val = JSON.stringify(input.tags); }

      if (updates.length > 0) {
        this.db
          .prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = @id AND timeline_id = @tid`)
          .run(values);
      }

      return this.getTask(input.id)!;
    } else {
      // Create new task
      if (!input.name) {
        throw new Error('Name is required when creating a task');
      }

      // If setting alive=true, clear other alive tasks
      if (input.alive === true) {
        this.db
          .prepare('UPDATE tasks SET alive = 0 WHERE timeline_id = ? AND alive = 1')
          .run(timelineId);
      }

      const id = randomUUID();
      const task: TaskRow = {
        id,
        timeline_id: timelineId,
        name: input.name,
        mass: input.mass ?? DEFAULT_MASS,
        anchor: anchor ?? null,
        solidity: input.solidity ?? DEFAULT_SOLIDITY,
        energy: input.energy ?? 0.5,
        fixed: (input.fixed ?? false) ? 1 : 0,
        alive: (input.alive ?? false) ? 1 : 0,
        tags: JSON.stringify(input.tags ?? []),
        created: new Date().toISOString(),
      };

      this.db
        .prepare(
          `INSERT INTO tasks (id, timeline_id, name, mass, anchor, solidity, energy, fixed, alive, tags, created)
           VALUES (@id, @timeline_id, @name, @mass, @anchor, @solidity, @energy, @fixed, @alive, @tags, @created)`
        )
        .run(task);

      return rowToTask(task);
    }
  }

  getTask(id: string): Task | null {
    const timelineId = this.currentTimelineId();
    const row = this.db
      .prepare('SELECT * FROM tasks WHERE id = ? AND timeline_id = ?')
      .get(id, timelineId) as TaskRow | undefined;
    return row ? rowToTask(row) : null;
  }

  deleteTask(id: string): void {
    const timelineId = this.currentTimelineId();
    this.db
      .prepare('DELETE FROM tasks WHERE id = ? AND timeline_id = ?')
      .run(id, timelineId);
  }

  // ── Move ─────────────────────────────────────────────────────────

  moveTask(id: string, position: number | null): Task {
    const anchor = position === null ? null : positionToAnchor(position);
    const timelineId = this.currentTimelineId();
    this.db
      .prepare('UPDATE tasks SET anchor = ? WHERE id = ? AND timeline_id = ?')
      .run(anchor, id, timelineId);
    const task = this.getTask(id);
    if (!task) throw new Error(`Task ${id} not found`);
    return task;
  }

  moveTasks(ids: string[], shift: number): Task[] {
    const timelineId = this.currentTimelineId();
    const shiftMs = shift * 3_600_000;

    const transaction = this.db.transaction(() => {
      for (const id of ids) {
        const row = this.db
          .prepare('SELECT anchor FROM tasks WHERE id = ? AND timeline_id = ?')
          .get(id, timelineId) as { anchor: string | null } | undefined;

        if (row?.anchor) {
          const newAnchor = new Date(new Date(row.anchor).getTime() + shiftMs).toISOString();
          this.db
            .prepare('UPDATE tasks SET anchor = ? WHERE id = ? AND timeline_id = ?')
            .run(newAnchor, id, timelineId);
        }
      }
    });

    transaction();

    return ids
      .map((id) => this.getTask(id))
      .filter((t): t is Task => t !== null);
  }

  // ── Look ─────────────────────────────────────────────────────────

  look(options?: { horizon?: number; id?: string; cloud?: boolean }): LookResult {
    // Run recirculation first
    this.recirculate();

    const timelineId = this.currentTimelineId();
    const timeline = this.getCurrentTimeline();
    const now = new Date();
    const nowIso = now.toISOString();

    // Single task lookup
    if (options?.id) {
      const task = this.getTask(options.id);
      return {
        river: task && task.anchor ? [taskWithPosition(task)] : [],
        cloud: task && !task.anchor ? [taskWithPosition(task)] : [],
        breathing_room: { next_4h: 0, rest_of_day: 0 },
        now: nowIso,
        timeline: timeline.name,
      };
    }

    // Cloud-only lookup
    if (options?.cloud) {
      const rows = this.db
        .prepare('SELECT * FROM tasks WHERE timeline_id = ? AND anchor IS NULL')
        .all(timelineId) as TaskRow[];
      return {
        river: [],
        cloud: rows.map((r) => taskWithPosition(rowToTask(r))),
        breathing_room: { next_4h: 0, rest_of_day: 0 },
        now: nowIso,
        timeline: timeline.name,
      };
    }

    // Full look
    let riverQuery = 'SELECT * FROM tasks WHERE timeline_id = ? AND anchor IS NOT NULL';
    const params: unknown[] = [timelineId];

    if (options?.horizon) {
      const horizonAnchor = new Date(now.getTime() + options.horizon * 3_600_000).toISOString();
      riverQuery += ' AND anchor <= ?';
      params.push(horizonAnchor);
    }

    riverQuery += ' ORDER BY anchor ASC';

    const riverRows = this.db.prepare(riverQuery).all(...params) as TaskRow[];
    const cloudRows = this.db
      .prepare('SELECT * FROM tasks WHERE timeline_id = ? AND anchor IS NULL')
      .all(timelineId) as TaskRow[];

    // Breathing room: minutes of uncommitted time
    const endOf4h = new Date(now.getTime() + 4 * 3_600_000);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const tasksNext4h = riverRows.filter((r) => {
      const a = new Date(r.anchor!);
      return a >= now && a <= endOf4h;
    });
    const tasksRestOfDay = riverRows.filter((r) => {
      const a = new Date(r.anchor!);
      return a >= now && a <= endOfDay;
    });

    const usedNext4h = tasksNext4h.reduce((sum, r) => sum + r.mass, 0);
    const usedRestOfDay = tasksRestOfDay.reduce((sum, r) => sum + r.mass, 0);
    const minutesUntilEndOfDay = (endOfDay.getTime() - now.getTime()) / 60_000;

    return {
      river: riverRows.map((r) => taskWithPosition(rowToTask(r))),
      cloud: cloudRows.map((r) => taskWithPosition(rowToTask(r))),
      breathing_room: {
        next_4h: Math.max(0, 240 - usedNext4h),
        rest_of_day: Math.max(0, minutesUntilEndOfDay - usedRestOfDay),
      },
      now: nowIso,
      timeline: timeline.name,
    };
  }

  // ── Recirculation ────────────────────────────────────────────────

  recirculate(): Task[] {
    const timelineId = this.currentTimelineId();
    const now = new Date().toISOString();

    // Find non-fixed, non-alive tasks that have drifted past
    const pastTasks = this.db
      .prepare(
        `SELECT * FROM tasks
         WHERE timeline_id = ? AND anchor IS NOT NULL
         AND anchor < ? AND fixed = 0 AND alive = 0`
      )
      .all(timelineId, now) as TaskRow[];

    if (pastTasks.length === 0) return [];

    const update = this.db.prepare(
      `UPDATE tasks SET anchor = NULL, solidity = 0.0
       WHERE id = ? AND timeline_id = ?`
    );

    const transaction = this.db.transaction(() => {
      for (const task of pastTasks) {
        update.run(task.id, timelineId);
      }
    });

    transaction();

    return pastTasks.map(rowToTask);
  }

  // ── Timeline Operations ──────────────────────────────────────────

  createBranch(name: string): Timeline {
    const currentId = this.currentTimelineId();
    const newId = randomUUID();
    const now = new Date().toISOString();

    this.db.transaction(() => {
      // Create timeline
      this.db
        .prepare('INSERT INTO timelines (id, name, parent_id, created) VALUES (?, ?, ?, ?)')
        .run(newId, name, currentId, now);

      // Snapshot current tasks into the new timeline
      const tasks = this.db
        .prepare('SELECT * FROM tasks WHERE timeline_id = ?')
        .all(currentId) as TaskRow[];

      const insert = this.db.prepare(
        `INSERT INTO tasks (id, timeline_id, name, mass, anchor, solidity, energy, fixed, alive, tags, created)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const task of tasks) {
        insert.run(
          task.id,
          newId,
          task.name,
          task.mass,
          task.anchor,
          task.solidity,
          task.energy,
          task.fixed,
          task.alive,
          task.tags,
          task.created
        );
      }
    })();

    return this.db
      .prepare('SELECT * FROM timelines WHERE id = ?')
      .get(newId) as Timeline;
  }

  listBranches(): Timeline[] {
    return this.db
      .prepare('SELECT * FROM timelines ORDER BY created ASC')
      .all() as Timeline[];
  }

  switchBranch(name: string): void {
    const timeline = this.db
      .prepare('SELECT id FROM timelines WHERE name = ?')
      .get(name) as { id: string } | undefined;

    if (!timeline) throw new Error(`Branch "${name}" not found`);

    this.db
      .prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
      .run('current_timeline_id', timeline.id);
  }

  commitBranch(name: string): void {
    const branch = this.db
      .prepare('SELECT * FROM timelines WHERE name = ?')
      .get(name) as Timeline | undefined;

    if (!branch) throw new Error(`Branch "${name}" not found`);
    if (!branch.parent_id) throw new Error('Cannot commit the main timeline');

    this.db.transaction(() => {
      // Delete parent's tasks
      this.db
        .prepare('DELETE FROM tasks WHERE timeline_id = ?')
        .run(branch.parent_id);

      // Move branch's tasks to parent
      this.db
        .prepare('UPDATE tasks SET timeline_id = ? WHERE timeline_id = ?')
        .run(branch.parent_id, branch.id);

      // Mark committed
      this.db
        .prepare('UPDATE timelines SET committed_at = ? WHERE id = ?')
        .run(new Date().toISOString(), branch.id);

      // Switch back to parent
      this.db
        .prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
        .run('current_timeline_id', branch.parent_id);
    })();
  }

  diffBranches(aName: string, bName: string): BranchDiff {
    const resolveId = (name: string): string => {
      if (name === 'current') return this.currentTimelineId();
      const tl = this.db
        .prepare('SELECT id FROM timelines WHERE name = ?')
        .get(name) as { id: string } | undefined;
      if (!tl) throw new Error(`Branch "${name}" not found`);
      return tl.id;
    };

    const aId = resolveId(aName);
    const bId = resolveId(bName);

    const aTasks = this.db
      .prepare('SELECT * FROM tasks WHERE timeline_id = ?')
      .all(aId) as TaskRow[];
    const bTasks = this.db
      .prepare('SELECT * FROM tasks WHERE timeline_id = ?')
      .all(bId) as TaskRow[];

    const aMap = new Map(aTasks.map((t) => [t.id, t]));
    const bMap = new Map(bTasks.map((t) => [t.id, t]));

    const added: TaskWithPosition[] = [];
    const removed: TaskWithPosition[] = [];
    const modified: BranchDiff['modified'] = [];

    // Tasks in B but not A = added
    for (const [id, task] of bMap) {
      if (!aMap.has(id)) {
        added.push(taskWithPosition(rowToTask(task)));
      }
    }

    // Tasks in A but not B = removed
    for (const [id, task] of aMap) {
      if (!bMap.has(id)) {
        removed.push(taskWithPosition(rowToTask(task)));
      }
    }

    // Tasks in both = check for changes
    for (const [id, aTask] of aMap) {
      const bTask = bMap.get(id);
      if (!bTask) continue;

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const fields = ['name', 'mass', 'anchor', 'solidity', 'fixed', 'alive', 'tags'] as const;

      for (const field of fields) {
        const aVal = aTask[field];
        const bVal = bTask[field];
        if (JSON.stringify(aVal) !== JSON.stringify(bVal)) {
          changes[field] = { from: aVal, to: bVal };
        }
      }

      if (Object.keys(changes).length > 0) {
        modified.push({ task_id: id, name: bTask.name, changes });
      }
    }

    return { added, removed, modified };
  }

  deleteBranch(name: string): void {
    if (name === 'main') throw new Error('Cannot delete the main timeline');

    const branch = this.db
      .prepare('SELECT id FROM timelines WHERE name = ?')
      .get(name) as { id: string } | undefined;

    if (!branch) throw new Error(`Branch "${name}" not found`);

    const currentId = this.currentTimelineId();
    if (branch.id === currentId) {
      throw new Error('Cannot delete the active branch. Switch first.');
    }

    this.db.transaction(() => {
      this.db.prepare('DELETE FROM tasks WHERE timeline_id = ?').run(branch.id);
      this.db.prepare('DELETE FROM timeline_tasks WHERE timeline_id = ?').run(branch.id);
      this.db.prepare('DELETE FROM timelines WHERE id = ?').run(branch.id);
    })();
  }

  // ── Sweep ────────────────────────────────────────────────────────

  sweep(
    filter: {
      in_river?: boolean;
      cloud?: boolean;
      solidity_above?: number;
      solidity_below?: number;
      tag?: string;
      fixed?: boolean;
      id_not?: string;
      alive?: boolean;
    },
    action: string,
    params?: { shift?: number; solidity?: number; mass?: number; position?: number | null }
  ): number {
    const timelineId = this.currentTimelineId();
    const conditions: string[] = ['timeline_id = @tid'];
    const values: Record<string, unknown> = { tid: timelineId };

    if (filter.in_river) conditions.push('anchor IS NOT NULL');
    if (filter.cloud) conditions.push('anchor IS NULL');
    if (filter.solidity_above !== undefined) {
      conditions.push('solidity > @sol_above');
      values.sol_above = filter.solidity_above;
    }
    if (filter.solidity_below !== undefined) {
      conditions.push('solidity < @sol_below');
      values.sol_below = filter.solidity_below;
    }
    if (filter.tag) {
      conditions.push("tags LIKE @tag_like");
      values.tag_like = `%"${filter.tag}"%`;
    }
    if (filter.fixed !== undefined) {
      conditions.push('fixed = @fixed_val');
      values.fixed_val = filter.fixed ? 1 : 0;
    }
    if (filter.id_not) {
      conditions.push('id != @id_not');
      values.id_not = filter.id_not;
    }
    if (filter.alive !== undefined) {
      conditions.push('alive = @alive_val');
      values.alive_val = filter.alive ? 1 : 0;
    }

    const where = conditions.join(' AND ');

    if (action === 'remove') {
      const result = this.db.prepare(`DELETE FROM tasks WHERE ${where}`).run(values);
      return result.changes;
    }

    if (action === 'shift' && params?.shift !== undefined) {
      const rows = this.db
        .prepare(`SELECT id, anchor FROM tasks WHERE ${where} AND anchor IS NOT NULL`)
        .all(values) as Array<{ id: string; anchor: string }>;

      const shiftMs = params.shift * 3_600_000;
      let count = 0;
      this.db.transaction(() => {
        for (const row of rows) {
          const newAnchor = new Date(
            new Date(row.anchor).getTime() + shiftMs
          ).toISOString();
          this.db
            .prepare('UPDATE tasks SET anchor = ? WHERE id = ? AND timeline_id = ?')
            .run(newAnchor, row.id, timelineId);
          count++;
        }
      })();

      return count;
    }

    if (action === 'set') {
      const sets: string[] = [];
      if (params?.solidity !== undefined) {
        sets.push('solidity = @set_sol');
        values.set_sol = params.solidity;
      }
      if (params?.mass !== undefined) {
        sets.push('mass = @set_mass');
        values.set_mass = params.mass;
      }
      if (params?.position !== undefined) {
        sets.push('anchor = @set_anchor');
        values.set_anchor = params.position === null ? null : positionToAnchor(params.position);
      }

      if (sets.length === 0) return 0;

      const result = this.db
        .prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE ${where}`)
        .run(values);

      return result.changes;
    }

    return 0;
  }

  // ── SSE ──────────────────────────────────────────────────────────

  addSSEClient(res: ServerResponse): void {
    this.sseClients.add(res);
    res.on('close', () => this.sseClients.delete(res));
  }

  notify(): void {
    const data = JSON.stringify(this.look());
    for (const client of this.sseClients) {
      client.write(`data: ${data}\n\n`);
    }
  }
}

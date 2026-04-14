import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import {
  type Task,
  type TaskWithPosition,
  type Timeline,
  type BranchDiff,
  taskWithPosition,
} from '../schema.js';
import { type TaskRow, rowToTask } from './types.js';

export function createBranchFns(
  db: Database.Database,
  currentTimelineId: () => string,
) {
  function createBranch(name: string): Timeline {
    const currentId = currentTimelineId();
    const newId = randomUUID();
    const now = new Date().toISOString();

    db.transaction(() => {
      // Create timeline
      db
        .prepare('INSERT INTO timelines (id, name, parent_id, created) VALUES (?, ?, ?, ?)')
        .run(newId, name, currentId, now);

      // Snapshot current tasks into the new timeline
      const tasks = db
        .prepare('SELECT * FROM tasks WHERE timeline_id = ?')
        .all(currentId) as TaskRow[];

      const insert = db.prepare(
        `INSERT INTO tasks (id, timeline_id, name, mass, anchor, solidity, energy, fixed, alive, tags, created, cloud_x, cloud_y, river_y)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
          task.created,
          task.cloud_x,
          task.cloud_y,
          task.river_y,
        );
      }
    })();

    return db
      .prepare('SELECT * FROM timelines WHERE id = ?')
      .get(newId) as Timeline;
  }

  function listBranches(): Timeline[] {
    return db
      .prepare('SELECT * FROM timelines ORDER BY created ASC')
      .all() as Timeline[];
  }

  function switchBranch(name: string): void {
    const timeline = db
      .prepare('SELECT id FROM timelines WHERE name = ?')
      .get(name) as { id: string } | undefined;

    if (!timeline) throw new Error(`Branch "${name}" not found`);

    db
      .prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
      .run('current_timeline_id', timeline.id);
  }

  function commitBranch(name: string): void {
    const branch = db
      .prepare('SELECT * FROM timelines WHERE name = ?')
      .get(name) as Timeline | undefined;

    if (!branch) throw new Error(`Branch "${name}" not found`);
    if (!branch.parent_id) throw new Error('Cannot commit the main timeline');

    db.transaction(() => {
      // Delete parent's tasks
      db
        .prepare('DELETE FROM tasks WHERE timeline_id = ?')
        .run(branch.parent_id);

      // Move branch's tasks to parent
      db
        .prepare('UPDATE tasks SET timeline_id = ? WHERE timeline_id = ?')
        .run(branch.parent_id, branch.id);

      // Mark committed
      db
        .prepare('UPDATE timelines SET committed_at = ? WHERE id = ?')
        .run(new Date().toISOString(), branch.id);

      // Switch back to parent
      db
        .prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
        .run('current_timeline_id', branch.parent_id);
    })();
  }

  function diffBranches(aName: string, bName: string): BranchDiff {
    const resolveId = (name: string): string => {
      if (name === 'current') return currentTimelineId();
      const tl = db
        .prepare('SELECT id FROM timelines WHERE name = ?')
        .get(name) as { id: string } | undefined;
      if (!tl) throw new Error(`Branch "${name}" not found`);
      return tl.id;
    };

    const aId = resolveId(aName);
    const bId = resolveId(bName);

    const aTasks = db
      .prepare('SELECT * FROM tasks WHERE timeline_id = ?')
      .all(aId) as TaskRow[];
    const bTasks = db
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

  function deleteBranch(name: string): void {
    if (name === 'main') throw new Error('Cannot delete the main timeline');

    const branch = db
      .prepare('SELECT id FROM timelines WHERE name = ?')
      .get(name) as { id: string } | undefined;

    if (!branch) throw new Error(`Branch "${name}" not found`);

    const currentId = currentTimelineId();
    if (branch.id === currentId) {
      throw new Error('Cannot delete the active branch. Switch first.');
    }

    db.transaction(() => {
      db.prepare('DELETE FROM tasks WHERE timeline_id = ?').run(branch.id);
      db.prepare('DELETE FROM timelines WHERE id = ?').run(branch.id);
    })();
  }

  return { createBranch, listBranches, switchBranch, commitBranch, diffBranches, deleteBranch };
}

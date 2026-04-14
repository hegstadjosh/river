import Database from 'better-sqlite3';
import type { Task } from '../schema.js';
import { type TaskRow, rowToTask } from './types.js';

export function createRenameFn(
  db: Database.Database,
  currentTimelineId: () => string,
) {
  function rename(id: string, name: string): Task {
    const timelineId = currentTimelineId();

    const existing = db
      .prepare('SELECT * FROM tasks WHERE id = ? AND timeline_id = ?')
      .get(id, timelineId) as TaskRow | undefined;

    if (!existing) {
      throw new Error(`Task ${id} not found`);
    }

    db.prepare('UPDATE tasks SET name = ? WHERE id = ? AND timeline_id = ?')
      .run(name, id, timelineId);

    return rowToTask({ ...existing, name });
  }

  return { rename };
}

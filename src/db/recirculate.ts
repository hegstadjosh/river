import Database from 'better-sqlite3';
import { type Task } from '../schema.js';
import { type TaskRow, rowToTask } from './types.js';

export function createRecirculateFn(
  db: Database.Database,
  currentTimelineId: () => string,
) {
  function recirculate(): Task[] {
    const timelineId = currentTimelineId();
    const now = new Date().toISOString();

    // Find non-fixed, non-alive tasks that have drifted past
    const pastTasks = db
      .prepare(
        `SELECT * FROM tasks
         WHERE timeline_id = ? AND anchor IS NOT NULL
         AND anchor < ? AND fixed = 0 AND alive = 0`
      )
      .all(timelineId, now) as TaskRow[];

    if (pastTasks.length === 0) return [];

    const update = db.prepare(
      `UPDATE tasks SET anchor = NULL, solidity = 0.0
       WHERE id = ? AND timeline_id = ?`
    );

    const transaction = db.transaction(() => {
      for (const task of pastTasks) {
        update.run(task.id, timelineId);
      }
    });

    transaction();

    return pastTasks.map(rowToTask);
  }

  return { recirculate };
}

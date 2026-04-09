import Database from 'better-sqlite3';
import { type Task, positionToAnchor } from '../schema.js';

export function createMoveFns(
  db: Database.Database,
  currentTimelineId: () => string,
  getTask: (id: string) => Task | null,
) {
  function moveTask(id: string, position: number | null): Task {
    const anchor = position === null ? null : positionToAnchor(position);
    const timelineId = currentTimelineId();
    db
      .prepare('UPDATE tasks SET anchor = ? WHERE id = ? AND timeline_id = ?')
      .run(anchor, id, timelineId);
    const task = getTask(id);
    if (!task) throw new Error(`Task ${id} not found`);
    return task;
  }

  function moveTasks(ids: string[], shift: number): Task[] {
    const timelineId = currentTimelineId();
    const shiftMs = shift * 3_600_000;

    const transaction = db.transaction(() => {
      for (const id of ids) {
        const row = db
          .prepare('SELECT anchor FROM tasks WHERE id = ? AND timeline_id = ?')
          .get(id, timelineId) as { anchor: string | null } | undefined;

        if (row?.anchor) {
          const newAnchor = new Date(new Date(row.anchor).getTime() + shiftMs).toISOString();
          db
            .prepare('UPDATE tasks SET anchor = ? WHERE id = ? AND timeline_id = ?')
            .run(newAnchor, id, timelineId);
        }
      }
    });

    transaction();

    return ids
      .map((id) => getTask(id))
      .filter((t): t is Task => t !== null);
  }

  return { moveTask, moveTasks };
}

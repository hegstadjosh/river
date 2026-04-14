import Database from 'better-sqlite3';
import type { Task } from '../schema.js';
import { type TaskRow, rowToTask } from './types.js';

export function createTagFn(
  db: Database.Database,
  currentTimelineId: () => string,
) {
  function tag(id: string, tags: string[], action: 'add' | 'remove'): Task {
    const timelineId = currentTimelineId();

    const existing = db
      .prepare('SELECT * FROM tasks WHERE id = ? AND timeline_id = ?')
      .get(id, timelineId) as TaskRow | undefined;

    if (!existing) {
      throw new Error(`Task ${id} not found`);
    }

    const currentTags: string[] = JSON.parse(existing.tags);
    let newTags: string[];

    if (action === 'add') {
      const tagSet = new Set(currentTags);
      for (const t of tags) tagSet.add(t);
      newTags = [...tagSet];
    } else {
      const removeSet = new Set(tags);
      newTags = currentTags.filter((t) => !removeSet.has(t));
    }

    const tagsJson = JSON.stringify(newTags);
    db.prepare('UPDATE tasks SET tags = ? WHERE id = ? AND timeline_id = ?')
      .run(tagsJson, id, timelineId);

    return rowToTask({ ...existing, tags: tagsJson });
  }

  return { tag };
}

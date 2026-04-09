import Database from 'better-sqlite3';
import {
  type Task,
  type LookResult,
  type Timeline,
  taskWithPosition,
} from '../schema.js';
import { type TaskRow, rowToTask } from './types.js';

export function createLookFns(
  db: Database.Database,
  currentTimelineId: () => string,
  getCurrentTimeline: () => Timeline,
  getTask: (id: string) => Task | null,
  recirculate: () => Task[],
) {
  function look(options?: { horizon?: number; id?: string; cloud?: boolean }): LookResult {
    // Run recirculation first
    recirculate();

    const timelineId = currentTimelineId();
    const timeline = getCurrentTimeline();
    const now = new Date();
    const nowIso = now.toISOString();

    // Single task lookup
    if (options?.id) {
      const task = getTask(options.id);
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
      const rows = db
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

    const riverRows = db.prepare(riverQuery).all(...params) as TaskRow[];
    const cloudRows = db
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

  return { look };
}

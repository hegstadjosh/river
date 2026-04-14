import Database from 'better-sqlite3';
import { positionToAnchor } from '../schema.js';

export function createClearFn(
  db: Database.Database,
  currentTimelineId: () => string,
) {
  function clear(timeRange?: { start?: number; end?: number }): number {
    const timelineId = currentTimelineId();

    if (timeRange && (timeRange.start !== undefined || timeRange.end !== undefined)) {
      const conditions: string[] = ['timeline_id = @tid'];
      const values: Record<string, unknown> = { tid: timelineId };

      if (timeRange.start !== undefined) {
        conditions.push('anchor >= @start_anchor');
        values.start_anchor = positionToAnchor(timeRange.start);
      }
      if (timeRange.end !== undefined) {
        conditions.push('anchor <= @end_anchor');
        values.end_anchor = positionToAnchor(timeRange.end);
      }
      // Only delete river tasks in the time window (tasks with anchors)
      conditions.push('anchor IS NOT NULL');

      const result = db
        .prepare(`DELETE FROM tasks WHERE ${conditions.join(' AND ')}`)
        .run(values);
      return result.changes;
    }

    // No time range: delete everything on this timeline
    const result = db
      .prepare('DELETE FROM tasks WHERE timeline_id = ?')
      .run(timelineId);
    return result.changes;
  }

  return { clear };
}

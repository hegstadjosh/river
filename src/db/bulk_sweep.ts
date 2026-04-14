import Database from 'better-sqlite3';

export function createBulkSweepFn(
  db: Database.Database,
  currentTimelineId: () => string,
) {
  function bulkSweep(ids: string[]): number {
    const timelineId = currentTimelineId();
    if (ids.length === 0) return 0;

    let count = 0;
    db.transaction(() => {
      for (const id of ids) {
        const result = db
          .prepare('DELETE FROM tasks WHERE id = ? AND timeline_id = ?')
          .run(id, timelineId);
        count += result.changes;
      }
    })();

    return count;
  }

  return { bulkSweep };
}

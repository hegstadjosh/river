import Database from 'better-sqlite3';
import { type TaskRow } from './types.js';

export interface RiverStats {
  total: number;
  river_count: number;
  cloud_count: number;
  tag_distribution: Record<string, number>;
  avg_solidity: number;
  avg_energy: number;
  breathing_room: {
    next_4h: number;
    rest_of_day: number;
  };
}

export function createStatsFn(
  db: Database.Database,
  currentTimelineId: () => string,
) {
  function stats(): RiverStats {
    const timelineId = currentTimelineId();
    const now = new Date();

    const rows = db
      .prepare('SELECT * FROM tasks WHERE timeline_id = ?')
      .all(timelineId) as TaskRow[];

    const total = rows.length;
    const riverTasks = rows.filter((r) => r.anchor !== null);
    const cloudTasks = rows.filter((r) => r.anchor === null);

    // Tag distribution
    const tagDist: Record<string, number> = {};
    for (const row of rows) {
      const tags: string[] = JSON.parse(row.tags);
      for (const t of tags) {
        tagDist[t] = (tagDist[t] ?? 0) + 1;
      }
    }

    // Averages
    const avgSolidity = total > 0
      ? rows.reduce((sum, r) => sum + r.solidity, 0) / total
      : 0;
    const avgEnergy = total > 0
      ? rows.reduce((sum, r) => sum + r.energy, 0) / total
      : 0;

    // Breathing room
    const endOf4h = new Date(now.getTime() + 4 * 3_600_000);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const usedNext4h = riverTasks
      .filter((r) => {
        const a = new Date(r.anchor!);
        return a >= now && a <= endOf4h;
      })
      .reduce((sum, r) => sum + r.mass, 0);

    const usedRestOfDay = riverTasks
      .filter((r) => {
        const a = new Date(r.anchor!);
        return a >= now && a <= endOfDay;
      })
      .reduce((sum, r) => sum + r.mass, 0);

    const minutesUntilEndOfDay = (endOfDay.getTime() - now.getTime()) / 60_000;

    return {
      total,
      river_count: riverTasks.length,
      cloud_count: cloudTasks.length,
      tag_distribution: tagDist,
      avg_solidity: Math.round(avgSolidity * 100) / 100,
      avg_energy: Math.round(avgEnergy * 100) / 100,
      breathing_room: {
        next_4h: Math.max(0, 240 - usedNext4h),
        rest_of_day: Math.max(0, minutesUntilEndOfDay - usedRestOfDay),
      },
    };
  }

  return { stats };
}

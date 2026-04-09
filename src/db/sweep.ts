import Database from 'better-sqlite3';
import { positionToAnchor } from '../schema.js';

export function createSweepFn(
  db: Database.Database,
  currentTimelineId: () => string,
) {
  function sweep(
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
    const timelineId = currentTimelineId();
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
      const result = db.prepare(`DELETE FROM tasks WHERE ${where}`).run(values);
      return result.changes;
    }

    if (action === 'shift' && params?.shift !== undefined) {
      const rows = db
        .prepare(`SELECT id, anchor FROM tasks WHERE ${where} AND anchor IS NOT NULL`)
        .all(values) as Array<{ id: string; anchor: string }>;

      const shiftMs = params.shift * 3_600_000;
      let count = 0;
      db.transaction(() => {
        for (const row of rows) {
          const newAnchor = new Date(
            new Date(row.anchor).getTime() + shiftMs
          ).toISOString();
          db
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

      const result = db
        .prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE ${where}`)
        .run(values);

      return result.changes;
    }

    return 0;
  }

  return { sweep };
}

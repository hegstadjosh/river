// Web state layer — all River operations as direct SQL against Neon Postgres.
// Schema: tasks (lane NULL = main, 1-4 = plan lanes), known_tags, plan_state, api_keys.
// Every query is scoped by user_id — that is the sole tenancy boundary.

import type { PoolClient } from 'pg'
import { pool } from '@/lib/db'
import {
  type Task,
  type LookResult,
  type PlanState,
  type PlanLaneInfo,
  DEFAULT_MASS,
  DEFAULT_SOLIDITY,
  positionToAnchor,
  taskWithPosition,
  rowToTask,
} from './schema'

function laneBranchName(lane: number): string {
  return `_plan_lane_${lane}`
}

const iso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : ((v as string | null) ?? null)

// Columns written when copying a task into/out of a lane. Lane copies drop
// spatial coords (cloud_x/cloud_y/river_y) — matches the previous behavior.
const COPY_COLS = 'name, mass, anchor, solidity, energy, fixed, alive, tags, created'

export class WebState {
  constructor(private userId: string) {}

  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const result = await fn(client)
      await client.query('COMMIT')
      return result
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }

  // ── Task CRUD ──────────────────────────────────────────────────

  async putTask(input: Record<string, unknown>): Promise<Task> {
    let anchor: string | null | undefined = undefined
    if (input.position !== undefined) {
      anchor = input.position === null ? null : positionToAnchor(input.position as number)
    }

    if (input.id) {
      const sets: string[] = []
      const vals: unknown[] = []
      const set = (col: string, v: unknown) => {
        vals.push(v)
        sets.push(`${col} = $${vals.length + 2}`)
      }
      if (input.name !== undefined) set('name', input.name)
      if (input.mass !== undefined) set('mass', input.mass)
      if (anchor !== undefined) set('anchor', anchor)
      if (input.solidity !== undefined) set('solidity', input.solidity)
      if (input.energy !== undefined) set('energy', input.energy)
      if (input.fixed !== undefined) set('fixed', input.fixed)
      if (input.alive !== undefined) set('alive', input.alive)
      if (input.tags !== undefined) set('tags', input.tags)
      if (input.cloud_x !== undefined) set('cloud_x', input.cloud_x)
      if (input.cloud_y !== undefined) set('cloud_y', input.cloud_y)
      if (input.river_y !== undefined) set('river_y', input.river_y)

      if (sets.length === 0) {
        const { rows } = await pool.query(
          'SELECT * FROM tasks WHERE id = $1 AND user_id = $2',
          [input.id, this.userId],
        )
        if (!rows[0]) throw new Error(`Task ${input.id} not found`)
        return rowToTask(rows[0])
      }

      const { rows } = await pool.query(
        `UPDATE tasks SET ${sets.join(', ')}
         WHERE id = $1 AND user_id = $2 AND lane IS NULL
         RETURNING *`,
        [input.id, this.userId, ...vals],
      )
      if (!rows[0]) throw new Error(`Task ${input.id} not found`)
      return rowToTask(rows[0])
    }

    const { rows } = await pool.query(
      `INSERT INTO tasks (id, user_id, name, mass, anchor, solidity, energy, fixed, alive, tags, created, cloud_x, cloud_y, river_y)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), $11, $12, $13)
       RETURNING *`,
      [
        crypto.randomUUID(),
        this.userId,
        (input.name as string) || 'untitled',
        (input.mass as number) ?? DEFAULT_MASS,
        anchor ?? null,
        (input.solidity as number) ?? DEFAULT_SOLIDITY,
        (input.energy as number) ?? 0.5,
        (input.fixed as boolean) ?? false,
        (input.alive as boolean) ?? false,
        (input.tags as string[]) ?? [],
        (input.cloud_x as number) ?? null,
        (input.cloud_y as number) ?? null,
        (input.river_y as number) ?? null,
      ],
    )
    return rowToTask(rows[0])
  }

  async deleteTask(id: string): Promise<void> {
    await pool.query(
      'DELETE FROM tasks WHERE id = $1 AND user_id = $2 AND lane IS NULL',
      [id, this.userId],
    )
  }

  async moveTask(id: string, position: number | null): Promise<void> {
    const anchor = position === null ? null : positionToAnchor(position)
    await pool.query(
      'UPDATE tasks SET anchor = $3 WHERE id = $1 AND user_id = $2 AND lane IS NULL',
      [id, this.userId, anchor],
    )
  }

  // ── Look (full state read) ─────────────────────────────────────

  async look(options?: { horizon?: number; id?: string; cloud?: boolean }): Promise<LookResult> {
    const now = new Date()
    const nowIso = now.toISOString()

    // Recirculate first: past, non-fixed, non-alive river tasks drift back to
    // the cloud. One conditional UPDATE on the DB clock — atomic, awaited.
    await pool.query(
      `UPDATE tasks SET anchor = NULL, solidity = 0
       WHERE user_id = $1 AND lane IS NULL AND anchor < now() AND NOT fixed AND NOT alive`,
      [this.userId],
    )

    const [tasksRes, planRes, tagsRes] = await Promise.all([
      pool.query(
        'SELECT * FROM tasks WHERE user_id = $1 ORDER BY anchor ASC NULLS LAST',
        [this.userId],
      ),
      pool.query('SELECT * FROM plan_state WHERE user_id = $1', [this.userId]),
      pool.query('SELECT name FROM known_tags WHERE user_id = $1 ORDER BY name', [this.userId]),
    ])

    const mainRows = tasksRes.rows.filter(r => r.lane === null)
    const river = mainRows.filter(r => r.anchor !== null).map(r => taskWithPosition(rowToTask(r)))
    const cloud = mainRows.filter(r => r.anchor === null).map(r => taskWithPosition(rowToTask(r)))

    // Single-task lookup keeps its narrow historical shape
    if (options?.id) {
      const match = [...river, ...cloud].find(t => t.id === options.id)
      return {
        river: match && match.position !== null ? [match] : [],
        cloud: match && match.position === null ? [match] : [],
        breathing_room: { next_4h: 0, rest_of_day: 0 },
        now: nowIso,
        timeline: 'main',
        known_tags: [],
      }
    }

    let filteredRiver = river
    if (options?.cloud) filteredRiver = []
    if (options?.horizon !== undefined) {
      filteredRiver = filteredRiver.filter(t => t.position !== null && t.position <= options.horizon!)
    }

    // Breathing room (computed from already-fetched data)
    const endOf4h = new Date(now.getTime() + 4 * 3_600_000)
    const endOfDay = new Date(now)
    endOfDay.setHours(23, 59, 59, 999)
    const usedNext4h = river
      .filter(t => t.anchor && new Date(t.anchor) >= now && new Date(t.anchor) <= endOf4h)
      .reduce((s, t) => s + t.mass, 0)
    const usedRestOfDay = river
      .filter(t => t.anchor && new Date(t.anchor) >= now && new Date(t.anchor) <= endOfDay)
      .reduce((s, t) => s + t.mass, 0)
    const minutesUntilEndOfDay = (endOfDay.getTime() - now.getTime()) / 60_000

    // Plan state — lane tasks come from the same single SELECT
    let plan: LookResult['plan'] = undefined
    const ps = planRes.rows[0]
    if (ps) {
      const lanes = []
      for (let n = 1; n <= 4; n++) {
        const tasks = tasksRes.rows
          .filter(r => r.lane === n)
          .map(r => taskWithPosition(rowToTask(r)))
        lanes.push({
          number: n,
          label: null,
          taskCount: tasks.length,
          branchName: laneBranchName(n),
          readonly: false,
          tasks,
        })
      }
      plan = {
        active: true,
        window_start: iso(ps.window_start),
        window_end: iso(ps.window_end),
        lanes,
      }
    }

    return {
      river: filteredRiver,
      cloud,
      breathing_room: {
        next_4h: Math.max(0, 240 - usedNext4h),
        rest_of_day: Math.max(0, minutesUntilEndOfDay - usedRestOfDay),
      },
      now: nowIso,
      timeline: 'main',
      known_tags: tagsRes.rows.map(r => r.name),
      plan,
    }
  }

  // ── Clear / Bulk Sweep / Rename ────────────────────────────────

  async clear(timeRange?: { start?: number; end?: number }): Promise<number> {
    if (timeRange && (timeRange.start !== undefined || timeRange.end !== undefined)) {
      const conds = ['user_id = $1', 'lane IS NULL', 'anchor IS NOT NULL']
      const vals: unknown[] = [this.userId]
      if (timeRange.start !== undefined) {
        vals.push(positionToAnchor(timeRange.start))
        conds.push(`anchor >= $${vals.length}`)
      }
      if (timeRange.end !== undefined) {
        vals.push(positionToAnchor(timeRange.end))
        conds.push(`anchor <= $${vals.length}`)
      }
      const res = await pool.query(`DELETE FROM tasks WHERE ${conds.join(' AND ')}`, vals)
      return res.rowCount ?? 0
    }

    const res = await pool.query(
      'DELETE FROM tasks WHERE user_id = $1 AND lane IS NULL',
      [this.userId],
    )
    return res.rowCount ?? 0
  }

  async bulkSweep(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0
    const res = await pool.query(
      'DELETE FROM tasks WHERE user_id = $1 AND lane IS NULL AND id = ANY($2)',
      [this.userId, ids],
    )
    return res.rowCount ?? 0
  }

  async rename(id: string, name: string): Promise<Task> {
    const { rows } = await pool.query(
      `UPDATE tasks SET name = $3 WHERE id = $1 AND user_id = $2 AND lane IS NULL RETURNING *`,
      [id, this.userId, name],
    )
    if (!rows[0]) throw new Error(`Task ${id} not found`)
    return rowToTask(rows[0])
  }

  // ── Tag / Untag ───────────────────────────────────────────────

  async tag(id: string, tags: string[], action: 'add' | 'remove'): Promise<Task> {
    // Single statement, order-preserving: add appends only missing tags,
    // remove filters them out. No read-modify-write round trip.
    tags = [...new Set(tags)]
    const expr =
      action === 'add'
        ? `tags || ARRAY(SELECT t FROM unnest($3::text[]) t WHERE NOT (t = ANY(tags)))`
        : `ARRAY(SELECT t FROM unnest(tags) t WHERE NOT (t = ANY($3::text[])))`
    const { rows } = await pool.query(
      `UPDATE tasks SET tags = ${expr}
       WHERE id = $1 AND user_id = $2 AND lane IS NULL
       RETURNING *`,
      [id, this.userId, tags],
    )
    if (!rows[0]) throw new Error(`Task ${id} not found`)
    return rowToTask(rows[0])
  }

  // ── Stats ─────────────────────────────────────────────────────

  async stats(): Promise<{
    total: number
    river_count: number
    cloud_count: number
    tag_distribution: Record<string, number>
    avg_solidity: number
    avg_energy: number
    breathing_room: { next_4h: number; rest_of_day: number }
  }> {
    const now = new Date()
    const { rows: allRows } = await pool.query(
      'SELECT * FROM tasks WHERE user_id = $1 AND lane IS NULL',
      [this.userId],
    )

    const rows = allRows.map(rowToTask)
    const total = rows.length
    const riverTasks = rows.filter(t => t.anchor !== null)
    const cloudTasks = rows.filter(t => t.anchor === null)

    const tagDist: Record<string, number> = {}
    for (const task of rows) {
      for (const t of task.tags) {
        tagDist[t] = (tagDist[t] ?? 0) + 1
      }
    }

    const avgSolidity = total > 0
      ? Math.round((rows.reduce((s, t) => s + t.solidity, 0) / total) * 100) / 100
      : 0
    const avgEnergy = total > 0
      ? Math.round((rows.reduce((s, t) => s + t.energy, 0) / total) * 100) / 100
      : 0

    const endOf4h = new Date(now.getTime() + 4 * 3_600_000)
    const endOfDay = new Date(now)
    endOfDay.setHours(23, 59, 59, 999)

    const usedNext4h = riverTasks
      .filter(t => t.anchor && new Date(t.anchor) >= now && new Date(t.anchor) <= endOf4h)
      .reduce((s, t) => s + t.mass, 0)
    const usedRestOfDay = riverTasks
      .filter(t => t.anchor && new Date(t.anchor) >= now && new Date(t.anchor) <= endOfDay)
      .reduce((s, t) => s + t.mass, 0)
    const minutesUntilEndOfDay = (endOfDay.getTime() - now.getTime()) / 60_000

    return {
      total,
      river_count: riverTasks.length,
      cloud_count: cloudTasks.length,
      tag_distribution: tagDist,
      avg_solidity: avgSolidity,
      avg_energy: avgEnergy,
      breathing_room: {
        next_4h: Math.max(0, 240 - usedNext4h),
        rest_of_day: Math.max(0, minutesUntilEndOfDay - usedRestOfDay),
      },
    }
  }

  // ── Tags ───────────────────────────────────────────────────────

  async getKnownTags(): Promise<string[]> {
    const { rows } = await pool.query(
      'SELECT name FROM known_tags WHERE user_id = $1 ORDER BY name',
      [this.userId],
    )
    return rows.map(r => r.name)
  }

  async addKnownTag(tag: string): Promise<void> {
    await pool.query(
      'INSERT INTO known_tags (user_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [this.userId, tag],
    )
  }

  async ensureTaskTags(taskTags: string[] | undefined): Promise<void> {
    if (!taskTags || taskTags.length === 0) return
    await pool.query(
      `INSERT INTO known_tags (user_id, name)
       SELECT $1, t FROM unnest($2::text[]) t
       ON CONFLICT DO NOTHING`,
      [this.userId, taskTags],
    )
  }

  async deleteTag(tag: string): Promise<number> {
    return this.tx(async c => {
      await c.query(
        'DELETE FROM known_tags WHERE user_id = $1 AND name = $2',
        [this.userId, tag],
      )
      const res = await c.query(
        `UPDATE tasks SET tags = array_remove(tags, $2)
         WHERE user_id = $1 AND lane IS NULL AND $2 = ANY(tags)`,
        [this.userId, tag],
      )
      return res.rowCount ?? 0
    })
  }

  async listTags(): Promise<string[]> {
    return this.getKnownTags()
  }

  async renameTag(oldName: string, newName: string): Promise<void> {
    await this.tx(async c => {
      await c.query(
        'DELETE FROM known_tags WHERE user_id = $1 AND name = $2',
        [this.userId, oldName],
      )
      await c.query(
        'INSERT INTO known_tags (user_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [this.userId, newName],
      )
      // array_replace + dedupe keeping first-occurrence order
      await c.query(
        `UPDATE tasks SET tags = (
           SELECT COALESCE(array_agg(t ORDER BY min_ord), '{}')
           FROM (
             SELECT t, min(ord) AS min_ord
             FROM unnest(array_replace(tags, $2, $3)) WITH ORDINALITY AS u(t, ord)
             GROUP BY t
           ) s
         )
         WHERE user_id = $1 AND lane IS NULL AND $2 = ANY(tags)`,
        [this.userId, oldName, newName],
      )
    })
  }

  // ── Plan Mode ──────────────────────────────────────────────────
  // Lanes are a column (1-4); the snapshot never leaves Postgres and every
  // lifecycle step is one transaction — no partial states on a crash.

  async startPlan(windowStart: string, windowEnd: string): Promise<void> {
    await this.tx(async c => {
      await c.query(
        `INSERT INTO plan_state (user_id, window_start, window_end)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE
           SET window_start = EXCLUDED.window_start, window_end = EXCLUDED.window_end`,
        [this.userId, windowStart, windowEnd],
      )
      // Restarting a plan clears any previous lane scratch space
      await c.query(
        'DELETE FROM tasks WHERE user_id = $1 AND lane IS NOT NULL',
        [this.userId],
      )
      // Lane 1 = snapshot of the main river inside the window
      await c.query(
        `INSERT INTO tasks (id, user_id, lane, name, mass, anchor, solidity, energy, fixed, alive, tags, created, cloud_x, cloud_y, river_y)
         SELECT gen_random_uuid()::text, user_id, 1, name, mass, anchor, solidity, energy, fixed, alive, tags, created, cloud_x, cloud_y, river_y
         FROM tasks
         WHERE user_id = $1 AND lane IS NULL AND anchor >= $2 AND anchor <= $3`,
        [this.userId, windowStart, windowEnd],
      )
    })
  }

  async endPlan(): Promise<void> {
    await this.tx(async c => {
      await c.query('DELETE FROM tasks WHERE user_id = $1 AND lane IS NOT NULL', [this.userId])
      await c.query('DELETE FROM plan_state WHERE user_id = $1', [this.userId])
    })
  }

  async commitLane(lane: number): Promise<void> {
    await this.tx(async c => {
      const ps = await c.query(
        'SELECT window_start, window_end FROM plan_state WHERE user_id = $1',
        [this.userId],
      )
      if (!ps.rows[0]) throw new Error('Plan window not defined')
      const { window_start, window_end } = ps.rows[0]

      await c.query(
        `DELETE FROM tasks
         WHERE user_id = $1 AND lane IS NULL AND anchor IS NOT NULL
           AND anchor >= $2 AND anchor <= $3`,
        [this.userId, window_start, window_end],
      )
      await c.query(
        'UPDATE tasks SET lane = NULL WHERE user_id = $1 AND lane = $2',
        [this.userId, lane],
      )
      await c.query('DELETE FROM tasks WHERE user_id = $1 AND lane IS NOT NULL', [this.userId])
      await c.query('DELETE FROM plan_state WHERE user_id = $1', [this.userId])
    })
  }

  async getPlanState(): Promise<PlanState> {
    const [planRes, countRes] = await Promise.all([
      pool.query('SELECT * FROM plan_state WHERE user_id = $1', [this.userId]),
      pool.query(
        `SELECT lane, count(*)::int AS n FROM tasks
         WHERE user_id = $1 AND lane IS NOT NULL GROUP BY lane`,
        [this.userId],
      ),
    ])
    const ps = planRes.rows[0]
    if (!ps) return { active: false, window_start: null, window_end: null, lanes: [] }

    const counts = new Map<number, number>(countRes.rows.map(r => [r.lane, r.n]))
    const lanes: PlanLaneInfo[] = []
    for (let n = 1; n <= 4; n++) {
      lanes.push({
        number: n,
        label: null,
        taskCount: counts.get(n) ?? 0,
        branchName: laneBranchName(n),
        readonly: false,
      })
    }
    return {
      active: true,
      window_start: iso(ps.window_start),
      window_end: iso(ps.window_end),
      lanes,
    }
  }

  // ── Lane manipulation ──────────────────────────────────────────
  // Moves are single UPDATEs (task identity preserved); copies are
  // INSERT ... SELECT with a fresh id. Lane copies drop spatial coords.

  async putTaskInLane(lane: number, name: string, position: number | null): Promise<void> {
    await pool.query(
      `INSERT INTO tasks (id, user_id, lane, name, mass, anchor, solidity, energy, fixed, alive, tags, created)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0.5, false, false, '{}', now())`,
      [
        crypto.randomUUID(),
        this.userId,
        lane,
        name,
        DEFAULT_MASS,
        position != null ? positionToAnchor(position) : null,
        DEFAULT_SOLIDITY,
      ],
    )
  }

  async updateTaskInLane(
    lane: number,
    taskId: string,
    updates: { mass?: number; solidity?: number; energy?: number; position?: number },
  ): Promise<void> {
    const sets: string[] = []
    const vals: unknown[] = [taskId, this.userId, lane]
    const set = (col: string, v: unknown) => {
      vals.push(v)
      sets.push(`${col} = $${vals.length}`)
    }
    if (updates.mass !== undefined) set('mass', updates.mass)
    if (updates.solidity !== undefined) set('solidity', updates.solidity)
    if (updates.energy !== undefined) set('energy', updates.energy)
    if (updates.position !== undefined) set('anchor', positionToAnchor(updates.position))
    if (sets.length === 0) return
    await pool.query(
      `UPDATE tasks SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2 AND lane = $3`,
      vals,
    )
  }

  async removeFromLane(lane: number, taskId: string): Promise<void> {
    await pool.query(
      'DELETE FROM tasks WHERE id = $1 AND user_id = $2 AND lane = $3',
      [taskId, this.userId, lane],
    )
  }

  async repositionInLane(lane: number, taskId: string, position: number): Promise<void> {
    await pool.query(
      'UPDATE tasks SET anchor = $4 WHERE id = $1 AND user_id = $2 AND lane = $3',
      [taskId, this.userId, lane, positionToAnchor(position)],
    )
  }

  async laneToCloud(lane: number, taskId: string): Promise<void> {
    const res = await pool.query(
      `UPDATE tasks SET lane = NULL, anchor = NULL, cloud_x = NULL, cloud_y = NULL, river_y = NULL
       WHERE id = $1 AND user_id = $2 AND lane = $3`,
      [taskId, this.userId, lane],
    )
    if (res.rowCount === 0) throw new Error(`Task ${taskId} not found in lane ${lane}`)
  }

  async addToLane(lane: number, taskId: string, position: number | null, copy: boolean): Promise<void> {
    if (copy) {
      const res = await pool.query(
        `INSERT INTO tasks (id, user_id, lane, ${COPY_COLS})
         SELECT gen_random_uuid()::text, user_id, $3, name, mass,
                COALESCE($4, anchor), solidity, energy, fixed, alive, tags, created
         FROM tasks WHERE id = $1 AND user_id = $2`,
        [taskId, this.userId, lane, position != null ? positionToAnchor(position) : null],
      )
      if (res.rowCount === 0) throw new Error(`Task ${taskId} not found`)
      return
    }

    const res = await pool.query(
      `UPDATE tasks SET lane = $3, anchor = COALESCE($4, anchor),
                        cloud_x = NULL, cloud_y = NULL, river_y = NULL
       WHERE id = $1 AND user_id = $2`,
      [taskId, this.userId, lane, position != null ? positionToAnchor(position) : null],
    )
    if (res.rowCount === 0) throw new Error(`Task ${taskId} not found`)
  }

  async moveBetweenLanes(fromLane: number, toLane: number, taskId: string, position: number): Promise<void> {
    const res = await pool.query(
      `UPDATE tasks SET lane = $4, anchor = $5
       WHERE id = $1 AND user_id = $2 AND lane = $3`,
      [taskId, this.userId, fromLane, toLane, positionToAnchor(position)],
    )
    if (res.rowCount === 0) throw new Error(`Task ${taskId} not found in lane ${fromLane}`)
  }

  async copyBetweenLanes(fromLane: number, toLane: number, taskId: string, position: number): Promise<void> {
    const res = await pool.query(
      `INSERT INTO tasks (id, user_id, lane, ${COPY_COLS})
       SELECT gen_random_uuid()::text, user_id, $4, name, mass, $5, solidity, energy, fixed, alive, tags, created
       FROM tasks WHERE id = $1 AND user_id = $2 AND lane = $3`,
      [taskId, this.userId, fromLane, toLane, positionToAnchor(position)],
    )
    if (res.rowCount === 0) throw new Error(`Task ${taskId} not found in lane ${fromLane}`)
  }
}

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import {
  type Task,
  type TaskWithPosition,
  type PlanState,
  type PlanLaneInfo,
  type PlanTaskInput,
  positionToAnchor,
  taskWithPosition,
  DEFAULT_MASS,
  DEFAULT_SOLIDITY,
} from '../schema.js';
import { type TaskRow, rowToTask } from './types.js';

const LANE_PREFIX = '_plan_lane_';

function laneBranchName(lane: number): string {
  return `${LANE_PREFIX}${lane}`;
}

export function createPlanFns(
  db: Database.Database,
  currentTimelineId: () => string,
) {
  // ── Helpers ──────────────────────────────────────────────────────

  function getMeta(key: string): string | null {
    const row = db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  function setMeta(key: string, value: string): void {
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
  }

  function deleteMeta(key: string): void {
    db.prepare('DELETE FROM meta WHERE key = ?').run(key);
  }

  function getMainTimelineId(): string {
    const row = db
      .prepare("SELECT id FROM timelines WHERE name = 'main'")
      .get() as { id: string };
    return row.id;
  }

  // ── Plan operations ─────────────────────────────────────────────

  function startPlan(windowStart: string, windowEnd: string): PlanState {
    const existing = getMeta('plan_mode');
    if (existing === 'true') {
      throw new Error('Plan mode is already active. End the current plan first.');
    }

    const mainId = getMainTimelineId();
    const now = new Date().toISOString();

    db.transaction(() => {
      for (let i = 1; i <= 5; i++) {
        const branchName = laneBranchName(i);
        const branchId = randomUUID();

        db.prepare(
          'INSERT INTO timelines (id, name, parent_id, created) VALUES (?, ?, ?, ?)',
        ).run(branchId, branchName, mainId, now);

        // Lane 1: snapshot of main river tasks in the window
        if (i === 1) {
          const tasks = db
            .prepare('SELECT * FROM tasks WHERE timeline_id = ? AND anchor IS NOT NULL AND anchor >= ? AND anchor <= ?')
            .all(mainId, windowStart, windowEnd) as TaskRow[];

          const insert = db.prepare(
            `INSERT INTO tasks (id, timeline_id, name, mass, anchor, solidity, energy, fixed, alive, tags, created, cloud_x, cloud_y, river_y)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          );

          for (const task of tasks) {
            insert.run(
              randomUUID(), branchId, task.name, task.mass, task.anchor,
              task.solidity, task.energy, task.fixed, task.alive, task.tags,
              task.created, task.cloud_x, task.cloud_y, task.river_y,
            );
          }
        }
      }

      setMeta('plan_mode', 'true');
      setMeta('plan_window_start', windowStart);
      setMeta('plan_window_end', windowEnd);
    })();

    return getPlanState();
  }

  function fillLane(lane: number, tasks: PlanTaskInput[]): { lane: number; tasks: Task[] } {
    assertPlanActive();
    assertValidLane(lane);

    const branchId = getLaneBranchId(lane);

    db.prepare('DELETE FROM tasks WHERE timeline_id = ?').run(branchId);

    const insert = db.prepare(
      `INSERT INTO tasks (id, timeline_id, name, mass, anchor, solidity, energy, fixed, alive, tags, created)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const created: Task[] = [];
    const now = new Date().toISOString();

    for (const t of tasks) {
      const id = randomUUID();
      const anchor = t.position !== undefined && t.position !== null
        ? positionToAnchor(t.position)
        : null;

      const row: TaskRow = {
        id,
        timeline_id: branchId,
        name: t.name,
        mass: t.mass ?? DEFAULT_MASS,
        anchor,
        solidity: t.solidity ?? DEFAULT_SOLIDITY,
        energy: t.energy ?? 0.5,
        fixed: (t.fixed ?? false) ? 1 : 0,
        alive: 0,
        tags: JSON.stringify(t.tags ?? []),
        created: now,
        cloud_x: null,
        cloud_y: null,
        river_y: null,
      };

      insert.run(
        row.id, row.timeline_id, row.name, row.mass, row.anchor,
        row.solidity, row.energy, row.fixed, row.alive, row.tags, row.created,
      );

      created.push(rowToTask(row));
    }

    return { lane, tasks: created };
  }

  function nameLane(lane: number, label: string): { lane: number; label: string } {
    assertPlanActive();
    assertValidLane(lane);
    setMeta(`plan_lane_${lane}_label`, label);
    return { lane, label };
  }

  function commitLane(lane: number): { committed: number; taskCount: number } {
    assertPlanActive();
    assertValidLane(lane);

    const branchId = getLaneBranchId(lane);
    const mainId = getMainTimelineId();
    const windowStart = getMeta('plan_window_start');
    const windowEnd = getMeta('plan_window_end');

    if (!windowStart || !windowEnd) {
      throw new Error('Plan window not defined');
    }

    let taskCount = 0;

    db.transaction(() => {
      // Delete ONLY main tasks whose anchor falls within the plan window
      db.prepare(
        'DELETE FROM tasks WHERE timeline_id = ? AND anchor IS NOT NULL AND anchor >= ? AND anchor <= ?',
      ).run(mainId, windowStart, windowEnd);

      const countRow = db
        .prepare('SELECT COUNT(*) as cnt FROM tasks WHERE timeline_id = ?')
        .get(branchId) as { cnt: number };
      taskCount = countRow.cnt;

      // Move lane's tasks to main
      db.prepare('UPDATE tasks SET timeline_id = ? WHERE timeline_id = ?')
        .run(mainId, branchId);
    })();

    cleanupPlan();

    return { committed: lane, taskCount };
  }

  function endPlan(): { ended: true } {
    assertPlanActive();
    cleanupPlan();
    return { ended: true };
  }

  function getPlanState(): PlanState {
    const active = getMeta('plan_mode') === 'true';

    if (!active) {
      return { active: false, window_start: null, window_end: null, lanes: [] };
    }

    const windowStart = getMeta('plan_window_start');
    const windowEnd = getMeta('plan_window_end');
    const lanes: PlanLaneInfo[] = [];

    for (let i = 1; i <= 5; i++) {
      const branchName = laneBranchName(i);
      const branch = db
        .prepare('SELECT id FROM timelines WHERE name = ?')
        .get(branchName) as { id: string } | undefined;

      if (branch) {
        const countRow = db
          .prepare('SELECT COUNT(*) as cnt FROM tasks WHERE timeline_id = ?')
          .get(branch.id) as { cnt: number };

        const label = getMeta(`plan_lane_${i}_label`);

        lanes.push({
          number: i,
          label,
          taskCount: countRow.cnt,
          branchName,
          readonly: false,
        });
      }
    }

    return { active, window_start: windowStart, window_end: windowEnd, lanes };
  }

  // ── Lane manipulation (viewer-driven) ───────────────────────────

  function getLaneBranchId(lane: number): string {
    const branch = db
      .prepare('SELECT id FROM timelines WHERE name = ?')
      .get(laneBranchName(lane)) as { id: string } | undefined;
    if (!branch) throw new Error(`Lane ${lane} branch not found`);
    return branch.id;
  }


  function addToLane(lane: number, taskId: string, position: number | null, copy: boolean): void {
    assertPlanActive();
    assertValidLane(lane);

    const branchId = getLaneBranchId(lane);

    const mainId = getMainTimelineId();
    let source = db.prepare('SELECT * FROM tasks WHERE id = ? AND timeline_id = ?').get(taskId, mainId) as TaskRow | undefined;
    if (!source) {
      for (let i = 1; i <= 5; i++) {
        const bid = getLaneBranchId(i);
        source = db.prepare('SELECT * FROM tasks WHERE id = ? AND timeline_id = ?').get(taskId, bid) as TaskRow | undefined;
        if (source) break;
      }
    }
    if (!source) throw new Error(`Task ${taskId} not found`);

    const anchor = position != null ? positionToAnchor(position) : source.anchor;
    db.prepare(
      `INSERT INTO tasks (id, timeline_id, name, mass, anchor, solidity, energy, fixed, alive, tags, created)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), branchId, source.name, source.mass, anchor, source.solidity, source.energy, source.fixed, source.alive, source.tags, source.created);

    if (!copy) {
      db.prepare('DELETE FROM tasks WHERE id = ? AND timeline_id = ?').run(taskId, mainId);
    }
  }

  function removeFromLane(lane: number, taskId: string): void {
    assertPlanActive();
    assertValidLane(lane);

    const branchId = getLaneBranchId(lane);
    db.prepare('DELETE FROM tasks WHERE id = ? AND timeline_id = ?').run(taskId, branchId);
  }

  function updateTaskInLane(lane: number, taskId: string, updates: { mass?: number; solidity?: number; energy?: number; position?: number }): void {
    assertPlanActive();
    assertValidLane(lane);

    const branchId = getLaneBranchId(lane);
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (updates.mass !== undefined) { sets.push('mass = ?'); vals.push(updates.mass); }
    if (updates.solidity !== undefined) { sets.push('solidity = ?'); vals.push(updates.solidity); }
    if (updates.energy !== undefined) { sets.push('energy = ?'); vals.push(updates.energy); }
    if (updates.position !== undefined) { sets.push('anchor = ?'); vals.push(positionToAnchor(updates.position)); }
    if (sets.length === 0) return;
    vals.push(taskId, branchId);
    db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ? AND timeline_id = ?`).run(...vals);
  }

  function laneToCloud(lane: number, taskId: string): void {
    assertPlanActive();
    assertValidLane(lane);

    const branchId = getLaneBranchId(lane);
    const source = db.prepare('SELECT * FROM tasks WHERE id = ? AND timeline_id = ?').get(taskId, branchId) as TaskRow | undefined;
    if (!source) throw new Error(`Task ${taskId} not found in lane ${lane}`);
    const mainId = getMainTimelineId();
    db.transaction(() => {
      db.prepare('DELETE FROM tasks WHERE id = ? AND timeline_id = ?').run(taskId, branchId);
      db.prepare(
        `INSERT INTO tasks (id, timeline_id, name, mass, anchor, solidity, energy, fixed, alive, tags, created)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), mainId, source.name, source.mass, null, source.solidity, source.energy, source.fixed, source.alive, source.tags, source.created);
    })();
  }

  function repositionInLane(lane: number, taskId: string, position: number): void {
    assertPlanActive();
    assertValidLane(lane);

    const branchId = getLaneBranchId(lane);
    const anchor = positionToAnchor(position);
    db.prepare('UPDATE tasks SET anchor = ? WHERE id = ? AND timeline_id = ?').run(anchor, taskId, branchId);
  }

  function moveBetweenLanes(fromLane: number, toLane: number, taskId: string, position: number): void {
    assertPlanActive();
    assertValidLane(fromLane);
    assertValidLane(toLane);

    const fromBranchId = getLaneBranchId(fromLane);
    const toBranchId = getLaneBranchId(toLane);
    const source = db.prepare('SELECT * FROM tasks WHERE id = ? AND timeline_id = ?').get(taskId, fromBranchId) as TaskRow | undefined;
    if (!source) throw new Error(`Task ${taskId} not found in lane ${fromLane}`);

    const anchor = positionToAnchor(position);
    db.transaction(() => {
      db.prepare('DELETE FROM tasks WHERE id = ? AND timeline_id = ?').run(taskId, fromBranchId);
      db.prepare(
        `INSERT INTO tasks (id, timeline_id, name, mass, anchor, solidity, energy, fixed, alive, tags, created)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), toBranchId, source.name, source.mass, anchor, source.solidity, source.energy, source.fixed, source.alive, source.tags, source.created);
    })();
  }

  function putTaskInLane(lane: number, name: string, position: number | null): void {
    assertPlanActive();
    assertValidLane(lane);

    const branchId = getLaneBranchId(lane);
    const anchor = position != null ? positionToAnchor(position) : null;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO tasks (id, timeline_id, name, mass, anchor, solidity, energy, fixed, alive, tags, created)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), branchId, name, DEFAULT_MASS, anchor, DEFAULT_SOLIDITY, 0.5, 0, 0, '[]', now);
  }

  function copyBetweenLanes(fromLane: number, toLane: number, taskId: string, position: number): void {
    assertPlanActive();
    assertValidLane(fromLane);
    assertValidLane(toLane);

    const fromBranchId = getLaneBranchId(fromLane);
    const toBranchId = getLaneBranchId(toLane);
    const source = db.prepare('SELECT * FROM tasks WHERE id = ? AND timeline_id = ?').get(taskId, fromBranchId) as TaskRow | undefined;
    if (!source) throw new Error(`Task ${taskId} not found in lane ${fromLane}`);

    const anchor = positionToAnchor(position);
    db.prepare(
      `INSERT INTO tasks (id, timeline_id, name, mass, anchor, solidity, energy, fixed, alive, tags, created)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), toBranchId, source.name, source.mass, anchor, source.solidity, source.energy, source.fixed, source.alive, source.tags, source.created);
  }

  // ── Internal helpers ────────────────────────────────────────────

  function assertPlanActive(): void {
    if (getMeta('plan_mode') !== 'true') {
      throw new Error('Plan mode is not active. Start a plan first.');
    }
  }

  function assertValidLane(lane: number): void {
    if (lane < 1 || lane > 5 || !Number.isInteger(lane)) {
      throw new Error('Lane must be an integer from 1 to 5');
    }
  }

  function cleanupPlan(): void {
    db.transaction(() => {
      for (let i = 1; i <= 5; i++) {
        const branchName = laneBranchName(i);
        const branch = db
          .prepare('SELECT id FROM timelines WHERE name = ?')
          .get(branchName) as { id: string } | undefined;

        if (branch) {
          db.prepare('DELETE FROM tasks WHERE timeline_id = ?').run(branch.id);
          db.prepare('DELETE FROM timeline_tasks WHERE timeline_id = ?').run(branch.id);
          db.prepare('DELETE FROM timelines WHERE id = ?').run(branch.id);
        }

        deleteMeta(`plan_lane_${i}_label`);
      }

      deleteMeta('plan_mode');
      deleteMeta('plan_window_start');
      deleteMeta('plan_window_end');

      const mainId = getMainTimelineId();
      db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
        .run('current_timeline_id', mainId);
    })();
  }

  function getLaneTasks(lane: number): { river: TaskWithPosition[]; cloud: TaskWithPosition[] } {
    assertValidLane(lane);

    const branchName = laneBranchName(lane);
    const branch = db
      .prepare('SELECT id FROM timelines WHERE name = ?')
      .get(branchName) as { id: string } | undefined;

    if (!branch) {
      return { river: [], cloud: [] };
    }

    const riverRows = db
      .prepare('SELECT * FROM tasks WHERE timeline_id = ? AND anchor IS NOT NULL ORDER BY anchor ASC')
      .all(branch.id) as TaskRow[];

    const cloudRows = db
      .prepare('SELECT * FROM tasks WHERE timeline_id = ? AND anchor IS NULL')
      .all(branch.id) as TaskRow[];

    return {
      river: riverRows.map((r) => taskWithPosition(rowToTask(r))),
      cloud: cloudRows.map((r) => taskWithPosition(rowToTask(r))),
    };
  }

  return { startPlan, fillLane, nameLane, commitLane, endPlan, getPlanState, getLaneTasks, addToLane, removeFromLane, repositionInLane, moveBetweenLanes, copyBetweenLanes, putTaskInLane, laneToCloud, updateTaskInLane };
}

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import {
  type Task,
  type TaskWithPosition,
  type PlanState,
  type PlanLaneInfo,
  type PlanTaskInput,
  type PlanTimeframe,
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

  function startPlan(timeframe: PlanTimeframe): PlanState {
    const existing = getMeta('plan_mode');
    if (existing === 'true') {
      throw new Error('Plan mode is already active. End the current plan first.');
    }

    const mainId = getMainTimelineId();
    const now = new Date().toISOString();

    db.transaction(() => {
      // Create 5 lane branches from main
      for (let i = 1; i <= 5; i++) {
        const branchName = laneBranchName(i);
        const branchId = randomUUID();

        // Create timeline for this lane
        db.prepare(
          'INSERT INTO timelines (id, name, parent_id, created) VALUES (?, ?, ?, ?)',
        ).run(branchId, branchName, mainId, now);

        // Snapshot main's tasks into the lane
        const tasks = db
          .prepare('SELECT * FROM tasks WHERE timeline_id = ?')
          .all(mainId) as TaskRow[];

        const insert = db.prepare(
          `INSERT INTO tasks (id, timeline_id, name, mass, anchor, solidity, energy, fixed, alive, tags, created)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );

        for (const task of tasks) {
          insert.run(
            task.id,
            branchId,
            task.name,
            task.mass,
            task.anchor,
            task.solidity,
            task.energy,
            task.fixed,
            task.alive,
            task.tags,
            task.created,
          );
        }
      }

      // Set plan mode metadata
      setMeta('plan_mode', 'true');
      setMeta('plan_timeframe', timeframe);
    })();

    return getPlanState();
  }

  function fillLane(lane: number, tasks: PlanTaskInput[]): { lane: number; tasks: Task[] } {
    assertPlanActive();
    assertValidLane(lane);

    const branchName = laneBranchName(lane);
    const branch = db
      .prepare('SELECT id FROM timelines WHERE name = ?')
      .get(branchName) as { id: string } | undefined;

    if (!branch) {
      throw new Error(`Lane ${lane} branch not found. Is plan mode active?`);
    }

    const branchId = branch.id;

    // Clear existing tasks in this lane
    db.prepare('DELETE FROM tasks WHERE timeline_id = ?').run(branchId);

    // Insert the new tasks
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
      };

      insert.run(
        row.id,
        row.timeline_id,
        row.name,
        row.mass,
        row.anchor,
        row.solidity,
        row.energy,
        row.fixed,
        row.alive,
        row.tags,
        row.created,
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

    const branchName = laneBranchName(lane);
    const branch = db
      .prepare('SELECT id, parent_id FROM timelines WHERE name = ?')
      .get(branchName) as { id: string; parent_id: string } | undefined;

    if (!branch) {
      throw new Error(`Lane ${lane} branch not found`);
    }

    let taskCount = 0;

    db.transaction(() => {
      // Delete main's tasks
      db.prepare('DELETE FROM tasks WHERE timeline_id = ?').run(branch.parent_id);

      // Count tasks being committed
      const countRow = db
        .prepare('SELECT COUNT(*) as cnt FROM tasks WHERE timeline_id = ?')
        .get(branch.id) as { cnt: number };
      taskCount = countRow.cnt;

      // Move lane's tasks to main
      db.prepare('UPDATE tasks SET timeline_id = ? WHERE timeline_id = ?')
        .run(branch.parent_id, branch.id);

      // Mark committed
      db.prepare('UPDATE timelines SET committed_at = ? WHERE id = ?')
        .run(new Date().toISOString(), branch.id);

      // Switch back to main
      db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
        .run('current_timeline_id', branch.parent_id);
    })();

    // End plan mode after committing
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
      return { active: false, timeframe: null, lanes: [] };
    }

    const timeframe = (getMeta('plan_timeframe') as PlanTimeframe) ?? null;
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
        });
      }
    }

    return { active, timeframe, lanes };
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
      // Delete all lane branches and their tasks
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

        // Clean up lane labels
        deleteMeta(`plan_lane_${i}_label`);
      }

      // Clean up plan meta
      deleteMeta('plan_mode');
      deleteMeta('plan_timeframe');

      // Ensure we're on main
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

  return { startPlan, fillLane, nameLane, commitLane, endPlan, getPlanState, getLaneTasks };
}

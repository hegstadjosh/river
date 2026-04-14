import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { type ServerResponse } from 'http';
import {
  type Task,
  type TaskWithPosition,
  type Timeline,
  type LookResult,
  type BranchDiff,
  type PutSingleInput,
  type PlanState,
  type PlanTaskInput,
  DEFAULT_MASS,
  DEFAULT_SOLIDITY,
  DB_NAME,
} from './schema.js';
import { createTaskCrud } from './db/tasks.js';
import { createMoveFns } from './db/move.js';
import { createRecirculateFn } from './db/recirculate.js';
import { createLookFns } from './db/look.js';
import { createBranchFns } from './db/branches.js';
import { createSweepFn } from './db/sweep.js';
import { createPlanFns } from './db/plan.js';

// ── RiverState ───────────────────────────────────────────────────────

export class RiverState {
  private db: Database.Database;
  private sseClients: Set<ServerResponse> = new Set();

  // Composed modules
  private taskCrud: ReturnType<typeof createTaskCrud>;
  private moveFns: ReturnType<typeof createMoveFns>;
  private recirculateFn: ReturnType<typeof createRecirculateFn>;
  private lookFns: ReturnType<typeof createLookFns>;
  private branchFns: ReturnType<typeof createBranchFns>;
  private sweepFn: ReturnType<typeof createSweepFn>;
  private planFns: ReturnType<typeof createPlanFns>;

  constructor(dbDir: string) {
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }
    this.db = new Database(join(dbDir, DB_NAME));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.init();

    // Wire up modules — order matters because look depends on recirculate and getTask
    const currentTimelineId = () => this.currentTimelineId();
    const getCurrentTimeline = () => this.getCurrentTimeline();

    this.taskCrud = createTaskCrud(this.db, currentTimelineId);
    this.recirculateFn = createRecirculateFn(this.db, currentTimelineId);
    this.moveFns = createMoveFns(this.db, currentTimelineId, this.taskCrud.getTask);
    this.lookFns = createLookFns(
      this.db,
      currentTimelineId,
      getCurrentTimeline,
      this.taskCrud.getTask,
      this.recirculateFn.recirculate,
    );
    this.branchFns = createBranchFns(this.db, currentTimelineId);
    this.sweepFn = createSweepFn(this.db, currentTimelineId);
    this.planFns = createPlanFns(this.db, currentTimelineId);
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS timelines (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        parent_id TEXT,
        created TEXT NOT NULL,
        committed_at TEXT,
        FOREIGN KEY (parent_id) REFERENCES timelines(id)
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        timeline_id TEXT NOT NULL,
        name TEXT NOT NULL,
        mass REAL NOT NULL DEFAULT ${DEFAULT_MASS},
        anchor TEXT,
        solidity REAL NOT NULL DEFAULT ${DEFAULT_SOLIDITY},
        energy REAL NOT NULL DEFAULT 0.5,
        fixed INTEGER NOT NULL DEFAULT 0,
        alive INTEGER NOT NULL DEFAULT 0,
        tags TEXT NOT NULL DEFAULT '[]',
        created TEXT NOT NULL,
        cloud_x REAL,
        cloud_y REAL,
        river_y REAL,
        FOREIGN KEY (timeline_id) REFERENCES timelines(id)
      );

      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Migrate: add cloud_x/cloud_y columns if missing
    try { this.db.prepare('SELECT cloud_x FROM tasks LIMIT 0').run(); }
    catch { this.db.exec('ALTER TABLE tasks ADD COLUMN cloud_x REAL; ALTER TABLE tasks ADD COLUMN cloud_y REAL;'); }
    try { this.db.prepare('SELECT river_y FROM tasks LIMIT 0').run(); }
    catch { this.db.exec('ALTER TABLE tasks ADD COLUMN river_y REAL;'); }

    // Ensure a default "main" timeline exists
    const existing = this.db
      .prepare('SELECT id FROM timelines WHERE name = ?')
      .get('main') as { id: string } | undefined;

    if (!existing) {
      const id = randomUUID();
      this.db
        .prepare('INSERT INTO timelines (id, name, created) VALUES (?, ?, ?)')
        .run(id, 'main', new Date().toISOString());
      this.db
        .prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
        .run('current_timeline_id', id);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────

  close() {
    this.db.close();
  }

  getTableNames(): string[] {
    const rows = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  private currentTimelineId(): string {
    const row = this.db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get('current_timeline_id') as { value: string };
    return row.value;
  }

  getCurrentTimeline(): Timeline {
    const id = this.currentTimelineId();
    return this.db
      .prepare('SELECT * FROM timelines WHERE id = ?')
      .get(id) as Timeline;
  }

  // ── Task CRUD (delegated) ────────────────────────────────────────

  putTask(input: PutSingleInput & { position?: number | null }): Task {
    return this.taskCrud.putTask(input);
  }

  getTask(id: string): Task | null {
    return this.taskCrud.getTask(id);
  }

  deleteTask(id: string): void {
    this.taskCrud.deleteTask(id);
  }

  // ── Move (delegated) ────────────────────────────────────────────

  moveTask(id: string, position: number | null): Task {
    return this.moveFns.moveTask(id, position);
  }

  moveTasks(ids: string[], shift: number): Task[] {
    return this.moveFns.moveTasks(ids, shift);
  }

  // ── Look (delegated) ────────────────────────────────────────────

  look(options?: { horizon?: number; id?: string; cloud?: boolean }): LookResult {
    const result = this.lookFns.look(options);
    const planState = this.planFns.getPlanState();
    if (planState.active) {
      // Enrich plan lanes with full task data for the viewer
      const enrichedLanes = planState.lanes.map((lane) => {
        const tasks = this.planFns.getLaneTasks(lane.number);
        return {
          ...lane,
          tasks: [...tasks.river, ...tasks.cloud],
        };
      });
      result.plan = { ...planState, lanes: enrichedLanes };
    }
    // Include persistent tag list
    result.known_tags = this.getKnownTags();
    return result;
  }

  getKnownTags(): string[] {
    const raw = this.db.prepare("SELECT value FROM meta WHERE key = 'known_tags'").get() as { value: string } | undefined;
    const tags: string[] = raw ? JSON.parse(raw.value) : [];
    return tags.sort();
  }

  addKnownTag(tag: string): void {
    const tags = this.getKnownTags();
    if (tags.indexOf(tag) < 0) {
      tags.push(tag);
      this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('known_tags', ?)").run(JSON.stringify(tags));
    }
  }

  ensureTaskTags(taskTags: string[] | undefined): void {
    if (!taskTags) return;
    for (const tag of taskTags) this.addKnownTag(tag);
  }

  // ── Recirculation (delegated) ───────────────────────────────────

  recirculate(): Task[] {
    return this.recirculateFn.recirculate();
  }

  // ── Timeline Operations (delegated) ─────────────────────────────

  createBranch(name: string): Timeline {
    return this.branchFns.createBranch(name);
  }

  listBranches(): Timeline[] {
    return this.branchFns.listBranches();
  }

  switchBranch(name: string): void {
    this.branchFns.switchBranch(name);
  }

  commitBranch(name: string): void {
    this.branchFns.commitBranch(name);
  }

  diffBranches(aName: string, bName: string): BranchDiff {
    return this.branchFns.diffBranches(aName, bName);
  }

  deleteBranch(name: string): void {
    this.branchFns.deleteBranch(name);
  }

  // ── Sweep (delegated) ──────────────────────────────────────────

  sweep(
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
    return this.sweepFn.sweep(filter, action, params);
  }

  // ── Plan Mode (delegated) ────────────────────────────────────────

  startPlan(windowStart: string, windowEnd: string): PlanState {
    return this.planFns.startPlan(windowStart, windowEnd);
  }

  fillLane(lane: number, tasks: PlanTaskInput[]): { lane: number; tasks: Task[] } {
    return this.planFns.fillLane(lane, tasks);
  }

  nameLane(lane: number, label: string): { lane: number; label: string } {
    return this.planFns.nameLane(lane, label);
  }

  commitLane(lane: number): { committed: number; taskCount: number } {
    return this.planFns.commitLane(lane);
  }

  endPlan(): { ended: true } {
    return this.planFns.endPlan();
  }

  getPlanState(): PlanState {
    return this.planFns.getPlanState();
  }

  getLaneTasks(lane: number): { river: TaskWithPosition[]; cloud: TaskWithPosition[] } {
    return this.planFns.getLaneTasks(lane);
  }

  addToLane(lane: number, taskId: string, position: number | null, copy: boolean): void {
    this.planFns.addToLane(lane, taskId, position, copy);
  }

  removeFromLane(lane: number, taskId: string): void {
    this.planFns.removeFromLane(lane, taskId);
  }

  repositionInLane(lane: number, taskId: string, position: number): void {
    this.planFns.repositionInLane(lane, taskId, position);
  }

  moveBetweenLanes(fromLane: number, toLane: number, taskId: string, position: number): void {
    this.planFns.moveBetweenLanes(fromLane, toLane, taskId, position);
  }

  copyBetweenLanes(fromLane: number, toLane: number, taskId: string, position: number): void {
    this.planFns.copyBetweenLanes(fromLane, toLane, taskId, position);
  }

  laneToCloud(lane: number, taskId: string): void {
    this.planFns.laneToCloud(lane, taskId);
  }

  updateTaskInLane(lane: number, taskId: string, updates: { mass?: number; solidity?: number; energy?: number; position?: number }): void {
    this.planFns.updateTaskInLane(lane, taskId, updates);
  }

  putTaskInLane(lane: number, name: string, position: number | null): void {
    this.planFns.putTaskInLane(lane, name, position);
  }

  // ── SSE ──────────────────────────────────────────────────────────

  addSSEClient(res: ServerResponse): void {
    this.sseClients.add(res);
    res.on('close', () => this.sseClients.delete(res));
  }

  notify(): void {
    const data = JSON.stringify(this.look());
    for (const client of this.sseClients) {
      client.write(`data: ${data}\n\n`);
    }
  }
}

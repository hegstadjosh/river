import { z } from 'zod';

// ── Types ────────────────────────────────────────────────────────────

export interface Task {
  id: string;
  name: string;
  mass: number;
  anchor: string | null; // ISO timestamp or null (cloud)
  solidity: number;
  energy: number;
  fixed: boolean;
  alive: boolean;
  tags: string[];
  created: string;
  cloud_x: number | null; // 0-1 normalized X in cloud zone
  cloud_y: number | null; // 0-1 normalized Y in cloud zone
}

export interface TaskWithPosition extends Task {
  position: number | null; // computed: hours from now (null = cloud)
}

export interface Timeline {
  id: string;
  name: string;
  parent_id: string | null;
  created: string;
  committed_at: string | null;
}

export interface LookResult {
  river: TaskWithPosition[];
  cloud: TaskWithPosition[];
  breathing_room: {
    next_4h: number;
    rest_of_day: number;
  };
  now: string;
  timeline: string;
  plan?: PlanState;
}

export interface BranchDiff {
  added: TaskWithPosition[];
  removed: TaskWithPosition[];
  modified: Array<{
    task_id: string;
    name: string;
    changes: Record<string, { from: unknown; to: unknown }>;
  }>;
}

// ── Conversion Helpers ───────────────────────────────────────────────

export function positionToAnchor(position: number): string {
  return new Date(Date.now() + position * 3_600_000).toISOString();
}

export function anchorToPosition(anchor: string): number {
  return (new Date(anchor).getTime() - Date.now()) / 3_600_000;
}

export function taskWithPosition(task: Task): TaskWithPosition {
  return {
    ...task,
    position: task.anchor ? anchorToPosition(task.anchor) : null,
  };
}

// ── Zod Schemas (for MCP tool input validation) ──────────────────────

export const PutSingleSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  mass: z.number().positive().optional(),
  position: z.number().nullable().optional(),
  solidity: z.number().min(0).max(1).optional(),
  energy: z.number().min(0).max(1).optional(),
  fixed: z.boolean().optional(),
  alive: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
});

export type PutSingleInput = z.infer<typeof PutSingleSchema>;

export const MoveSchema = z.object({
  id: z.string().optional(),
  ids: z.array(z.string()).optional(),
  position: z.number().nullable().optional(),
  shift: z.number().optional(),
});

export const LookSchema = z.object({
  horizon: z.number().positive().optional(),
  id: z.string().optional(),
  cloud: z.boolean().optional(),
});

export const BranchSchema = z.object({
  action: z.enum(['create', 'list', 'switch', 'commit', 'diff', 'delete']),
  name: z.string().optional(),
  a: z.string().optional(),
  b: z.string().optional(),
});

export const SweepFilterSchema = z.object({
  in_river: z.boolean().optional(),
  cloud: z.boolean().optional(),
  solidity_above: z.number().optional(),
  solidity_below: z.number().optional(),
  tag: z.string().optional(),
  fixed: z.boolean().optional(),
  id_not: z.string().optional(),
  alive: z.boolean().optional(),
});

export const SweepSchema = z.object({
  filter: SweepFilterSchema.optional(),
  action: z.enum(['shift', 'set', 'remove']),
  shift: z.number().optional(),
  solidity: z.number().min(0).max(1).optional(),
  mass: z.number().positive().optional(),
  position: z.number().nullable().optional(),
});

export const PLAN_TIMEFRAMES = ['6h', 'day', '4d', 'week', 'month', 'quarter', 'year'] as const;
export type PlanTimeframe = typeof PLAN_TIMEFRAMES[number];

export const PlanTaskSchema = z.object({
  name: z.string().describe('Task name'),
  mass: z.number().positive().optional().describe('Duration in minutes (default 30)'),
  position: z.number().nullable().optional().describe('Hours from now (null = cloud)'),
  solidity: z.number().min(0).max(1).optional().describe('Commitment level 0-1'),
  energy: z.number().min(0).max(1).optional().describe('Energy level 0-1'),
  fixed: z.boolean().optional().describe('Whether this task is pinned in time'),
  tags: z.array(z.string()).optional().describe('Tags for grouping'),
});

export type PlanTaskInput = z.infer<typeof PlanTaskSchema>;

export const PlanSchema = z.object({
  action: z.enum(['start', 'fill', 'name', 'commit', 'end', 'status']),
  timeframe: z.enum(PLAN_TIMEFRAMES).optional(),
  lane: z.number().int().min(1).max(5).optional(),
  label: z.string().optional(),
  tasks: z.array(PlanTaskSchema).optional(),
});

export type PlanInput = z.infer<typeof PlanSchema>;

export interface PlanLaneInfo {
  number: number;
  label: string | null;
  taskCount: number;
  branchName: string;
}

export interface PlanState {
  active: boolean;
  timeframe: PlanTimeframe | null;
  lanes: PlanLaneInfo[];
}

// ── Constants ────────────────────────────────────────────────────────

export const DEFAULT_MASS = 30;
export const DEFAULT_SOLIDITY = 0.1;
export const HTTP_PORT = 7433;
export const DB_DIR = '.river';
export const DB_NAME = 'river.db';

// Shared types — mirrors src/schema.ts from the MCP server

export interface Task {
  id: string;
  name: string;
  mass: number;
  anchor: string | null;
  solidity: number;
  energy: number;
  fixed: boolean;
  alive: boolean;
  tags: string[];
  created: string;
  cloud_x: number | null;
  cloud_y: number | null;
  river_y: number | null;
}

export interface TaskWithPosition extends Task {
  position: number | null;
}

export interface PlanLaneInfo {
  number: number;
  label: string | null;
  taskCount: number;
  branchName: string;
  readonly: boolean;
}

export interface PlanState {
  active: boolean;
  window_start: string | null;
  window_end: string | null;
  lanes: PlanLaneInfo[];
}

export interface LookResult {
  river: TaskWithPosition[];
  cloud: TaskWithPosition[];
  breathing_room: { next_4h: number; rest_of_day: number };
  now: string;
  timeline: string;
  known_tags?: string[];
  plan?: PlanState & { lanes: (PlanLaneInfo & { tasks: TaskWithPosition[] })[] };
}

// ── Helpers ──────────────────────────────────────────────────────

export const DEFAULT_MASS = 30;
export const DEFAULT_SOLIDITY = 0.1;

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

// Supabase row → Task
export function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    name: row.name as string,
    mass: row.mass as number,
    anchor: row.anchor as string | null,
    solidity: row.solidity as number,
    energy: row.energy as number,
    fixed: row.fixed as boolean,
    alive: row.alive as boolean,
    tags: (row.tags ?? []) as string[],
    created: row.created as string,
    cloud_x: (row.cloud_x ?? null) as number | null,
    cloud_y: (row.cloud_y ?? null) as number | null,
    river_y: (row.river_y ?? null) as number | null,
  };
}

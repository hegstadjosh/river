import type { Task } from '../schema.js';

// ── Row types (SQLite stores booleans as 0/1, tags as JSON string) ───

export interface TaskRow {
  id: string;
  timeline_id: string;
  name: string;
  mass: number;
  anchor: string | null;
  solidity: number;
  energy: number;
  fixed: number;
  alive: number;
  tags: string;
  created: string;
}

export function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    name: row.name,
    mass: row.mass,
    anchor: row.anchor,
    solidity: row.solidity,
    energy: row.energy,
    fixed: row.fixed === 1,
    alive: row.alive === 1,
    tags: JSON.parse(row.tags),
    created: row.created,
  };
}

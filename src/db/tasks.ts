import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import {
  type Task,
  type PutSingleInput,
  positionToAnchor,
  DEFAULT_MASS,
  DEFAULT_SOLIDITY,
} from '../schema.js';
import { type TaskRow, rowToTask } from './types.js';

export function createTaskCrud(db: Database.Database, currentTimelineId: () => string) {
  function putTask(input: PutSingleInput & { position?: number | null }): Task {
    const timelineId = currentTimelineId();

    // Convert position to anchor if provided
    let anchor: string | null | undefined = undefined;
    if (input.position !== undefined) {
      anchor = input.position === null ? null : positionToAnchor(input.position);
    }

    if (input.id) {
      // Update existing task
      const existing = db
        .prepare('SELECT * FROM tasks WHERE id = ? AND timeline_id = ?')
        .get(input.id, timelineId) as TaskRow | undefined;

      if (!existing) {
        throw new Error(`Task ${input.id} not found`);
      }

      // If setting alive=true, clear other alive tasks
      if (input.alive === true) {
        db
          .prepare('UPDATE tasks SET alive = 0 WHERE timeline_id = ? AND alive = 1')
          .run(timelineId);
      }

      const updates: string[] = [];
      const values: Record<string, unknown> = { id: input.id, tid: timelineId };

      if (input.name !== undefined) { updates.push('name = @name_val'); values.name_val = input.name; }
      if (input.mass !== undefined) { updates.push('mass = @mass_val'); values.mass_val = input.mass; }
      if (anchor !== undefined) { updates.push('anchor = @anchor_val'); values.anchor_val = anchor; }
      if (input.solidity !== undefined) { updates.push('solidity = @sol_val'); values.sol_val = input.solidity; }
      if (input.energy !== undefined) { updates.push('energy = @energy_val'); values.energy_val = input.energy; }
      if (input.fixed !== undefined) { updates.push('fixed = @fixed_val'); values.fixed_val = input.fixed ? 1 : 0; }
      if (input.alive !== undefined) { updates.push('alive = @alive_val'); values.alive_val = input.alive ? 1 : 0; }
      if (input.tags !== undefined) { updates.push('tags = @tags_val'); values.tags_val = JSON.stringify(input.tags); }

      if (updates.length > 0) {
        db
          .prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = @id AND timeline_id = @tid`)
          .run(values);
      }

      return getTask(input.id)!;
    } else {
      // Create new task
      if (!input.name) {
        throw new Error('Name is required when creating a task');
      }

      // If setting alive=true, clear other alive tasks
      if (input.alive === true) {
        db
          .prepare('UPDATE tasks SET alive = 0 WHERE timeline_id = ? AND alive = 1')
          .run(timelineId);
      }

      const id = randomUUID();
      const task: TaskRow = {
        id,
        timeline_id: timelineId,
        name: input.name,
        mass: input.mass ?? DEFAULT_MASS,
        anchor: anchor ?? null,
        solidity: input.solidity ?? DEFAULT_SOLIDITY,
        energy: input.energy ?? 0.5,
        fixed: (input.fixed ?? false) ? 1 : 0,
        alive: (input.alive ?? false) ? 1 : 0,
        tags: JSON.stringify(input.tags ?? []),
        created: new Date().toISOString(),
      };

      db
        .prepare(
          `INSERT INTO tasks (id, timeline_id, name, mass, anchor, solidity, energy, fixed, alive, tags, created)
           VALUES (@id, @timeline_id, @name, @mass, @anchor, @solidity, @energy, @fixed, @alive, @tags, @created)`
        )
        .run(task);

      return rowToTask(task);
    }
  }

  function getTask(id: string): Task | null {
    const timelineId = currentTimelineId();
    const row = db
      .prepare('SELECT * FROM tasks WHERE id = ? AND timeline_id = ?')
      .get(id, timelineId) as TaskRow | undefined;
    return row ? rowToTask(row) : null;
  }

  function deleteTask(id: string): void {
    const timelineId = currentTimelineId();
    db
      .prepare('DELETE FROM tasks WHERE id = ? AND timeline_id = ?')
      .run(id, timelineId);
  }

  return { putTask, getTask, deleteTask };
}

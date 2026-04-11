import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RiverState } from '../src/state.js';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

describe('Plan Mode', () => {
  let state: RiverState;
  let tmpDir: string;

  const windowStart = new Date(Date.now() - 2 * 3_600_000).toISOString();
  const windowEnd = new Date(Date.now() + 12 * 3_600_000).toISOString();

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'river-plan-test-'));
    state = new RiverState(tmpDir);
  });

  afterEach(() => {
    state.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('startPlan', () => {
    it('creates lane 1 with tasks in window and lanes 2-5 empty', () => {
      state.putTask({ name: 'In window', position: 1.0 });
      state.putTask({ name: 'Cloud task' }); // no anchor

      const plan = state.startPlan(windowStart, windowEnd);
      expect(plan.active).toBe(true);
      expect(plan.window_start).toBe(windowStart);
      expect(plan.window_end).toBe(windowEnd);
      expect(plan.lanes).toHaveLength(5);

      const lane1 = plan.lanes.find((l) => l.number === 1)!;
      expect(lane1.taskCount).toBe(1);
      expect(lane1.readonly).toBe(false);

      for (let i = 2; i <= 5; i++) {
        const lane = plan.lanes.find((l) => l.number === i)!;
        expect(lane.taskCount).toBe(0);
        expect(lane.readonly).toBe(false);
        expect(lane.label).toBeNull();
      }
    });

    it('does not include tasks outside the window in lane 1', () => {
      const farFuture = new Date(Date.now() + 48 * 3_600_000).toISOString();
      state.putTask({ name: 'Far future', position: 48 });

      const narrowEnd = new Date(Date.now() + 4 * 3_600_000).toISOString();
      const plan = state.startPlan(windowStart, narrowEnd);

      const lane1 = plan.lanes.find((l) => l.number === 1)!;
      expect(lane1.taskCount).toBe(0);
    });

    it('throws if plan mode is already active', () => {
      state.startPlan(windowStart, windowEnd);
      expect(() => state.startPlan(windowStart, windowEnd)).toThrow('Plan mode is already active');
    });
  });

  describe('fillLane', () => {
    it('populates a lane with tasks', () => {
      state.startPlan(windowStart, windowEnd);
      const result = state.fillLane(2, [
        { name: 'Task A', mass: 60, position: 1.0 },
        { name: 'Task B', position: 2.0 },
        { name: 'Task C' },
      ]);
      expect(result.lane).toBe(2);
      expect(result.tasks).toHaveLength(3);
      expect(result.tasks[0].name).toBe('Task A');
      expect(result.tasks[0].mass).toBe(60);
      expect(result.tasks[1].name).toBe('Task B');
      expect(result.tasks[1].mass).toBe(30); // default
      expect(result.tasks[2].name).toBe('Task C');
      expect(result.tasks[2].anchor).toBeNull();
    });

    it('clears existing tasks on refill', () => {
      state.startPlan(windowStart, windowEnd);
      state.fillLane(2, [{ name: 'Old task' }]);
      const result = state.fillLane(2, [{ name: 'New task' }]);
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].name).toBe('New task');

      const planState = state.getPlanState();
      const lane2 = planState.lanes.find((l) => l.number === 2);
      expect(lane2!.taskCount).toBe(1);
    });

    it('throws when plan mode is not active', () => {
      expect(() => state.fillLane(2, [{ name: 'X' }])).toThrow('Plan mode is not active');
    });
  });

  describe('nameLane', () => {
    it('sets a label on a lane', () => {
      state.startPlan(windowStart, windowEnd);
      const result = state.nameLane(3, 'Morning Focus');
      expect(result.lane).toBe(3);
      expect(result.label).toBe('Morning Focus');

      const planState = state.getPlanState();
      const lane3 = planState.lanes.find((l) => l.number === 3);
      expect(lane3!.label).toBe('Morning Focus');
    });
  });

  describe('commitLane', () => {
    it('merges lane tasks to main and ends plan mode', () => {
      state.putTask({ name: 'Main task', position: 1.0 });

      state.startPlan(windowStart, windowEnd);
      state.fillLane(2, [
        { name: 'Planned A', position: 2.0 },
        { name: 'Planned B', position: 3.0 },
      ]);

      const result = state.commitLane(2);
      expect(result.committed).toBe(2);
      expect(result.taskCount).toBe(2);

      const planState = state.getPlanState();
      expect(planState.active).toBe(false);

      const look = state.look();
      const names = look.river.map((t) => t.name).sort();
      expect(names).toContain('Planned A');
      expect(names).toContain('Planned B');
    });

    it('only removes main tasks within the window (tasks outside survive)', () => {
      const farFutureAnchor = new Date(Date.now() + 48 * 3_600_000).toISOString();

      state.putTask({ name: 'In window', position: 1.0 });
      state.putTask({ name: 'Outside window', position: 48 });

      const narrowEnd = new Date(Date.now() + 4 * 3_600_000).toISOString();
      state.startPlan(windowStart, narrowEnd);

      state.fillLane(2, [{ name: 'Replacement', position: 2.0 }]);
      state.commitLane(2);

      const look = state.look();
      const names = look.river.map((t) => t.name);
      expect(names).toContain('Replacement');
      expect(names).toContain('Outside window');
      expect(names).not.toContain('In window');
    });
  });

  describe('endPlan', () => {
    it('discards all lanes and exits plan mode', () => {
      state.startPlan(windowStart, windowEnd);
      state.fillLane(2, [{ name: 'Discard me' }]);
      state.fillLane(3, [{ name: 'Discard me too' }]);
      state.nameLane(2, 'Doomed');

      const result = state.endPlan();
      expect(result.ended).toBe(true);

      const planState = state.getPlanState();
      expect(planState.active).toBe(false);
      expect(planState.lanes).toHaveLength(0);
    });

    it('preserves existing main tasks after discard', () => {
      state.putTask({ name: 'Keep me', position: 1.0 });
      state.startPlan(windowStart, windowEnd);
      state.fillLane(2, [{ name: 'Throwaway' }]);
      state.endPlan();

      const look = state.look();
      expect(look.river).toHaveLength(1);
      expect(look.river[0].name).toBe('Keep me');
    });
  });

  describe('getPlanState', () => {
    it('returns inactive state when no plan', () => {
      const plan = state.getPlanState();
      expect(plan.active).toBe(false);
      expect(plan.window_start).toBeNull();
      expect(plan.window_end).toBeNull();
      expect(plan.lanes).toHaveLength(0);
    });

    it('returns correct active state with window and lanes', () => {
      state.putTask({ name: 'River task', position: 1.0 });

      state.startPlan(windowStart, windowEnd);
      state.fillLane(3, [{ name: 'C' }]);
      state.nameLane(2, 'Option Alpha');

      const plan = state.getPlanState();
      expect(plan.active).toBe(true);
      expect(plan.window_start).toBe(windowStart);
      expect(plan.window_end).toBe(windowEnd);
      expect(plan.lanes).toHaveLength(5);

      const lane1 = plan.lanes.find((l) => l.number === 1)!;
      expect(lane1.taskCount).toBe(1);
      expect(lane1.readonly).toBe(false);

      const lane3 = plan.lanes.find((l) => l.number === 3)!;
      expect(lane3.taskCount).toBe(1);

      const lane2 = plan.lanes.find((l) => l.number === 2)!;
      expect(lane2.taskCount).toBe(0);
      expect(lane2.label).toBe('Option Alpha');
    });
  });

  describe('putTaskInLane', () => {
    it('creates a task directly in a lane with position', () => {
      state.startPlan(windowStart, windowEnd);
      state.putTaskInLane(2, 'Direct task', 2.5);

      const tasks = state.getLaneTasks(2);
      expect(tasks.river).toHaveLength(1);
      expect(tasks.river[0].name).toBe('Direct task');
      expect(tasks.river[0].position).not.toBeNull();
    });

    it('creates a cloud task in a lane with null position', () => {
      state.startPlan(windowStart, windowEnd);
      state.putTaskInLane(2, 'Cloud task', null);

      const tasks = state.getLaneTasks(2);
      expect(tasks.cloud).toHaveLength(1);
      expect(tasks.cloud[0].name).toBe('Cloud task');
    });

  });

  describe('addToLane', () => {
    it('copies a main task into a lane (copy mode)', () => {
      const task = state.putTask({ name: 'Main task', position: 1.0 });
      state.startPlan(windowStart, windowEnd);

      state.addToLane(2, task.id, 2.0, true);

      const laneTasks = state.getLaneTasks(2);
      expect(laneTasks.river).toHaveLength(1);
      expect(laneTasks.river[0].name).toBe('Main task');

      const mainTask = state.getTask(task.id);
      expect(mainTask).not.toBeNull();
    });

    it('moves a main task into a lane (non-copy mode)', () => {
      const task = state.putTask({ name: 'Main task', position: 1.0 });
      state.startPlan(windowStart, windowEnd);

      state.addToLane(2, task.id, 2.0, false);

      const laneTasks = state.getLaneTasks(2);
      expect(laneTasks.river).toHaveLength(1);

      const mainTask = state.getTask(task.id);
      expect(mainTask).toBeNull();
    });

  });

  describe('removeFromLane', () => {
    it('deletes a task from a lane', () => {
      state.startPlan(windowStart, windowEnd);
      const filled = state.fillLane(2, [
        { name: 'Keep' },
        { name: 'Remove' },
      ]);
      const removeId = filled.tasks[1].id;

      state.removeFromLane(2, removeId);

      const tasks = state.getLaneTasks(2);
      const allNames = [...tasks.river, ...tasks.cloud].map((t) => t.name);
      expect(allNames).toEqual(['Keep']);
    });

  });

  describe('laneToCloud', () => {
    it('moves a lane task to the main cloud', () => {
      state.startPlan(windowStart, windowEnd);
      const filled = state.fillLane(2, [{ name: 'To cloud', position: 1.0 }]);
      const taskId = filled.tasks[0].id;

      state.laneToCloud(2, taskId);

      const laneTasks = state.getLaneTasks(2);
      expect(laneTasks.river).toHaveLength(0);
      expect(laneTasks.cloud).toHaveLength(0);

      const look = state.look();
      expect(look.cloud).toHaveLength(1);
      expect(look.cloud[0].name).toBe('To cloud');
    });

    it('throws if task not found in lane', () => {
      state.startPlan(windowStart, windowEnd);
      expect(() => state.laneToCloud(2, 'nonexistent')).toThrow('not found');
    });

  });

  describe('updateTaskInLane', () => {
    it('updates task fields in a lane', () => {
      state.startPlan(windowStart, windowEnd);
      const filled = state.fillLane(2, [{ name: 'Updatable', position: 1.0 }]);
      const taskId = filled.tasks[0].id;

      state.updateTaskInLane(2, taskId, {
        mass: 90,
        solidity: 0.8,
        energy: 0.9,
      });

      const tasks = state.getLaneTasks(2);
      const updated = tasks.river[0];
      expect(updated.mass).toBe(90);
      expect(updated.solidity).toBeCloseTo(0.8);
      expect(updated.energy).toBeCloseTo(0.9);
    });

    it('updates position in a lane', () => {
      state.startPlan(windowStart, windowEnd);
      const filled = state.fillLane(2, [{ name: 'Repositioned', position: 1.0 }]);
      const taskId = filled.tasks[0].id;

      state.updateTaskInLane(2, taskId, { position: 5.0 });

      const tasks = state.getLaneTasks(2);
      const updated = tasks.river[0];
      expect(updated.position).not.toBeNull();
      expect(updated.position!).toBeGreaterThan(4.0);
      expect(updated.position!).toBeLessThan(6.0);
    });

  });

  describe('moveBetweenLanes', () => {
    it('moves a task from one lane to another', () => {
      state.startPlan(windowStart, windowEnd);
      const filled = state.fillLane(2, [{ name: 'Traveler', position: 1.0 }]);
      const taskId = filled.tasks[0].id;

      state.moveBetweenLanes(2, 3, taskId, 2.0);

      const lane2 = state.getLaneTasks(2);
      expect(lane2.river).toHaveLength(0);
      expect(lane2.cloud).toHaveLength(0);

      const lane3 = state.getLaneTasks(3);
      expect(lane3.river).toHaveLength(1);
      expect(lane3.river[0].name).toBe('Traveler');
    });

    it('throws if task not found in source lane', () => {
      state.startPlan(windowStart, windowEnd);
      expect(() => state.moveBetweenLanes(2, 3, 'nonexistent', 1.0)).toThrow('not found');
    });

  });

  describe('repositionInLane', () => {
    it('changes task position within a lane', () => {
      state.startPlan(windowStart, windowEnd);
      const filled = state.fillLane(2, [{ name: 'Slider', position: 1.0 }]);
      const taskId = filled.tasks[0].id;

      state.repositionInLane(2, taskId, 8.0);

      const tasks = state.getLaneTasks(2);
      const task = tasks.river[0];
      expect(task.position).not.toBeNull();
      expect(task.position!).toBeGreaterThan(7.0);
      expect(task.position!).toBeLessThan(9.0);
    });

  });

  describe('lane validation', () => {
    it('rejects lane 0', () => {
      state.startPlan(windowStart, windowEnd);
      expect(() => state.fillLane(0, [{ name: 'X' }])).toThrow('Lane must be an integer from 1 to 5');
    });

    it('rejects lane 6', () => {
      state.startPlan(windowStart, windowEnd);
      expect(() => state.fillLane(6, [{ name: 'X' }])).toThrow('Lane must be an integer from 1 to 5');
    });

    it('rejects non-integer lane', () => {
      state.startPlan(windowStart, windowEnd);
      expect(() => state.fillLane(2.5, [{ name: 'X' }])).toThrow('Lane must be an integer from 1 to 5');
    });
  });
});

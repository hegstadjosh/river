import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RiverState } from '../src/state.js';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

describe('Plan Mode', () => {
  let state: RiverState;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'river-plan-test-'));
    state = new RiverState(tmpDir);
  });

  afterEach(() => {
    state.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('startPlan', () => {
    it('creates 5 empty lanes and sets plan mode active', () => {
      const plan = state.startPlan('day');
      expect(plan.active).toBe(true);
      expect(plan.timeframe).toBe('day');
      expect(plan.lanes).toHaveLength(5);
      for (let i = 0; i < 5; i++) {
        expect(plan.lanes[i].number).toBe(i + 1);
        expect(plan.lanes[i].taskCount).toBe(0);
        expect(plan.lanes[i].label).toBeNull();
      }
    });

    it('throws if plan mode is already active', () => {
      state.startPlan('day');
      expect(() => state.startPlan('week')).toThrow('Plan mode is already active');
    });
  });

  describe('fillLane', () => {
    it('populates a lane with tasks', () => {
      state.startPlan('day');
      const result = state.fillLane(1, [
        { name: 'Task A', mass: 60, position: 1.0 },
        { name: 'Task B', position: 2.0 },
        { name: 'Task C' },
      ]);
      expect(result.lane).toBe(1);
      expect(result.tasks).toHaveLength(3);
      expect(result.tasks[0].name).toBe('Task A');
      expect(result.tasks[0].mass).toBe(60);
      expect(result.tasks[1].name).toBe('Task B');
      expect(result.tasks[1].mass).toBe(30); // default
      expect(result.tasks[2].name).toBe('Task C');
      expect(result.tasks[2].anchor).toBeNull();
    });

    it('clears existing tasks on refill', () => {
      state.startPlan('day');
      state.fillLane(2, [{ name: 'Old task' }]);
      const result = state.fillLane(2, [{ name: 'New task' }]);
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].name).toBe('New task');

      const planState = state.getPlanState();
      const lane2 = planState.lanes.find((l) => l.number === 2);
      expect(lane2!.taskCount).toBe(1);
    });

    it('throws when plan mode is not active', () => {
      expect(() => state.fillLane(1, [{ name: 'X' }])).toThrow('Plan mode is not active');
    });
  });

  describe('nameLane', () => {
    it('sets a label on a lane', () => {
      state.startPlan('day');
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
      // Seed main with a task
      state.putTask({ name: 'Main task', position: 1.0 });

      state.startPlan('day');
      state.fillLane(1, [
        { name: 'Planned A', position: 2.0 },
        { name: 'Planned B', position: 3.0 },
      ]);

      const result = state.commitLane(1);
      expect(result.committed).toBe(1);
      expect(result.taskCount).toBe(2);

      // Plan mode should be ended
      const planState = state.getPlanState();
      expect(planState.active).toBe(false);

      // Main timeline should have the lane's tasks, not the old main task
      const look = state.look();
      expect(look.river).toHaveLength(2);
      const names = look.river.map((t) => t.name).sort();
      expect(names).toEqual(['Planned A', 'Planned B']);
    });
  });

  describe('endPlan', () => {
    it('discards all lanes and exits plan mode', () => {
      state.startPlan('day');
      state.fillLane(1, [{ name: 'Discard me' }]);
      state.fillLane(2, [{ name: 'Discard me too' }]);
      state.nameLane(1, 'Doomed');

      const result = state.endPlan();
      expect(result.ended).toBe(true);

      const planState = state.getPlanState();
      expect(planState.active).toBe(false);
      expect(planState.lanes).toHaveLength(0);
    });

    it('preserves existing main tasks after discard', () => {
      state.putTask({ name: 'Keep me', position: 1.0 });
      state.startPlan('day');
      state.fillLane(1, [{ name: 'Throwaway' }]);
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
      expect(plan.timeframe).toBeNull();
      expect(plan.lanes).toHaveLength(0);
    });

    it('returns correct active state with timeframe and lanes', () => {
      state.startPlan('week');
      state.fillLane(1, [{ name: 'A' }, { name: 'B' }]);
      state.fillLane(3, [{ name: 'C' }]);
      state.nameLane(1, 'Option Alpha');

      const plan = state.getPlanState();
      expect(plan.active).toBe(true);
      expect(plan.timeframe).toBe('week');
      expect(plan.lanes).toHaveLength(5);

      const lane1 = plan.lanes.find((l) => l.number === 1)!;
      expect(lane1.taskCount).toBe(2);
      expect(lane1.label).toBe('Option Alpha');

      const lane3 = plan.lanes.find((l) => l.number === 3)!;
      expect(lane3.taskCount).toBe(1);

      const lane2 = plan.lanes.find((l) => l.number === 2)!;
      expect(lane2.taskCount).toBe(0);
      expect(lane2.label).toBeNull();
    });
  });

  describe('putTaskInLane', () => {
    it('creates a task directly in a lane with position', () => {
      state.startPlan('day');
      state.putTaskInLane(1, 'Direct task', 2.5);

      const tasks = state.getLaneTasks(1);
      expect(tasks.river).toHaveLength(1);
      expect(tasks.river[0].name).toBe('Direct task');
      expect(tasks.river[0].position).not.toBeNull();
    });

    it('creates a cloud task in a lane with null position', () => {
      state.startPlan('day');
      state.putTaskInLane(2, 'Cloud task', null);

      const tasks = state.getLaneTasks(2);
      expect(tasks.cloud).toHaveLength(1);
      expect(tasks.cloud[0].name).toBe('Cloud task');
    });
  });

  describe('addToLane', () => {
    it('copies a main task into a lane (copy mode)', () => {
      const task = state.putTask({ name: 'Main task', position: 1.0 });
      state.startPlan('day');

      state.addToLane(1, task.id, 2.0, true);

      // Task should exist in lane
      const laneTasks = state.getLaneTasks(1);
      expect(laneTasks.river).toHaveLength(1);
      expect(laneTasks.river[0].name).toBe('Main task');

      // Original should still exist in main
      const mainTask = state.getTask(task.id);
      expect(mainTask).not.toBeNull();
    });

    it('moves a main task into a lane (non-copy mode)', () => {
      const task = state.putTask({ name: 'Main task', position: 1.0 });
      state.startPlan('day');

      state.addToLane(1, task.id, 2.0, false);

      // Task should exist in lane
      const laneTasks = state.getLaneTasks(1);
      expect(laneTasks.river).toHaveLength(1);

      // Original should be removed from main
      const mainTask = state.getTask(task.id);
      expect(mainTask).toBeNull();
    });
  });

  describe('removeFromLane', () => {
    it('deletes a task from a lane', () => {
      state.startPlan('day');
      const filled = state.fillLane(1, [
        { name: 'Keep' },
        { name: 'Remove' },
      ]);
      const removeId = filled.tasks[1].id;

      state.removeFromLane(1, removeId);

      const tasks = state.getLaneTasks(1);
      const allNames = [...tasks.river, ...tasks.cloud].map((t) => t.name);
      expect(allNames).toEqual(['Keep']);
    });
  });

  describe('laneToCloud', () => {
    it('moves a lane task to the main cloud', () => {
      state.startPlan('day');
      const filled = state.fillLane(1, [{ name: 'To cloud', position: 1.0 }]);
      const taskId = filled.tasks[0].id;

      state.laneToCloud(1, taskId);

      // Task should be gone from lane
      const laneTasks = state.getLaneTasks(1);
      expect(laneTasks.river).toHaveLength(0);
      expect(laneTasks.cloud).toHaveLength(0);

      // Task should be in main cloud (no anchor)
      const look = state.look();
      expect(look.cloud).toHaveLength(1);
      expect(look.cloud[0].name).toBe('To cloud');
    });

    it('throws if task not found in lane', () => {
      state.startPlan('day');
      expect(() => state.laneToCloud(1, 'nonexistent')).toThrow('not found');
    });
  });

  describe('updateTaskInLane', () => {
    it('updates task fields in a lane', () => {
      state.startPlan('day');
      const filled = state.fillLane(1, [{ name: 'Updatable', position: 1.0 }]);
      const taskId = filled.tasks[0].id;

      state.updateTaskInLane(1, taskId, {
        mass: 90,
        solidity: 0.8,
        energy: 0.9,
      });

      const tasks = state.getLaneTasks(1);
      const updated = tasks.river[0];
      expect(updated.mass).toBe(90);
      expect(updated.solidity).toBeCloseTo(0.8);
      expect(updated.energy).toBeCloseTo(0.9);
    });

    it('updates position in a lane', () => {
      state.startPlan('day');
      const filled = state.fillLane(1, [{ name: 'Repositioned', position: 1.0 }]);
      const taskId = filled.tasks[0].id;

      state.updateTaskInLane(1, taskId, { position: 5.0 });

      const tasks = state.getLaneTasks(1);
      const updated = tasks.river[0];
      // Position should be approximately 5 hours from now
      expect(updated.position).not.toBeNull();
      expect(updated.position!).toBeGreaterThan(4.0);
      expect(updated.position!).toBeLessThan(6.0);
    });
  });

  describe('moveBetweenLanes', () => {
    it('moves a task from one lane to another', () => {
      state.startPlan('day');
      const filled = state.fillLane(1, [{ name: 'Traveler', position: 1.0 }]);
      const taskId = filled.tasks[0].id;

      state.moveBetweenLanes(1, 3, taskId, 2.0);

      // Source lane should be empty
      const lane1 = state.getLaneTasks(1);
      expect(lane1.river).toHaveLength(0);
      expect(lane1.cloud).toHaveLength(0);

      // Target lane should have the task
      const lane3 = state.getLaneTasks(3);
      expect(lane3.river).toHaveLength(1);
      expect(lane3.river[0].name).toBe('Traveler');
    });

    it('throws if task not found in source lane', () => {
      state.startPlan('day');
      expect(() => state.moveBetweenLanes(1, 2, 'nonexistent', 1.0)).toThrow('not found');
    });
  });

  describe('repositionInLane', () => {
    it('changes task position within a lane', () => {
      state.startPlan('day');
      const filled = state.fillLane(1, [{ name: 'Slider', position: 1.0 }]);
      const taskId = filled.tasks[0].id;

      state.repositionInLane(1, taskId, 8.0);

      const tasks = state.getLaneTasks(1);
      const task = tasks.river[0];
      expect(task.position).not.toBeNull();
      expect(task.position!).toBeGreaterThan(7.0);
      expect(task.position!).toBeLessThan(9.0);
    });
  });

  describe('lane validation', () => {
    it('rejects lane 0', () => {
      state.startPlan('day');
      expect(() => state.fillLane(0, [{ name: 'X' }])).toThrow('Lane must be an integer from 1 to 5');
    });

    it('rejects lane 6', () => {
      state.startPlan('day');
      expect(() => state.fillLane(6, [{ name: 'X' }])).toThrow('Lane must be an integer from 1 to 5');
    });

    it('rejects non-integer lane', () => {
      state.startPlan('day');
      expect(() => state.fillLane(2.5, [{ name: 'X' }])).toThrow('Lane must be an integer from 1 to 5');
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RiverState } from '../src/state.js';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

describe('RiverState', () => {
  let state: RiverState;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'river-test-'));
    state = new RiverState(tmpDir);
  });

  afterEach(() => {
    state.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('initialization', () => {
    it('creates database with tables', () => {
      const tables = state.getTableNames();
      expect(tables).toContain('tasks');
      expect(tables).toContain('timelines');
      expect(tables).toContain('meta');
    });

    it('creates a default "main" timeline', () => {
      const timeline = state.getCurrentTimeline();
      expect(timeline.name).toBe('main');
    });
  });

  describe('putTask', () => {
    it('creates a task with defaults', () => {
      const task = state.putTask({ name: 'Test task' });
      expect(task.id).toBeDefined();
      expect(task.name).toBe('Test task');
      expect(task.mass).toBe(30);
      expect(task.solidity).toBeCloseTo(0.1);
      expect(task.anchor).toBeNull();
      expect(task.fixed).toBe(false);
      expect(task.alive).toBe(false);
      expect(task.tags).toEqual([]);
    });

    it('creates a task with custom properties', () => {
      const task = state.putTask({
        name: 'Big task',
        mass: 120,
        solidity: 0.7,
        tags: ['work'],
      });
      expect(task.mass).toBe(120);
      expect(task.solidity).toBeCloseTo(0.7);
      expect(task.tags).toEqual(['work']);
    });

    it('updates an existing task', () => {
      const created = state.putTask({ name: 'Original' });
      const updated = state.putTask({ id: created.id, name: 'Updated', solidity: 0.5 });
      expect(updated.id).toBe(created.id);
      expect(updated.name).toBe('Updated');
      expect(updated.solidity).toBeCloseTo(0.5);
      expect(updated.mass).toBe(30); // unchanged
    });

    it('converts position to anchor', () => {
      const before = Date.now();
      const task = state.putTask({ name: 'Positioned', position: 2.0 });
      const after = Date.now();
      expect(task.anchor).not.toBeNull();
      const anchorMs = new Date(task.anchor!).getTime();
      expect(anchorMs).toBeGreaterThanOrEqual(before + 2 * 3_600_000 - 100);
      expect(anchorMs).toBeLessThanOrEqual(after + 2 * 3_600_000 + 100);
    });

    it('enforces single alive task', () => {
      const t1 = state.putTask({ name: 'First', alive: true });
      expect(t1.alive).toBe(true);
      const t2 = state.putTask({ name: 'Second', alive: true });
      expect(t2.alive).toBe(true);
      const t1After = state.getTask(t1.id);
      expect(t1After!.alive).toBe(false);
    });
  });

  describe('moveTask', () => {
    it('sets absolute position', () => {
      const task = state.putTask({ name: 'Movable' });
      const moved = state.moveTask(task.id, 3.5);
      expect(moved.anchor).not.toBeNull();
    });

    it('sends task to cloud with null', () => {
      const task = state.putTask({ name: 'Movable', position: 2.0 });
      const moved = state.moveTask(task.id, null);
      expect(moved.anchor).toBeNull();
    });

    it('batch shifts tasks', () => {
      const t1 = state.putTask({ name: 'A', position: 1.0 });
      const t2 = state.putTask({ name: 'B', position: 2.0 });
      const shifted = state.moveTasks([t1.id, t2.id], 1.5);
      expect(shifted).toHaveLength(2);
      for (const t of shifted) {
        expect(t.anchor).not.toBeNull();
      }
    });
  });

  describe('look', () => {
    it('returns river and cloud tasks', () => {
      state.putTask({ name: 'In river', position: 2.0 });
      state.putTask({ name: 'In cloud' });
      const result = state.look();
      expect(result.river).toHaveLength(1);
      expect(result.cloud).toHaveLength(1);
      expect(result.river[0].name).toBe('In river');
      expect(result.cloud[0].name).toBe('In cloud');
    });

    it('calculates breathing room', () => {
      const result = state.look();
      expect(result.breathing_room.next_4h).toBe(240);
      expect(result.breathing_room.rest_of_day).toBeGreaterThan(0);
    });

    it('respects horizon filter', () => {
      state.putTask({ name: 'Near', position: 1.0 });
      state.putTask({ name: 'Far', position: 10.0 });
      const result = state.look({ horizon: 2 });
      expect(result.river).toHaveLength(1);
      expect(result.river[0].name).toBe('Near');
    });
  });
});

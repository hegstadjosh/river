// viewer/river-store.js — Unified task store
// One array. One findTask. One save path.
// Tasks carry a ctx field: { type: 'main' } or { type: 'lane', lane: N }
(function () {
  'use strict';

  var R = window.River;

  // ── The Store ──────────────────────────────────────────────────────
  R.tasks = [];

  // ── Selectors ──────────────────────────────────────────────────────

  R.findTask = function (id) {
    for (var i = 0; i < R.tasks.length; i++)
      if (R.tasks[i].id === id) return R.tasks[i];
    return null;
  };

  R.mainTasks = function () {
    return R.tasks.filter(function (t) { return t.ctx && t.ctx.type === 'main'; });
  };

  R.riverTasks = function () {
    return R.tasks.filter(function (t) {
      return t.ctx && t.ctx.type === 'main' && t.position !== null && t.position !== undefined;
    });
  };

  R.cloudTasks = function () {
    return R.tasks.filter(function (t) {
      return t.ctx && t.ctx.type === 'main' && (t.position === null || t.position === undefined);
    });
  };

  R.tasksInLane = function (lane) {
    return R.tasks.filter(function (t) { return t.ctx && t.ctx.type === 'lane' && t.ctx.lane === lane; });
  };

  R.laneTasks = function () {
    return R.tasks.filter(function (t) { return t.ctx && t.ctx.type === 'lane'; });
  };

  // ── Save Path ──────────────────────────────────────────────────────
  // Resolves the right HTTP action based on task context.

  R.save = function (taskId, changes) {
    var t = R.findTask(taskId);
    if (!t || !t.ctx) return;

    if (t.ctx.type === 'lane') {
      var payload = { lane: t.ctx.lane, task_id: taskId };
      for (var k in changes) payload[k] = changes[k];
      R.post('plan_update_task', payload);
    } else {
      var payload = { id: taskId };
      for (var k in changes) payload[k] = changes[k];
      R.post('put', payload);
    }
  };

  R.savePosition = function (taskId, position) {
    var t = R.findTask(taskId);
    if (!t || !t.ctx) return;

    if (t.ctx.type === 'lane') {
      R.post('plan_reposition', { lane: t.ctx.lane, task_id: taskId, position: position });
    } else {
      R.post('move', { id: taskId, position: position });
    }
  };

  R.deleteTask = function (taskId) {
    var t = R.findTask(taskId);
    if (!t || !t.ctx) return;

    if (t.ctx.type === 'lane') {
      R.post('plan_remove', { lane: t.ctx.lane, task_id: taskId });
    } else {
      R.post('delete', { id: taskId });
    }
  };

  // ── Cross-context operations ────────────────────────────────────────

  R.moveToCloud = function (taskId, fromLane) {
    R.post('plan_to_cloud', { lane: fromLane, task_id: taskId });
  };

  R.moveToLane = function (taskId, fromLane, toLane, position) {
    R.post('plan_move', { from_lane: fromLane, to_lane: toLane, task_id: taskId, position: position });
  };

  R.copyToLane = function (taskId, toLane, position) {
    R.post('plan_add', { lane: toLane, task_id: taskId, position: position, copy: true });
  };

  R.visibleTasks = function () {
    if (R.planMode) {
      // In plan mode: cloud tasks + all lane tasks
      return R.tasks.filter(function (t) {
        return t.ctx && (t.ctx.type === 'lane' || (t.ctx.type === 'main' && (t.position === null || t.position === undefined)));
      });
    }
    return R.mainTasks();
  };

  // ── Sync: merge server state into the store ────────────────────────
  // Preserves animation state (x, y, vx, vy) for existing tasks.

  R.sync = function () {
    if (!R.state) return;

    // ── Detect plan mode ──
    var wasPlanMode = R.planMode;
    R.planMode = !!(R.state.plan && R.state.plan.active !== false);
    R.planTimeframe = R.planMode ? (R.state.plan.timeframe || null) : null;

    // Build lane data for plan rendering
    if (R.planMode) {
      R.planLanes = [];
      var lanes = R.state.plan.lanes || [];
      for (var li = 0; li < 5; li++) {
        R.planLanes.push(lanes[li] || { label: '', tasks: [] });
      }
      if (!wasPlanMode && R.initPlanStreaks) R.initPlanStreaks();
    } else {
      R.planLanes = [];
      R.planHoverLane = -1;
    }
    if (R.updatePlanIndicator) R.updatePlanIndicator();

    // ── Build unified task list from server state ──
    var incoming = [];

    // Main tasks (river + cloud)
    var mainAll = (R.state.river || []).concat(R.state.cloud || []);
    for (var i = 0; i < mainAll.length; i++) {
      var t = mainAll[i];
      t.ctx = { type: 'main' };
      incoming.push(t);
    }

    // Plan lane tasks
    if (R.planMode && R.state.plan && R.state.plan.lanes) {
      var planLanes = R.state.plan.lanes;
      for (var li = 0; li < planLanes.length; li++) {
        var laneTasks = planLanes[li].tasks || [];
        for (var ti = 0; ti < laneTasks.length; ti++) {
          var lt = laneTasks[ti];
          lt.ctx = { type: 'lane', lane: li };
          incoming.push(lt);
        }
      }
    }

    // ── Merge into R.tasks, preserving animation state ──
    var incomingMap = {};
    for (var j = 0; j < incoming.length; j++) {
      // Lane tasks need a compound key to avoid ID collisions across lanes
      var key = incoming[j].ctx.type === 'lane'
        ? incoming[j].id + '_L' + incoming[j].ctx.lane
        : incoming[j].id;
      incomingMap[key] = incoming[j];
    }

    // Remove tasks that no longer exist
    R.tasks = R.tasks.filter(function (a) {
      var key = a.ctx && a.ctx.type === 'lane'
        ? a.id + '_L' + a.ctx.lane
        : a.id;
      return incomingMap[key];
    });

    // Build map of existing animated tasks
    var existingMap = {};
    for (var k = 0; k < R.tasks.length; k++) {
      var eKey = R.tasks[k].ctx && R.tasks[k].ctx.type === 'lane'
        ? R.tasks[k].id + '_L' + R.tasks[k].ctx.lane
        : R.tasks[k].id;
      existingMap[eKey] = k;
    }

    // Update existing or add new
    for (var m = 0; m < incoming.length; m++) {
      var src = incoming[m];
      var sKey = src.ctx.type === 'lane'
        ? src.id + '_L' + src.ctx.lane
        : src.id;

      var tgt = computeTarget(src);

      if (existingMap[sKey] !== undefined) {
        // Update existing animated task
        var a = R.tasks[existingMap[sKey]];
        a.name = src.name;
        a.mass = src.mass;
        a.solidity = src.solidity;
        a.energy = src.energy;
        a.fixed = src.fixed;
        a.alive = src.alive;
        a.tags = src.tags;
        a.position = src.position;
        a.anchor = src.anchor;
        a.ctx = src.ctx;
        a.tx = tgt.x;
        a.ty = tgt.y;
      } else {
        // Add new task with initial position at target
        R.tasks.push({
          id: src.id, name: src.name, mass: src.mass, solidity: src.solidity,
          energy: src.energy, fixed: src.fixed, alive: src.alive, tags: src.tags,
          position: src.position, anchor: src.anchor, ctx: src.ctx,
          x: tgt.x, y: tgt.y, tx: tgt.x, ty: tgt.y, vx: 0, vy: 0
        });
      }
    }
  };

  // Compute target position for a task based on its context
  function computeTarget(t) {
    if (t.ctx.type === 'lane') {
      // Plan lane task — centered in lane
      var bounds = R.planLaneBounds ? R.planLaneBounds(t.ctx.lane) : { midY: R.H * 0.6 };
      var x = R.hoursToX(t.position || 0);
      return { x: x, y: bounds.midY || R.H * 0.6 };
    } else {
      // Main task — river or cloud
      return (t.position !== null && t.position !== undefined) ? R.riverPos(t) : R.cloudPos(t);
    }
  }

  // ── SSE Connection ─────────────────────────────────────────────────

  R.connectSSE = function () {
    var es = new EventSource('/events');
    es.onmessage = function (e) {
      try { R.state = JSON.parse(e.data); R.sync(); } catch (_) {}
    };
  };

  fetch('/state').then(function (r) { return r.json(); })
    .then(function (d) { R.state = d; R.sync(); }).catch(function () {});
  R.connectSSE();
})();

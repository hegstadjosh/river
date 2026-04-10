// viewer/river-sse.js — SSE connection, initial fetch, sync function
(function () {
  'use strict';

  var R = window.River;

  // ── Sync State -> Animation Tasks ───────────────────────────────────

  R.sync = function () {
    if (!R.state) return;

    // ── Plan mode detection ──
    var wasPlanMode = R.planMode;
    if (R.state.plan) {
      R.planMode = true;
      R.planTimeframe = R.state.plan.timeframe || null;
      // Build planLanes from state.plan.lanes (array of { label, tasks })
      R.planLanes = [];
      var lanes = R.state.plan.lanes || [];
      for (var li = 0; li < 5; li++) {
        R.planLanes.push(lanes[li] || { label: '', tasks: [] });
      }
      // Initialize plan streaks if just entered plan mode
      if (!wasPlanMode && R.initPlanStreaks) R.initPlanStreaks();
      // Sync plan animated tasks
      if (R.syncPlanTasks) R.syncPlanTasks();
      if (R.updatePlanIndicator) R.updatePlanIndicator();
    } else {
      R.planMode = false;
      R.planLanes = [];
      R.planAnimTasks = [];
      R.planTimeframe = null;
      if (R.updatePlanIndicator) R.updatePlanIndicator();
    }

    // ── Normal task sync (cloud + river) ──
    var all = (R.state.river || []).concat(R.state.cloud || []);
    var map = {};
    for (var i = 0; i < all.length; i++) map[all[i].id] = all[i];

    // Remove gone tasks
    R.animTasks = R.animTasks.filter(function (a) { return map[a.id]; });

    var existing = {};
    for (var j = 0; j < R.animTasks.length; j++) existing[R.animTasks[j].id] = j;

    for (var k = 0; k < all.length; k++) {
      var t = all[k];
      // In plan mode, river tasks are not rendered in the main river
      // (they go into lanes instead) — but cloud tasks are still in the cloud
      var tgt;
      if (R.planMode && t.position !== null && t.position !== undefined) {
        // River tasks still get positions calculated for cloud fallback
        tgt = R.riverPos(t);
      } else {
        tgt = (t.position !== null && t.position !== undefined) ? R.riverPos(t) : R.cloudPos(t);
      }

      if (existing[t.id] !== undefined) {
        var a = R.animTasks[existing[t.id]];
        a.name = t.name; a.mass = t.mass; a.solidity = t.solidity;
        a.fixed = t.fixed; a.alive = t.alive; a.tags = t.tags; a.energy = t.energy;
        a.position = t.position; a.anchor = t.anchor;
        a.tx = tgt.x;
        a.ty = (a.customY !== undefined) ? a.customY : tgt.y;
      } else {
        R.animTasks.push({
          id: t.id, name: t.name, mass: t.mass, solidity: t.solidity,
          fixed: t.fixed, alive: t.alive, tags: t.tags, energy: t.energy,
          position: t.position, anchor: t.anchor,
          x: tgt.x, y: tgt.y, tx: tgt.x, ty: tgt.y, vx: 0, vy: 0
        });
      }
    }
  };

  // ── SSE + Fetch ─────────────────────────────────────────────────────

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

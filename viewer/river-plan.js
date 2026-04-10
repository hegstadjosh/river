// viewer/river-plan.js — Plan mode rendering and interaction
// When R.planMode is truthy, the river zone splits into 5 horizontal swim lanes
(function () {
  'use strict';

  var R = window.River;

  // ── Plan Mode State ────────────────────────────────────────────────
  R.planMode = false;
  R.planLanes = [];       // array of { label, tasks: [] }
  R.planTimeframe = null;  // e.g. '6h', 'day', '3d'
  R.planHoverLane = -1;    // which lane the mouse is over (-1 = none)
  R.planAnimTasks = [];    // animated task objects for plan mode
  R.planStreaks = [];       // per-lane flow streaks (array of arrays)

  R.planCloneGhost = null;

  // ── Layout Helpers ─────────────────────────────────────────────────

  R.planLaneCount = function () { return 5; };

  R.planRiverTop = function () { return R.surfaceY() + 5; };

  R.planRiverHeight = function () { return R.H - R.planRiverTop() - 30; };

  R.planLaneHeight = function () {
    return R.planRiverHeight() / R.planLaneCount();
  };

  // Returns { top, bottom, midY } for a given lane index (0-4)
  R.planLaneBounds = function (i) {
    var top = R.planRiverTop() + i * R.planLaneHeight();
    var h = R.planLaneHeight();
    return { top: top, bottom: top + h, midY: top + h / 2 };
  };

  // Which lane is the mouse in? Returns 0-4 or -1 if not in a lane
  R.planLaneAt = function (my) {
    if (!R.planMode) return -1;
    var rTop = R.planRiverTop();
    var rH = R.planRiverHeight();
    if (my < rTop || my > rTop + rH) return -1;
    var lane = Math.floor((my - rTop) / R.planLaneHeight());
    return Math.min(lane, R.planLaneCount() - 1);
  };


  // ── Per-lane flow streaks ──────────────────────────────────────────

  R.initPlanStreaks = function () {
    R.planStreaks = [];
    for (var lane = 0; lane < R.planLaneCount(); lane++) {
      var streaks = [];
      var bounds = R.planLaneBounds(lane);
      var count = 6; // fewer per lane — subtler
      for (var i = 0; i < count; i++) {
        streaks.push({
          x: Math.random() * R.W * 1.5,
          y: bounds.top + 10 + Math.random() * (bounds.bottom - bounds.top - 20),
          len: 40 + Math.random() * 120,
          speed: 4 + Math.random() * 12, // slower than main river
          alpha: 0.01 + Math.random() * 0.025
        });
      }
      R.planStreaks.push(streaks);
    }
  };

  // ── Sync plan tasks into animated objects ──────────────────────────

  R.syncPlanTasks = function () {
    if (!R.planMode || !R.planLanes) return;

    var allPlanTasks = [];
    for (var lane = 0; lane < R.planLanes.length; lane++) {
      var tasks = R.planLanes[lane].tasks || [];
      for (var ti = 0; ti < tasks.length; ti++) {
        var t = tasks[ti];
        t._lane = lane; // tag with lane index
        allPlanTasks.push(t);
      }
    }

    var map = {};
    for (var i = 0; i < allPlanTasks.length; i++) {
      var key = allPlanTasks[i].id + '_L' + allPlanTasks[i]._lane;
      map[key] = allPlanTasks[i];
    }

    // Remove gone tasks
    R.planAnimTasks = R.planAnimTasks.filter(function (a) {
      return map[a.id + '_L' + a._lane];
    });

    var existing = {};
    for (var j = 0; j < R.planAnimTasks.length; j++) {
      existing[R.planAnimTasks[j].id + '_L' + R.planAnimTasks[j]._lane] = j;
    }

    for (var k = 0; k < allPlanTasks.length; k++) {
      var t = allPlanTasks[k];
      var key = t.id + '_L' + t._lane;
      var bounds = R.planLaneBounds(t._lane);
      var tgt = R.planTaskTarget(t, bounds);

      if (existing[key] !== undefined) {
        var a = R.planAnimTasks[existing[key]];
        a.name = t.name; a.mass = t.mass; a.solidity = t.solidity;
        a.fixed = t.fixed; a.alive = t.alive; a.tags = t.tags; a.energy = t.energy;
        a.position = t.position; a.anchor = t.anchor; a._lane = t._lane;
        a.tx = tgt.x;
        a.ty = (a.customY !== undefined) ? a.customY : tgt.y;
      } else {
        R.planAnimTasks.push({
          id: t.id, name: t.name, mass: t.mass, solidity: t.solidity,
          fixed: t.fixed, alive: t.alive, tags: t.tags, energy: t.energy,
          position: t.position, anchor: t.anchor, _lane: t._lane,
          x: tgt.x, y: tgt.y, tx: tgt.x, ty: tgt.y, vx: 0, vy: 0
        });
      }
    }
  };

  R.planTaskTarget = function (t, bounds) {
    var x = R.hoursToX(t.position || 0);
    var spread = (bounds.bottom - bounds.top) * 0.15;
    var y = bounds.midY + (R.hashFrac(t.id, 'ry') - 0.5) * 2 * spread;
    return { x: x, y: y };
  };

  // ── Hit test for plan mode tasks ───────────────────────────────────

  R.planHitTest = function (mx, my) {
    for (var i = R.planAnimTasks.length - 1; i >= 0; i--) {
      var a = R.planAnimTasks[i];
      var d = R.taskStretch(a);
      var hitHW = Math.max(R.MIN_HIT, d.hw + 5);
      var hitHH = Math.max(R.MIN_HIT, d.hh + 5);
      if (Math.abs(mx - a.x) <= hitHW && Math.abs(my - a.y) <= hitHH) return a;
    }
    return null;
  };

  // ── Find plan anim task ────────────────────────────────────────────

  R.findPlanTask = function (id, lane) {
    for (var i = 0; i < R.planAnimTasks.length; i++) {
      if (R.planAnimTasks[i].id === id && R.planAnimTasks[i]._lane === lane) return R.planAnimTasks[i];
    }
    return null;
  };

  // ── Drawing: Plan Mode ─────────────────────────────────────────────

  R.drawPlanMode = function (t, dt) {
    if (!R.planMode) return;
    var ctx = R.ctx;
    var laneH = R.planLaneHeight();

    // ── Draw lane separators (sediment layers) ──
    for (var i = 0; i < R.planLaneCount(); i++) {
      var bounds = R.planLaneBounds(i);

      // Lane background — active lane is brighter
      var isActive = (R.planHoverLane === i);
      var bgAlpha = isActive ? 0.02 : 0.005;
      ctx.fillStyle = 'rgba(200, 165, 110, ' + bgAlpha + ')';
      ctx.fillRect(0, bounds.top, R.W, laneH);

      // Separator line at bottom of lane (except last)
      if (i < R.planLaneCount() - 1) {
        ctx.beginPath();
        ctx.moveTo(40, bounds.bottom);
        ctx.lineTo(R.W - 40, bounds.bottom);
        ctx.strokeStyle = 'rgba(200, 165, 110, ' + (isActive ? 0.12 : 0.06) + ')';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // ── Per-lane flow streaks ──
      if (R.planStreaks[i]) {
        for (var si = 0; si < R.planStreaks[i].length; si++) {
          var s = R.planStreaks[i][si];
          s.x -= s.speed * dt;
          if (s.x + s.len < 0) {
            s.x = R.W + 20 + Math.random() * 200;
            s.y = bounds.top + 10 + Math.random() * (laneH - 20);
            s.len = 40 + Math.random() * 120;
          }
          var fadeL = Math.min(1, (s.x + s.len) / 100);
          var fadeR = Math.min(1, (R.W - s.x) / 100);
          var fade = fadeL * fadeR;

          ctx.beginPath();
          ctx.moveTo(Math.max(0, s.x), s.y);
          ctx.lineTo(Math.min(R.W, s.x + s.len), s.y);
          ctx.strokeStyle = 'rgba(' + R.AMBER[0] + ',' + R.AMBER[1] + ',' + R.AMBER[2] + ',' + (s.alpha * fade).toFixed(4) + ')';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // ── Lane label ──
      var laneData = R.planLanes[i];
      if (laneData && laneData.label) {
        ctx.save();
        ctx.font = '400 11px -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(200, 165, 110, ' + (isActive ? 0.45 : 0.25) + ')';
        ctx.fillText(laneData.label, 16, bounds.midY);
        ctx.restore();
      }

      // ── Lane number (faint) ──
      ctx.save();
      ctx.font = '500 10px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(200, 165, 110, 0.15)';
      ctx.fillText((i + 1), 16, bounds.top + 6);
      ctx.restore();
    }

    // ── Draw plan tasks (sorted same as normal) ──
    var sorted = R.planAnimTasks.slice().sort(function (a, b) {
      if (a.alive !== b.alive) return a.alive ? 1 : -1;
      if (a.fixed !== b.fixed) return a.fixed ? -1 : 1;
      return 0;
    });

    for (var j = 0; j < sorted.length; j++) {
      var task = sorted[j];
      // Dim tasks not in the active lane
      var originalDim = null;
      if (R.planHoverLane >= 0 && task._lane !== R.planHoverLane) {
        // We temporarily reduce alpha by adjusting solidity visual
        // Actually, drawBlob uses the animTasks array for alive check,
        // so we just draw with a dimming ctx
        ctx.save();
        ctx.globalAlpha = 0.7;
        R.drawBlob(task, t);
        ctx.restore();
      } else {
        R.drawBlob(task, t);
      }
    }

    // ── Commit buttons ──
    R.drawPlanCommitButtons(t);
  };

  // ── Commit Buttons ─────────────────────────────────────────────────
  // Small "Use this" button at right edge of each non-empty lane

  R.planCommitBtns = []; // cached button rects for hit testing

  R.drawPlanCommitButtons = function (t) {
    var ctx = R.ctx;
    R.planCommitBtns = [];

    for (var i = 0; i < R.planLaneCount(); i++) {
      var laneData = R.planLanes[i];
      if (!laneData || !laneData.tasks || laneData.tasks.length === 0) continue;

      var bounds = R.planLaneBounds(i);
      var btnW = 68, btnH = 24;
      var btnX = R.W - btnW - 20;
      var btnY = bounds.top + 8;

      R.planCommitBtns.push({ lane: i, x: btnX, y: btnY, w: btnW, h: btnH });

      // Button background
      var isHover = R.mouseX >= btnX && R.mouseX <= btnX + btnW &&
                    R.mouseY >= btnY && R.mouseY <= btnY + btnH;

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(btnX, btnY, btnW, btnH, 6);
      ctx.fillStyle = isHover
        ? 'rgba(200, 165, 110, 0.18)'
        : 'rgba(200, 165, 110, 0.08)';
      ctx.fill();
      ctx.strokeStyle = isHover
        ? 'rgba(200, 165, 110, 0.35)'
        : 'rgba(200, 165, 110, 0.15)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Button text
      ctx.font = '500 10px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isHover
        ? 'rgba(200, 165, 110, 0.85)'
        : 'rgba(200, 165, 110, 0.45)';
      ctx.fillText('Use this', btnX + btnW / 2, btnY + btnH / 2);
      ctx.restore();
    }
  };

  // Check if a click hit a commit button
  R.planCommitHitTest = function (mx, my) {
    for (var i = 0; i < R.planCommitBtns.length; i++) {
      var b = R.planCommitBtns[i];
      if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
        return b.lane;
      }
    }
    return -1;
  };

  // ── Spring physics for plan tasks (called from frame loop) ─────────

  R.planPhysicsStep = function () {
    for (var i = 0; i < R.planAnimTasks.length; i++) {
      var a = R.planAnimTasks[i];
      // Skip if being dragged
      if (R.dragging && R.dragging.id === a.id && R.dragging.planLane === a._lane && R.dragging.moved) continue;
      a.vx += (a.tx - a.x) * R.SPRING_K;
      a.vy += (a.ty - a.y) * R.SPRING_K;
      a.vx *= R.DAMPING;
      a.vy *= R.DAMPING;
      a.x += a.vx;
      a.y += a.vy;
    }
  };

  // ── Plan indicator DOM toggle ──────────────────────────────────────

  var planBtn = document.getElementById('plan-btn');
  R._lastPlanIndicatorState = false;

  R.updatePlanIndicator = function () {
    if (R.planMode !== R._lastPlanIndicatorState) {
      R._lastPlanIndicatorState = R.planMode;
      if (planBtn) {
        if (R.planMode) {
          planBtn.textContent = 'exit plan';
          planBtn.classList.add('active');
        } else {
          planBtn.textContent = 'plan';
          planBtn.classList.remove('active');
        }
      }
    }
  };

})();

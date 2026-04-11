// viewer/river-plan.js — Plan mode rendering and interaction
// When R.planMode is truthy, the river zone splits into 5 horizontal swim lanes
(function () {
  'use strict';

  var R = window.River;

  // ── Plan Mode State ────────────────────────────────────────────────
  // R.planMode, R.planLanes, R.planWindowStart, R.planWindowEnd — set by R.sync() in river-store.js
  R.planHoverLane = -1;    // which lane the mouse is over (-1 = none)
  R.planStreaks = [];       // per-lane flow streaks (array of arrays)

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
      var label = (laneData && laneData.label) ? laneData.label : (i === 0 ? 'current' : '');
      if (label) {
        ctx.save();
        ctx.font = '400 11px -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(200, 165, 110, ' + (isActive ? 0.45 : 0.25) + ')';
        ctx.fillText(label, 16, bounds.midY);
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
    var allLaneTasks = R.laneTasks();
    var sorted = allLaneTasks.slice().sort(function (a, b) {
      if (a.alive !== b.alive) return a.alive ? 1 : -1;
      if (a.fixed !== b.fixed) return a.fixed ? -1 : 1;
      return 0;
    });

    for (var j = 0; j < sorted.length; j++) {
      var task = sorted[j];
      var isReadonly = task.ctx && task.ctx.lane === 0;
      var dimForHover = R.planHoverLane >= 0 && task.ctx && task.ctx.lane !== R.planHoverLane;
      if (isReadonly || dimForHover) {
        ctx.save();
        ctx.globalAlpha = isReadonly ? 0.5 : 0.7;
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
      if (laneData.readonly) continue;

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

  // ── Plan Window Outline ────────────────────────────────────────────

  R.drawPlanWindowOutline = function (t) {
    if (!R.planWindowStart || !R.planWindowEnd || !R.state) return;
    var ctx = R.ctx;
    var now = new Date(R.state.now);
    var startHours = (new Date(R.planWindowStart).getTime() - now.getTime()) / 3600000;
    var endHours = (new Date(R.planWindowEnd).getTime() - now.getTime()) / 3600000;
    var leftX = R.hoursToX(startHours);
    var rightX = R.hoursToX(endHours);
    var top = R.surfaceY();
    var bottom = R.H;

    ctx.save();
    // Filled tint inside the window (keep warm)
    ctx.fillStyle = 'rgba(200, 165, 110, 0.02)';
    ctx.fillRect(leftX, top, rightX - leftX, bottom - top);
    // Red vertical boundary lines
    ctx.strokeStyle = 'rgba(180, 70, 50, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(leftX, top); ctx.lineTo(leftX, bottom);
    ctx.moveTo(rightX, top); ctx.lineTo(rightX, bottom);
    ctx.stroke();
    // Red dashed lines extend into cloud zone
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.moveTo(leftX, 0); ctx.lineTo(leftX, top);
    ctx.moveTo(rightX, 0); ctx.lineTo(rightX, top);
    ctx.strokeStyle = 'rgba(180, 70, 50, 0.2)';
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
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

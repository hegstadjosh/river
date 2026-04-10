// viewer/river-main.js — canvas setup, horizon bar, frame loop, requestAnimationFrame
(function () {
  'use strict';

  var R = window.River;

  // ── Canvas Setup ────────────────────────────────────────────────────

  R.resize = function () {
    R.dpr = window.devicePixelRatio || 1;
    R.W = window.innerWidth;
    R.H = window.innerHeight;
    R.canvas.width = R.W * R.dpr;
    R.canvas.height = R.H * R.dpr;
    R.canvas.style.width = R.W + 'px';
    R.canvas.style.height = R.H + 'px';
    R.ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    R.initStreaks();
  };

  window.addEventListener('resize', function () { R.resize(); R.recalcScale(); R.sync(); });
  R.resize();
  R.recalcScale();

  // ── Horizon Bar ──────────────────────────────────────────────────────

  var hzBtns = document.querySelectorAll('.hz-btn');
  var hzLabel = document.getElementById('hz-label');
  var hzPrev = document.getElementById('hz-prev');
  var hzNext = document.getElementById('hz-next');

  R.setHorizon = function (hours) {
    hzBtns.forEach(function (b) { b.classList.remove('active'); });
    hzBtns.forEach(function (b) { if (Number(b.dataset.hours) === hours) b.classList.add('active'); });
    R.horizonHours = hours;
    R.recalcScale();
    R.sync();
    R.updateFrameLabel();
  };

  R.updateFrameLabel = function () {
    if (!R.state) { hzLabel.textContent = R.FRAME_LABELS[R.horizonHours] || ''; return; }
    var now = new Date(R.state.now);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    // For short horizons (6h, day) — show relative offset in hours
    if (R.horizonHours <= 24) {
      if (Math.abs(R.scrollHours) < 1) {
        hzLabel.textContent = R.horizonHours <= 6 ? 'now' : 'today';
      } else {
        var sign = R.scrollHours > 0 ? '+' : '';
        var h = Math.round(R.scrollHours);
        hzLabel.textContent = sign + h + 'h';
      }
      return;
    }

    // For longer horizons — show the center date contextually
    var center = new Date(now.getTime() + (R.scrollHours + R.horizonHours / 2) * 3600000);

    if (Math.abs(R.scrollHours) < R.horizonHours * 0.1) {
      if (R.horizonHours <= 96) hzLabel.textContent = 'next 4 days';
      else if (R.horizonHours <= 168) hzLabel.textContent = 'this week';
      else if (R.horizonHours <= 720) hzLabel.textContent = months[now.getMonth()];
      else if (R.horizonHours <= 2160) hzLabel.textContent = 'Q' + (Math.floor(now.getMonth()/3)+1) + ' \u2019' + (now.getFullYear()%100);
      else hzLabel.textContent = '' + now.getFullYear();
    } else {
      if (R.horizonHours <= 168) {
        var start = new Date(now.getTime() + R.scrollHours * 3600000);
        hzLabel.textContent = months[start.getMonth()] + ' ' + start.getDate() + '\u2009\u2013\u2009' + new Date(start.getTime() + R.horizonHours*3600000).getDate();
      } else if (R.horizonHours <= 720) {
        hzLabel.textContent = months[center.getMonth()] + ' \u2019' + (center.getFullYear()%100);
      } else if (R.horizonHours <= 2160) {
        hzLabel.textContent = 'Q' + (Math.floor(center.getMonth()/3)+1) + ' \u2019' + (center.getFullYear()%100);
      } else {
        hzLabel.textContent = '' + center.getFullYear();
      }
    }
  };

  R.getCalendarHorizon = function (nominal) {
    return nominal; // all frames are fixed durations
  };

  hzBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      R.scrollHours = 0; R.scrollVel = 0;
      var nominal = Number(btn.dataset.hours);
      R.setHorizon(R.getCalendarHorizon(nominal));
      // Store nominal so we know which button is active
      btn._nominal = nominal;
    });
  });

  R.frameStep = function () {
    if (R.horizonHours <= 6) return 6;
    if (R.horizonHours <= 24) return 24;      // 1 day
    if (R.horizonHours <= 96) return 24;      // 4d: iterate 1 day
    if (R.horizonHours <= 168) return 168;    // 1 week
    if (R.horizonHours <= 720) return 720;    // 1 month
    if (R.horizonHours <= 2160) return 2160;  // 1 quarter
    return 8760;
  };

  hzPrev.addEventListener('click', function () {
    R.scrollHours -= R.frameStep();
    R.scrollVel = 0;
    R.sync(); R.updateFrameLabel();
  });

  hzNext.addEventListener('click', function () {
    R.scrollHours += R.frameStep();
    R.scrollVel = 0;
    R.sync(); R.updateFrameLabel();
  });

  // ── Scroll / Trackpad ──────────────────────────────────────────────
  // Horizontal scroll (wheel or trackpad) pans the river smoothly.

  R.canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    // deltaX for horizontal trackpad, deltaY for mouse wheel
    var delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    // Convert pixels to hours
    var hoursPerPx = 1 / R.PIXELS_PER_HOUR;
    R.scrollHours += delta * hoursPerPx * 1.2;
    R.scrollVel = 0; // kill momentum on direct input
    R.sync();
    R.updateFrameLabel();
  }, { passive: false });

  // ── The Loop ────────────────────────────────────────────────────────
  // Everything moves like it's underwater.

  function frame(t) {
    requestAnimationFrame(frame);

    var dt = R.lastTime ? (t - R.lastTime) / 1000 : 1/60;
    dt = Math.min(dt, 0.1);
    R.lastTime = t;

    // Spring physics — fluid, damped, organic (cloud + river tasks)
    for (var i = 0; i < R.animTasks.length; i++) {
      var a = R.animTasks[i];
      if (R.dragging && R.dragging.id === a.id && R.dragging.moved) continue;
      a.vx += (a.tx - a.x) * R.SPRING_K;
      a.vy += (a.ty - a.y) * R.SPRING_K;
      a.vx *= R.DAMPING;
      a.vy *= R.DAMPING;
      a.x += a.vx;
      a.y += a.vy;
    }

    // Plan mode physics
    if (R.planMode && R.planPhysicsStep) R.planPhysicsStep();

    // Draw the world
    R.drawWorld(t);

    if (R.planMode) {
      // Plan mode: subtler main streaks, plan handles its own per-lane streaks
      R.drawStreaks(dt);
      R.drawNowLine(t);
      R.drawTimeMarkers();

      // Draw plan mode lanes, lane tasks, commit buttons
      R.drawPlanMode(t, dt);

      // Cloud tasks still render normally (the palette)
      var cloudSorted = R.animTasks.filter(function (a) {
        return a.position === null || a.position === undefined;
      }).sort(function (a, b) {
        if (a.alive !== b.alive) return a.alive ? 1 : -1;
        return 0;
      });

      for (var ci = 0; ci < cloudSorted.length; ci++) {
        R.drawBlob(cloudSorted[ci], t);
      }
    } else {
      // Normal mode — unchanged
      R.drawStreaks(dt);
      R.drawNowLine(t);
      R.drawTimeMarkers();

      var sorted = R.animTasks.slice().sort(function (a, b) {
        if (a.alive !== b.alive) return a.alive ? 1 : -1;
        if (a.fixed !== b.fixed) return a.fixed ? -1 : 1;
        return 0;
      });

      for (var j = 0; j < sorted.length; j++) {
        var task = sorted[j];
        if (task.position !== null && task.position !== undefined) {
          var screenX = R.hoursToX(task.position);
          var cullHW = R.taskStretch(task).hw + 50;
          if (screenX + cullHW < 0 || screenX - cullHW > R.W) continue;
        }
        R.drawBlob(task, t);
      }
    }

    // ── Wizard glowing field ──
    if (R.drawWizardField) R.drawWizardField(t);
    // ── Dwell timeframe indicator ──
    if (R.drawDwellIndicator) R.drawDwellIndicator();

    R.drawPastFade();

    // ── Keep panel attached to selected task ──
    if (R.selectedId && !document.getElementById('panel').classList.contains('hidden')) {
      var selTask = R.findTask(R.selectedId);
      if (!selTask && R.planMode) {
        // Check plan tasks too
        for (var pi = 0; pi < R.planAnimTasks.length; pi++) {
          if (R.planAnimTasks[pi].id === R.selectedId) { selTask = R.planAnimTasks[pi]; break; }
        }
      }
      if (selTask) R.positionPanel(selTask);
    }

    // ── Resize / hover / drag overlays ──
    R.drawResizeOverlay(t);
  }

  requestAnimationFrame(frame);
})();

// viewer/river-drag-wizard.js — Glowing field drag-through wizard
//
// When dragging from cloud toward river, the surface boundary becomes
// a luminous field divided into 4 colored zones. You sweep through it
// — whatever zone your cursor passes through transforms the task
// IMMEDIATELY. Three stages: duration → commitment → energy.
//
// Also: drag-to-horizon dwell switcher for river tasks.

(function () {
  'use strict';
  var R = window.River;

  // ── Wizard State ──────────────────────────────────────────────────

  var wiz = {
    active: false,
    stage: -1,         // -1=inactive, 0=duration, 1=commitment, 2=energy
    taskId: null,
    zones: [],         // [{x, w, value, label, r, g, b}] — computed per stage
    selectedIdx: -1,   // which zone the cursor is currently in
    fieldTop: 0,       // pixel Y where the field starts
    fieldBot: 0,       // pixel Y where the field ends
    fieldH: 0,
    stageStartT: 0,    // for fade-in
    lastInField: false  // tracks if cursor was in the field
  };

  R.wizardState = wiz;

  // Field: thin, crisp, game-like
  var FIELD_H = 36;

  // ── Preset Definitions ────────────────────────────────────────────

  function durationPresets() {
    var p = R.getPresets();
    return p.map(function (pr) {
      return { value: pr.m, label: pr.l, r: 200, g: 165, b: 110 }; // gold
    });
  }

  function commitmentPresets() {
    return [
      { value: 0.15, label: 'wisp',   r: 200, g: 165, b: 110 },  // barely there
      { value: 0.40, label: 'maybe',  r: 210, g: 170, b: 105 },
      { value: 0.70, label: 'likely', r: 220, g: 175, b: 95 },
      { value: 0.95, label: 'locked', r: 235, g: 190, b: 80 }    // crystalline
    ];
  }

  function energyPresets() {
    // Matches the RGB color stops from river-blobs.js
    return [
      { value: 0.10, label: 'chill',   r: 55,  g: 75,  b: 115 },  // dark blue
      { value: 0.35, label: 'easy',    r: 90,  g: 130, b: 170 },  // light blue
      { value: 0.60, label: 'focus',   r: 200, g: 165, b: 110 },  // gold
      { value: 0.85, label: 'deep',    r: 170, g: 65,  b: 50 }    // red
    ];
  }

  var STAGE_PRESETS = [durationPresets, commitmentPresets, energyPresets];
  var STAGE_LABELS = ['duration', 'commitment', 'energy'];

  // ── Zone Layout ───────────────────────────────────────────────────

  function computeZones(presets) {
    // Divide the full viewport width into N equal zones
    var n = presets.length;
    var pad = R.W * 0.15; // 15% padding on each side
    var usable = R.W - pad * 2;
    var zones = [];
    for (var i = 0; i < n; i++) {
      zones.push({
        x: pad + (usable / n) * i,
        w: usable / n,
        value: presets[i].value,
        label: presets[i].label,
        r: presets[i].r,
        g: presets[i].g,
        b: presets[i].b
      });
    }
    return zones;
  }

  // ── Activation / Deactivation ─────────────────────────────────────

  var horizonBar = document.getElementById('horizon-bar');

  R.wizardActivate = function (taskId) {
    var sY = R.surfaceY();
    wiz.active = true;
    wiz.stage = 0;
    wiz.taskId = taskId;
    wiz.fieldTop = sY - FIELD_H / 2;
    wiz.fieldBot = sY + FIELD_H / 2;
    wiz.fieldH = FIELD_H;
    wiz.selectedIdx = -1;
    wiz.stageStartT = performance.now();
    wiz.lastInField = false;
    wiz.zones = computeZones(STAGE_PRESETS[0]());
    // Hide the DOM horizon bar so the Canvas field is visible
    if (horizonBar) horizonBar.style.opacity = '0';
  };

  R.wizardDeactivate = function () {
    wiz.active = false;
    wiz.stage = -1;
    wiz.taskId = null;
    wiz.zones = [];
    wiz.selectedIdx = -1;
    // Restore the horizon bar
    if (horizonBar) horizonBar.style.opacity = '';
  };

  R.wizardIsActive = function () { return wiz.active && wiz.stage >= 0 && wiz.stage <= 2; };
  R.wizardIsCompleted = function () { return wiz.active && wiz.stage > 2; };

  // ── Mouse Tracking (called from river-input.js) ───────────────────

  R.wizardMouseMove = function (mx, my) {
    if (!wiz.active || wiz.stage > 2) return;

    // Always update which zone the cursor is over (based on X)
    var newIdx = -1;
    for (var i = 0; i < wiz.zones.length; i++) {
      var z = wiz.zones[i];
      if (mx >= z.x && mx < z.x + z.w) { newIdx = i; break; }
    }

    // If cursor is in or near the field vertically, select the zone
    var inField = my >= wiz.fieldTop - 20 && my <= wiz.fieldBot + 20;
    if (inField && newIdx >= 0 && newIdx !== wiz.selectedIdx) {
      wiz.selectedIdx = newIdx;
      applyZoneToTask(wiz.stage, wiz.zones[newIdx].value);
      wiz.lastInField = true;
    }

    // Track when cursor was last in the field
    if (inField) wiz.lastInField = true;

    // Advance stage when cursor exits below the field
    // (they've swept through and continued downward)
    if (my > wiz.fieldBot + 20 && wiz.lastInField) {
      wiz.lastInField = false;
      advanceStage();
    }
  };

  function applyZoneToTask(stage, value) {
    var a = R.findTask(wiz.taskId);
    if (!a) return;

    if (stage === 0) {
      // Duration — also adjust position to keep start time fixed
      var oldMass = a.mass;
      a.mass = value;
      if (a.position != null) {
        var massDiffH = (value - oldMass) / 60;
        // Don't shift position during wizard — task isn't placed yet
      }
    } else if (stage === 1) {
      a.solidity = value;
    } else if (stage === 2) {
      a.energy = value;
    }
  }

  function advanceStage() {
    wiz.stage++;
    wiz.selectedIdx = -1;
    wiz.stageStartT = performance.now();
    wiz.lastInField = false;

    if (wiz.stage <= 2) {
      wiz.zones = computeZones(STAGE_PRESETS[wiz.stage]());
    }
    // stage > 2 = completed, wizardIsCompleted() returns true
  }

  // ── Get Selections for POST ───────────────────────────────────────

  R.wizardGetSelections = function () {
    var a = R.findTask(wiz.taskId);
    if (!a) return { mass: null, solidity: null, energy: null };
    return { mass: a.mass, solidity: a.solidity, energy: a.energy };
  };

  // ── Rendering (called from frame loop) ────────────────────────────
  // Flat, solid zones with hard walls between them. Clean. Game-like.

  R.drawWizardField = function (t) {
    if (!wiz.active || wiz.stage > 2) return;

    var ctx = R.ctx;
    var fadeIn = Math.min(1, (performance.now() - wiz.stageStartT) / 120);

    for (var i = 0; i < wiz.zones.length; i++) {
      var z = wiz.zones[i];
      var isActive = i === wiz.selectedIdx;

      // Flat solid fill — no gradient
      var a = isActive ? 0.55 : 0.2;
      ctx.fillStyle = 'rgba(' + z.r + ',' + z.g + ',' + z.b + ',' + (a * fadeIn) + ')';
      ctx.fillRect(z.x, wiz.fieldTop, z.w, wiz.fieldH);

      // Hard wall on the right edge (except last zone)
      if (i < wiz.zones.length - 1) {
        ctx.beginPath();
        ctx.moveTo(z.x + z.w, wiz.fieldTop);
        ctx.lineTo(z.x + z.w, wiz.fieldBot);
        ctx.strokeStyle = 'rgba(255, 255, 255, ' + (0.15 * fadeIn) + ')';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Active zone: bright top/bottom border
      if (isActive) {
        ctx.fillStyle = 'rgba(' + z.r + ',' + z.g + ',' + z.b + ',' + (0.7 * fadeIn) + ')';
        ctx.fillRect(z.x, wiz.fieldTop, z.w, 2);
        ctx.fillRect(z.x, wiz.fieldBot - 2, z.w, 2);
      }

      // Label — crisp, centered
      ctx.font = (isActive ? '600 ' : '500 ') + '11px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255, 255, 255, ' + (isActive ? 0.95 : 0.5) * fadeIn + ')';
      ctx.fillText(z.label, z.x + z.w / 2, (wiz.fieldTop + wiz.fieldBot) / 2);
    }

    // Top and bottom edges of the whole field
    ctx.fillStyle = 'rgba(200, 165, 110, ' + (0.2 * fadeIn) + ')';
    ctx.fillRect(wiz.zones[0].x, wiz.fieldTop, wiz.zones[wiz.zones.length-1].x + wiz.zones[wiz.zones.length-1].w - wiz.zones[0].x, 1);
    ctx.fillRect(wiz.zones[0].x, wiz.fieldBot - 1, wiz.zones[wiz.zones.length-1].x + wiz.zones[wiz.zones.length-1].w - wiz.zones[0].x, 1);

    // Stage label — small, above field
    ctx.font = '500 9px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(200, 165, 110, ' + (0.45 * fadeIn) + ')';
    ctx.fillText(STAGE_LABELS[wiz.stage], R.W / 2, wiz.fieldTop - 6);

    // Stage dots
    for (var d = 0; d < 3; d++) {
      ctx.beginPath();
      ctx.arc(R.W / 2 - 10 + d * 10, wiz.fieldBot + 8, 2, 0, Math.PI * 2);
      ctx.fillStyle = d <= wiz.stage
        ? 'rgba(200, 165, 110, ' + (0.6 * fadeIn) + ')'
        : 'rgba(200, 165, 110, ' + (0.15 * fadeIn) + ')';
      ctx.fill();
    }
  };

  // ── Horizon Dwell Switcher ────────────────────────────────────────
  // When dragging a RIVER task, hovering over a scale button for 500ms
  // triggers a timeframe switch. Button grows and glows during dwell.

  var dwell = {
    btnEl: null,
    startTime: 0,
    triggered: false
  };

  R.dwellCheckStart = function (mx, my) {
    if (wiz.active) return;

    var hzBtns = document.querySelectorAll('.hz-btn');
    var found = null;
    for (var i = 0; i < hzBtns.length; i++) {
      var r = hzBtns[i].getBoundingClientRect();
      if (mx >= r.left && mx <= r.right && my >= r.top && my <= r.bottom) {
        found = hzBtns[i];
        break;
      }
    }

    if (found) {
      if (dwell.btnEl === found && !dwell.triggered) {
        var elapsed = performance.now() - dwell.startTime;
        if (elapsed >= 500) {
          dwell.triggered = true;
          found.classList.remove('hz-btn-dwell');
          found.classList.add('hz-btn-trigger');
          R.scrollHours = 0;
          R.setHorizon(Number(found.dataset.hours));
          setTimeout(function () { found.classList.remove('hz-btn-trigger'); }, 300);
        } else {
          found.classList.add('hz-btn-dwell');
        }
      } else if (dwell.btnEl !== found) {
        if (dwell.btnEl) dwell.btnEl.classList.remove('hz-btn-dwell', 'hz-btn-trigger');
        dwell.btnEl = found;
        dwell.startTime = performance.now();
        dwell.triggered = false;
      }
    } else {
      if (dwell.btnEl) dwell.btnEl.classList.remove('hz-btn-dwell', 'hz-btn-trigger');
      dwell.btnEl = null;
      dwell.triggered = false;
    }
  };

  R.dwellReset = function () {
    if (dwell.btnEl) dwell.btnEl.classList.remove('hz-btn-dwell', 'hz-btn-trigger');
    dwell.btnEl = null;
    dwell.triggered = false;
  };
})();

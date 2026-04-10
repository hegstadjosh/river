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
    justAdvanced: false // prevents instant re-trigger
  };

  R.wizardState = wiz;

  // Field height in pixels
  var FIELD_H = 48;

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
    wiz.justAdvanced = true;
    wiz.zones = computeZones(STAGE_PRESETS[0]());
  };

  R.wizardDeactivate = function () {
    wiz.active = false;
    wiz.stage = -1;
    wiz.taskId = null;
    wiz.zones = [];
    wiz.selectedIdx = -1;
  };

  R.wizardIsActive = function () { return wiz.active && wiz.stage >= 0 && wiz.stage <= 2; };
  R.wizardIsCompleted = function () { return wiz.active && wiz.stage > 2; };

  // ── Mouse Tracking (called from river-input.js) ───────────────────

  R.wizardMouseMove = function (mx, my) {
    if (!wiz.active || wiz.stage > 2) return;

    var inField = my >= wiz.fieldTop && my <= wiz.fieldBot;

    if (inField) {
      wiz.justAdvanced = false;

      // Find which zone the cursor is in
      var newIdx = -1;
      for (var i = 0; i < wiz.zones.length; i++) {
        var z = wiz.zones[i];
        if (mx >= z.x && mx < z.x + z.w) {
          newIdx = i;
          break;
        }
      }

      if (newIdx !== wiz.selectedIdx && newIdx >= 0) {
        wiz.selectedIdx = newIdx;
        // IMMEDIATELY transform the task
        applyZoneToTask(wiz.stage, wiz.zones[newIdx].value);
      }
    } else if (my > wiz.fieldBot && !wiz.justAdvanced) {
      // Exited below the field — advance to next stage
      advanceStage();
    } else if (my < wiz.fieldTop && !wiz.justAdvanced) {
      // Exited above — also advance (they're sweeping back up for next stage)
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
    wiz.justAdvanced = true;

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

  R.drawWizardField = function (t) {
    if (!wiz.active || wiz.stage > 2) return;

    var ctx = R.ctx;
    var fadeIn = Math.min(1, (performance.now() - wiz.stageStartT) / 150);

    // Draw the field background — a warm glowing band at the surface
    var grad = ctx.createLinearGradient(0, wiz.fieldTop - 10, 0, wiz.fieldBot + 10);
    grad.addColorStop(0, 'rgba(200, 165, 110, 0)');
    grad.addColorStop(0.15, 'rgba(200, 165, 110, ' + (0.03 * fadeIn) + ')');
    grad.addColorStop(0.5, 'rgba(200, 165, 110, ' + (0.06 * fadeIn) + ')');
    grad.addColorStop(0.85, 'rgba(200, 165, 110, ' + (0.03 * fadeIn) + ')');
    grad.addColorStop(1, 'rgba(200, 165, 110, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, wiz.fieldTop - 10, R.W, wiz.fieldH + 20);

    // Draw each zone as a colored glow
    for (var i = 0; i < wiz.zones.length; i++) {
      var z = wiz.zones[i];
      var isActive = i === wiz.selectedIdx;
      var alpha = isActive ? 0.35 * fadeIn : 0.12 * fadeIn;

      // Zone glow — radial gradient centered in the zone
      var cx = z.x + z.w / 2;
      var cy = (wiz.fieldTop + wiz.fieldBot) / 2;
      var rx = z.w / 2;
      var ry = wiz.fieldH / 2;

      var zg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
      zg.addColorStop(0, 'rgba(' + z.r + ',' + z.g + ',' + z.b + ',' + alpha + ')');
      zg.addColorStop(0.6, 'rgba(' + z.r + ',' + z.g + ',' + z.b + ',' + (alpha * 0.5) + ')');
      zg.addColorStop(1, 'rgba(' + z.r + ',' + z.g + ',' + z.b + ',0)');
      ctx.fillStyle = zg;
      ctx.fillRect(z.x, wiz.fieldTop, z.w, wiz.fieldH);

      // Active zone: bright border glow
      if (isActive) {
        ctx.beginPath();
        ctx.roundRect(z.x + 2, wiz.fieldTop + 2, z.w - 4, wiz.fieldH - 4, 8);
        ctx.strokeStyle = 'rgba(' + z.r + ',' + z.g + ',' + z.b + ',' + (0.4 * fadeIn) + ')';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Zone label
      ctx.font = (isActive ? '600 ' : '400 ') + '12px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255, 255, 255, ' + (isActive ? 0.9 : 0.4) * fadeIn + ')';
      ctx.fillText(z.label, cx, cy);
    }

    // Stage label above the field
    ctx.font = '500 9px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(200, 165, 110, ' + (0.4 * fadeIn) + ')';
    ctx.fillText(STAGE_LABELS[wiz.stage], R.W / 2, wiz.fieldTop - 4);

    // Stage dots (show progress: ● ○ ○)
    for (var d = 0; d < 3; d++) {
      ctx.beginPath();
      ctx.arc(R.W / 2 - 12 + d * 12, wiz.fieldBot + 10, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = d <= wiz.stage
        ? 'rgba(200, 165, 110, ' + (0.5 * fadeIn) + ')'
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

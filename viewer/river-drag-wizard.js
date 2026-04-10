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
    lastSide: null     // 'above' or 'below' — which side the cursor was last on
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
    wiz.lastSide = 'above'; // starting from cloud = above the field
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

    var inField = my >= wiz.fieldTop && my <= wiz.fieldBot;
    var above = my < wiz.fieldTop;
    var below = my > wiz.fieldBot;

    // While in the field: update zone selection and transform the task
    if (inField) {
      var newIdx = -1;
      for (var i = 0; i < wiz.zones.length; i++) {
        var z = wiz.zones[i];
        if (mx >= z.x && mx < z.x + z.w) { newIdx = i; break; }
      }
      if (newIdx >= 0 && newIdx !== wiz.selectedIdx) {
        wiz.selectedIdx = newIdx;
        applyZoneToTask(wiz.stage, wiz.zones[newIdx].value);
      }
    }

    // Zigzag stage advancement:
    // Stage 0 (duration):  starts above, advance when exits BELOW (dragging down)
    // Stage 1 (commitment): starts below, advance when exits ABOVE (dragging up)
    // Stage 2 (energy):     starts above, advance when exits BELOW (dragging down → land in river)
    var exitDir = null;
    if (below && wiz.lastSide !== 'below') exitDir = 'below';
    if (above && wiz.lastSide !== 'above') exitDir = 'above';

    if (above) wiz.lastSide = 'above';
    if (below) wiz.lastSide = 'below';

    var shouldAdvance = false;
    if (wiz.stage === 0 && exitDir === 'below') shouldAdvance = true;  // dragged down through duration
    if (wiz.stage === 1 && exitDir === 'above') shouldAdvance = true;  // dragged back up through commitment
    if (wiz.stage === 2 && exitDir === 'below') shouldAdvance = true;  // dragged down through energy → done

    if (shouldAdvance) advanceStage();
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

    if (wiz.stage <= 2) {
      wiz.zones = computeZones(STAGE_PRESETS[wiz.stage]());
      // After stage 0 (exited below), cursor is below → lastSide = 'below'
      // After stage 1 (exited above), cursor is above → lastSide = 'above'
      // Stage 2 starts from above (just like stage 0)
    }
    // stage > 2 = completed
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

    // Find which horizon button the cursor is over
    var hzBtns = document.querySelectorAll('.hz-btn');
    var found = null;
    var foundRect = null;
    for (var i = 0; i < hzBtns.length; i++) {
      var r = hzBtns[i].getBoundingClientRect();
      // Expand hit area vertically since cursor might be approaching from below
      if (mx >= r.left - 5 && mx <= r.right + 5 && my >= r.top - 15 && my <= r.bottom + 15) {
        found = hzBtns[i];
        foundRect = r;
        break;
      }
    }

    // Update all buttons — the one being hovered gets the active look
    var hzBtns = document.querySelectorAll('.hz-btn');
    for (var b = 0; b < hzBtns.length; b++) {
      hzBtns[b].classList.toggle('hz-btn-preview', hzBtns[b] === found);
    }

    if (found) {
      if (dwell.btnEl === found && !dwell.triggered) {
        var elapsed = performance.now() - dwell.startTime;
        dwell.progress = Math.min(1, elapsed / 250);

        if (elapsed >= 250) {
          dwell.triggered = true;
          dwell.progress = 1;
          found.classList.remove('hz-btn-preview');
          // Flash and switch simultaneously
          dwellFlash.active = true;
          dwellFlash.cx = (foundRect.left + foundRect.right) / 2;
          dwellFlash.cy = (foundRect.top + foundRect.bottom) / 2;
          dwellFlash.startT = performance.now();
          R.scrollHours = 0;
          R.setHorizon(Number(found.dataset.hours));
        }
      } else if (dwell.btnEl !== found) {
        dwell.btnEl = found;
        dwell.btnRect = foundRect;
        dwell.btnHours = Number(found.dataset.hours);
        dwell.startTime = performance.now();
        dwell.triggered = false;
        dwell.progress = 0;
      }
    } else {
      dwell.btnEl = null;
      dwell.btnRect = null;
      dwell.progress = 0;
      dwell.triggered = false;
    }
  };

  R.dwellReset = function () {
    // Clear all preview states
    var btns = document.querySelectorAll('.hz-btn');
    for (var i = 0; i < btns.length; i++) btns[i].classList.remove('hz-btn-preview');
    dwell.btnEl = null;
    dwell.btnRect = null;
    dwell.progress = 0;
    dwell.triggered = false;
  };

  // ── Dwell Rendering ─────────────────────────────────────────────────
  // The bar comes alive when you drag near it. Buttons breathe, the
  // hovered one swells, and the trigger flashes like a sunburst.

  var dwellFlash = { active: false, cx: 0, cy: 0, startT: 0 };

  R.drawDwellIndicator = function (t) {
    var ctx = R.ctx;

    // ── Tick the dwell timer every frame (not just on mousemove) ──
    if (R.dragging && R.dragging.moved && R.dragging.zone === 'river' && !wiz.active) {
      R.dwellCheckStart(R.mouseX, R.mouseY);
    }

    // ── Flash effect after trigger — outlines the entire river ──
    if (dwellFlash.active) {
      var age = (performance.now() - dwellFlash.startT) / 500;
      if (age > 1) { dwellFlash.active = false; }
      else {
        var sY = R.surfaceY();
        var flashA = (1 - age) * 0.5;
        var inset = 8 + age * 4;

        // Bright border around the entire river zone
        ctx.strokeStyle = 'rgba(255, 220, 160, ' + flashA + ')';
        ctx.lineWidth = 3 - age * 2;
        ctx.beginPath();
        ctx.roundRect(inset, sY + inset, R.W - inset * 2, R.H - sY - inset * 2, 8);
        ctx.stroke();

        // Warm wash over the river
        ctx.fillStyle = 'rgba(200, 165, 110, ' + (flashA * 0.15) + ')';
        ctx.fillRect(0, sY, R.W, R.H - sY);

        // Small flash at the button that triggered
        var flashR = 20 + age * 40;
        var btnA = (1 - age) * 0.4;
        var fg = ctx.createRadialGradient(dwellFlash.cx, dwellFlash.cy, 0, dwellFlash.cx, dwellFlash.cy, flashR);
        fg.addColorStop(0, 'rgba(255, 230, 180, ' + btnA + ')');
        fg.addColorStop(1, 'rgba(200, 165, 110, 0)');
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.arc(dwellFlash.cx, dwellFlash.cy, flashR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ── Bar glow when dragging from river ──
    if (!R.dragging || !R.dragging.moved) return;
    if (R.dragging.zone !== 'river') return;

    var barEl = document.getElementById('horizon-bar');
    if (!barEl) return;
    var barR = barEl.getBoundingClientRect();

    // Whole bar glow — tight, pulsing softly
    var pulse = Math.sin(t / 1200 * Math.PI) * 0.5 + 0.5;
    var barGlowA = 0.04 + pulse * 0.04;
    var pad = 4 + pulse * 3;
    ctx.fillStyle = 'rgba(200, 165, 110, ' + barGlowA + ')';
    ctx.beginPath();
    ctx.roundRect(barR.left - pad, barR.top - pad, barR.width + pad * 2, barR.height + pad * 2, 12);
    ctx.fill();

    // ── Hovered button: crisp box + glow on top ──
    if (dwell.btnEl && dwell.btnRect && !dwell.triggered) {
      var br = dwell.btnRect;
      var p = dwell.progress;

      // Outer glow — warm amber, grows with progress
      var glowPad = 4 + p * 8;
      var glowA = 0.1 + p * 0.25;
      ctx.fillStyle = 'rgba(200, 165, 110, ' + glowA + ')';
      ctx.beginPath();
      ctx.roundRect(br.left - glowPad, br.top - glowPad, br.width + glowPad * 2, br.height + glowPad * 2, 8);
      ctx.fill();

      // Inner box — brighter, distinct
      var boxA = 0.2 + p * 0.35;
      ctx.fillStyle = 'rgba(255, 220, 160, ' + boxA + ')';
      ctx.beginPath();
      ctx.roundRect(br.left - 2, br.top - 2, br.width + 4, br.height + 4, 6);
      ctx.fill();

      // Border — crisp edge so you know exactly which button
      ctx.strokeStyle = 'rgba(255, 230, 180, ' + (0.3 + p * 0.5) + ')';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(br.left - 2, br.top - 2, br.width + 4, br.height + 4, 6);
      ctx.stroke();
    }
  };

})();

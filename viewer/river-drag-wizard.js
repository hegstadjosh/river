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
    // Match the horizon bar's exact position and width
    var bar = document.getElementById('horizon-bar');
    var barRect = bar ? bar.getBoundingClientRect() : null;
    var left = barRect ? barRect.left : R.W * 0.2;
    var totalW = barRect ? barRect.width : R.W * 0.6;
    var n = presets.length;
    var zones = [];
    for (var i = 0; i < n; i++) {
      zones.push({
        x: left + (totalW / n) * i,
        w: totalW / n,
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
    // Match the horizon bar's exact vertical position
    var bar = document.getElementById('horizon-bar');
    var barRect = bar ? bar.getBoundingClientRect() : null;
    var barMidY = barRect ? (barRect.top + barRect.bottom) / 2 : R.surfaceY();
    var barH = barRect ? barRect.height : FIELD_H;

    wiz.active = true;
    wiz.stage = 0;
    wiz.taskId = taskId;
    wiz.fieldH = barH;
    wiz.fieldTop = barMidY - barH / 2;
    wiz.fieldBot = barMidY + barH / 2;
    wiz.selectedIdx = -1;
    wiz.stageStartT = performance.now();
    wiz.lastSide = 'above';
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

  // ── Rendering ──────────────────────────────────────────────────────
  // Seamless with the horizon bar: same width, same shape, dark glass background.
  // Zones are subtle color-tinted sections with clean dividers.
  // Active zone brightens. The whole thing feels like a facet of the same bar.

  R.drawWizardField = function (t) {
    if (!wiz.active || wiz.stage > 2) return;

    var ctx = R.ctx;
    var fadeIn = Math.min(1, (performance.now() - wiz.stageStartT) / 150);
    var z0 = wiz.zones[0];
    var zLast = wiz.zones[wiz.zones.length - 1];
    var totalLeft = z0.x;
    var totalW = zLast.x + zLast.w - z0.x;
    var cr = 8; // corner radius matching the bar

    // ── Dark glass background — matches the horizon bar ──
    ctx.fillStyle = 'rgba(20, 17, 14, ' + (0.8 * fadeIn) + ')';
    ctx.beginPath();
    ctx.roundRect(totalLeft, wiz.fieldTop, totalW, wiz.fieldH, cr);
    ctx.fill();

    // Outer border — warm, subtle
    ctx.strokeStyle = 'rgba(200, 165, 110, ' + (0.12 * fadeIn) + ')';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(totalLeft, wiz.fieldTop, totalW, wiz.fieldH, cr);
    ctx.stroke();

    // ── Zones ──
    ctx.save();
    // Clip to the rounded bar shape
    ctx.beginPath();
    ctx.roundRect(totalLeft, wiz.fieldTop, totalW, wiz.fieldH, cr);
    ctx.clip();

    for (var i = 0; i < wiz.zones.length; i++) {
      var z = wiz.zones[i];
      var isActive = i === wiz.selectedIdx;

      // Zone color tint — very subtle when inactive, rich when active
      var a = isActive ? 0.35 * fadeIn : 0.08 * fadeIn;
      ctx.fillStyle = 'rgba(' + z.r + ',' + z.g + ',' + z.b + ',' + a + ')';
      ctx.fillRect(z.x, wiz.fieldTop, z.w, wiz.fieldH);

      // Active: brighter inner glow
      if (isActive) {
        var gx = z.x + z.w / 2;
        var gy = wiz.fieldTop + wiz.fieldH / 2;
        var gr = z.w / 2;
        var ig = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
        ig.addColorStop(0, 'rgba(' + z.r + ',' + z.g + ',' + z.b + ',' + (0.2 * fadeIn) + ')');
        ig.addColorStop(1, 'rgba(' + z.r + ',' + z.g + ',' + z.b + ',0)');
        ctx.fillStyle = ig;
        ctx.fillRect(z.x, wiz.fieldTop, z.w, wiz.fieldH);
      }

      // Divider — thin warm line (except after last)
      if (i < wiz.zones.length - 1) {
        ctx.beginPath();
        ctx.moveTo(z.x + z.w, wiz.fieldTop + 4);
        ctx.lineTo(z.x + z.w, wiz.fieldBot - 4);
        ctx.strokeStyle = 'rgba(200, 165, 110, ' + (0.12 * fadeIn) + ')';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Label
      ctx.font = (isActive ? '600 ' : '400 ') + '10px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(200, 165, 110, ' + (isActive ? 0.95 : 0.4) * fadeIn + ')';
      ctx.fillText(z.label, z.x + z.w / 2, wiz.fieldTop + wiz.fieldH / 2);
    }

    ctx.restore();

    // ── Stage indicator — tiny dots below the bar ──
    for (var d = 0; d < 3; d++) {
      ctx.beginPath();
      ctx.arc(totalLeft + totalW / 2 - 8 + d * 8, wiz.fieldBot + 6, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = d <= wiz.stage
        ? 'rgba(200, 165, 110, ' + (0.55 * fadeIn) + ')'
        : 'rgba(200, 165, 110, ' + (0.12 * fadeIn) + ')';
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

    // Find which horizon element the cursor is over (buttons OR arrows)
    var hzBtns = document.querySelectorAll('.hz-btn');
    var hzPrev = document.getElementById('hz-prev');
    var hzNext = document.getElementById('hz-next');
    var found = null;
    var foundRect = null;
    var foundIsArrow = false;

    // Check scale buttons
    for (var i = 0; i < hzBtns.length; i++) {
      var r = hzBtns[i].getBoundingClientRect();
      if (mx >= r.left - 5 && mx <= r.right + 5 && my >= r.top - 15 && my <= r.bottom + 15) {
        found = hzBtns[i];
        foundRect = r;
        break;
      }
    }

    // Check prev/next arrows
    if (!found) {
      var arrows = [hzPrev, hzNext];
      for (var a = 0; a < arrows.length; a++) {
        if (!arrows[a]) continue;
        var ar = arrows[a].getBoundingClientRect();
        if (mx >= ar.left - 5 && mx <= ar.right + 5 && my >= ar.top - 15 && my <= ar.bottom + 15) {
          found = arrows[a];
          foundRect = ar;
          foundIsArrow = true;
          break;
        }
      }
    }

    // Update all buttons + arrows — the one being hovered gets the active look
    var allHzEls = document.querySelectorAll('.hz-btn, .hz-arrow');
    for (var b = 0; b < allHzEls.length; b++) {
      allHzEls[b].classList.toggle('hz-btn-preview', allHzEls[b] === found);
    }

    if (found) {
      // Must leave and re-enter after arrow trigger
      if (dwell.mustLeave && dwell.btnEl === found) return;
      if (dwell.mustLeave && dwell.btnEl !== found) dwell.mustLeave = false;

      if (dwell.btnEl === found && !dwell.triggered) {
        var elapsed = performance.now() - dwell.startTime;
        dwell.progress = Math.min(1, elapsed / 250);

        if (elapsed >= 250) {
          dwell.triggered = true;
          dwell.progress = 1;
          found.classList.remove('hz-btn-preview');

          // Flash
          dwellFlash.active = true;
          dwellFlash.cx = (foundRect.left + foundRect.right) / 2;
          dwellFlash.cy = (foundRect.top + foundRect.bottom) / 2;
          dwellFlash.startT = performance.now();

          if (foundIsArrow) {
            // Arrow: step forward/back by one frame unit
            var step = R.frameStep();
            if (found.id === 'hz-prev') R.scrollHours -= step;
            else R.scrollHours += step;
            if (R.updateFrameLabel) R.updateFrameLabel();
            // Must leave and re-enter to trigger again
            dwell.mustLeave = true;
          } else {
            // Scale button: switch timeframe
            R.scrollHours = 0;
            R.setHorizon(Number(found.dataset.hours));
          }
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
    var els = document.querySelectorAll('.hz-btn, .hz-arrow');
    for (var i = 0; i < els.length; i++) els[i].classList.remove('hz-btn-preview');
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
    // Glow surrounds the bar but does NOT cover the inside.
    if (!R.dragging || !R.dragging.moved) return;
    if (R.dragging.zone !== 'river') return;

    var barEl = document.getElementById('horizon-bar');
    if (!barEl) return;
    var barR = barEl.getBoundingClientRect();
    var barCR = 10; // matches the bar's CSS border-radius

    // Glow — drawn ONLY outside the bar. Bar is opaque during drag so
    // we just need to not overlap it. Draw a soft amber outline.
    var pulse = Math.sin(t / 1200 * Math.PI) * 0.5 + 0.5;
    var glowA = 0.1 + pulse * 0.07;

    ctx.strokeStyle = 'rgba(200, 165, 110, ' + glowA + ')';
    ctx.lineWidth = 2 + pulse;
    ctx.beginPath();
    ctx.roundRect(barR.left - 2, barR.top - 2, barR.width + 4, barR.height + 4, barCR + 2);
    ctx.stroke();

    // Hovered button: warm border
    if (dwell.btnEl && dwell.btnRect && !dwell.triggered) {
      var br = dwell.btnRect;
      var p = dwell.progress;
      ctx.strokeStyle = 'rgba(200, 165, 110, ' + (0.3 + p * 0.5) + ')';
      ctx.lineWidth = 1.5 + p;
      ctx.beginPath();
      ctx.roundRect(br.left - 1, br.top - 1, br.width + 2, br.height + 2, 5);
      ctx.stroke();
    }
  };

})();

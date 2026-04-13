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
      { value: 0.40, label: 'maybe',    r: 200, g: 165, b: 110 },
      { value: 0.60, label: 'likely',   r: 210, g: 170, b: 105 },
      { value: 0.80, label: 'solid',    r: 220, g: 175, b: 95 },
      { value: 0.95, label: 'locked',   r: 235, g: 190, b: 80 }
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
    // Zone positions are determined by DOM layout — just store the data
    return presets.map(function (p) {
      return { value: p.value, label: p.label, r: p.r, g: p.g, b: p.b };
    });
  }

  // ── Activation / Deactivation ─────────────────────────────────────

  var horizonBar = document.getElementById('horizon-bar');
  var wizardEl = document.getElementById('wizard-field');
  var wizardZonesEl = wizardEl.querySelector('.wizard-field-zones');

  R.wizardActivate = function (taskId) {
    if (R.isMobile) return; // no wizard on mobile
    wiz.active = true;
    wiz.stage = 0;
    wiz.taskId = taskId;
    wiz.selectedIdx = -1;
    wiz.stageStartT = performance.now();
    wiz.lastSide = 'above';
    wiz.zones = computeZones(STAGE_PRESETS[0]());

    // Measure the horizon bar BEFORE hiding it, then size wizard to match
    var rect = horizonBar.getBoundingClientRect();
    wizardEl.style.width = rect.width + 'px';
    wizardEl.style.height = rect.height + 'px';

    // Hide horizon bar, show wizard field
    horizonBar.style.display = 'none';
    wizardEl.classList.remove('hidden');
    renderWizardDOM();
    updateFieldRect();
  };

  R.wizardDeactivate = function () {
    wiz.active = false;
    wiz.stage = -1;
    wiz.taskId = null;
    wiz.zones = [];
    wiz.selectedIdx = -1;

    wizardEl.classList.add('hidden');
    wizardEl.style.width = '';
    wizardEl.style.height = '';
    horizonBar.style.display = '';
  };

  function updateFieldRect() {
    var rect = wizardEl.getBoundingClientRect();
    wiz.fieldTop = rect.top;
    wiz.fieldBot = rect.bottom;
    wiz.fieldH = rect.height;
  }

  function renderWizardDOM() {
    var presets = wiz.zones;
    var isEnergy = wiz.stage === 2;
    var isCommitment = wiz.stage === 1;
    wizardZonesEl.innerHTML = '';
    for (var i = 0; i < presets.length; i++) {
      var p = presets[i];
      var zone = document.createElement('div');
      var isActive = i === wiz.selectedIdx;
      zone.className = 'wizard-zone' + (isActive ? ' active' : '');
      zone.textContent = p.label;

      if (isEnergy) {
        // Energy: always show the color — it IS a color picker
        var a = isActive ? 0.3 : 0.12;
        zone.style.background = 'rgba(' + p.r + ',' + p.g + ',' + p.b + ',' + a + ')';
        zone.style.color = 'rgb(' + p.r + ',' + p.g + ',' + p.b + ')';
        zone.style.borderColor = 'rgba(' + p.r + ',' + p.g + ',' + p.b + ',0.2)';
      } else if (isCommitment) {
        // Commitment: background + text opacity = the actual commitment value
        var v = p.value; // 0.15, 0.40, 0.70, 0.95
        var bgA = isActive ? v * 0.4 : v * 0.2;
        var txtA = isActive ? Math.max(v, 0.8) : v;
        zone.style.background = 'rgba(200, 165, 110, ' + bgA + ')';
        zone.style.color = 'rgba(200, 165, 110, ' + txtA + ')';
      } else if (isActive) {
        // Duration: just highlight active
        zone.style.background = 'rgba(200, 165, 110, 0.12)';
        zone.style.color = 'rgba(200, 165, 110, 0.95)';
      }
      wizardZonesEl.appendChild(zone);
    }

  }

  R.wizardIsActive = function () { return wiz.active && wiz.stage >= 0 && wiz.stage <= 2; };
  R.wizardIsCompleted = function () { return wiz.active && wiz.stage > 2; };

  // ── Mouse Tracking (called from river-input.js) ───────────────────

  R.wizardMouseMove = function (mx, my) {
    if (!wiz.active || wiz.stage > 2) return;

    updateFieldRect();

    var inField = my >= wiz.fieldTop && my <= wiz.fieldBot;
    var above = my < wiz.fieldTop;
    var below = my > wiz.fieldBot;

    // Only select zones while cursor is IN the field or crossing through it
    if (inField) {
      wiz.wasInField = true;
      var zoneEls = wizardZonesEl.querySelectorAll('.wizard-zone');
      var newIdx = -1;
      for (var i = 0; i < zoneEls.length; i++) {
        var zr = zoneEls[i].getBoundingClientRect();
        if (mx >= zr.left && mx < zr.right) { newIdx = i; break; }
      }
      if (newIdx >= 0 && newIdx !== wiz.selectedIdx) {
        wiz.selectedIdx = newIdx;
        applyZoneToTask(wiz.stage, wiz.zones[newIdx].value);
        renderWizardDOM();
      }
    }

    // Fast swipe: cursor jumped from above to below without being inField.
    // Use the last X to pick a zone, apply it, then advance.
    var crossedDown = below && wiz.lastSide === 'above';
    var crossedUp = above && wiz.lastSide === 'below';

    if ((crossedDown || crossedUp) && !wiz.wasInField) {
      // Cursor skipped the field — pick zone by X
      var zoneEls2 = wizardZonesEl.querySelectorAll('.wizard-zone');
      for (var j = 0; j < zoneEls2.length; j++) {
        var zr2 = zoneEls2[j].getBoundingClientRect();
        if (mx >= zr2.left && mx < zr2.right) {
          wiz.selectedIdx = j;
          applyZoneToTask(wiz.stage, wiz.zones[j].value);
          renderWizardDOM();
          break;
        }
      }
    }

    if (above) { wiz.lastSide = 'above'; wiz.wasInField = false; }
    if (below) { wiz.lastSide = 'below'; wiz.wasInField = false; }

    // Stage advancement on boundary crossing
    var shouldAdvance = false;
    if (wiz.stage === 0 && crossedDown) shouldAdvance = true;
    if (wiz.stage === 1 && crossedUp) shouldAdvance = true;
    if (wiz.stage === 2 && crossedDown) shouldAdvance = true;

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
      renderWizardDOM();
      updateFieldRect();
    } else {
      // Completed — hide the field
      wizardEl.classList.add('hidden');
    }
  }

  // ── Get Selections for POST ───────────────────────────────────────

  R.wizardGetSelections = function () {
    var a = R.findTask(wiz.taskId);
    if (!a) return { mass: null, solidity: null, energy: null };
    return { mass: a.mass, solidity: a.solidity, energy: a.energy };
  };

  // No Canvas rendering for the wizard field — it's a DOM element now.
  // R.drawWizardField is kept as a no-op so the frame loop doesn't break.
  R.drawWizardField = function () {};

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
    var barEl = document.getElementById('horizon-bar');
    if (barEl) barEl.classList.remove('river-bar-glow');
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
    if (R.dragging && R.dragging.moved && (R.dragging.zone === 'river' || R.dragging.zone === 'plan') && !wiz.active) {
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

    // ── Dwell glow on horizon bar (CSS box-shadow via class) ──
    if (!R.dragging || !R.dragging.moved) return;

    var barEl = document.getElementById('horizon-bar');
    if (!barEl) return;

    // Add/remove glow class on the bar during river drag
    if (R.dragging.zone === 'river' || R.dragging.zone === 'plan') {
      barEl.classList.add('river-bar-glow');
    }

    // Hovered button highlight via CSS class (already handled by hz-btn-preview)

  };

})();

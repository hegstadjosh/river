// viewer/river-drag-wizard.js — Cloud-to-River drag wizard + drag-to-horizon timeframe switch
// Two interaction features:
// 1. When dragging a cloud task into the river, the horizon bar transforms into a
//    3-stage property selector (duration, commitment, energy).
// 2. When dragging a river task upward toward the horizon bar, hovering over a
//    scale button for 500ms triggers a timeframe switch.
(function () {
  'use strict';

  var R = window.River;

  // ── Wizard State ────────────────────────────────────────────────────

  var wizard = {
    active: false,
    stage: 0,           // 0=duration, 1=commitment, 2=energy
    hovered: -1,        // index of currently hovered preset (-1 = none)
    selections: [null, null, null], // chosen values per stage
    taskId: null,
    fadeIn: 0,          // 0-1 transition progress
    stageStartTime: 0,  // timestamp when stage started (for transition)
    barRect: null,       // cached bounding rect of #horizon-bar
    completed: false    // all stages done, task is free in river
  };

  R.wizard = wizard;

  // Preset definitions for each stage
  var COMMITMENT_PRESETS = [
    { v: 0.25, l: '25%', label: 'Light' },
    { v: 0.50, l: '50%', label: 'Medium' },
    { v: 0.75, l: '75%', label: 'Strong' },
    { v: 1.00, l: '100%', label: 'Locked' }
  ];

  var ENERGY_PRESETS = [
    { v: 0.25, l: 'Low' },
    { v: 0.50, l: 'Medium' },
    { v: 0.75, l: 'High' },
    { v: 1.00, l: 'Intense' }
  ];

  var STAGE_NAMES = ['duration', 'commitment', 'energy'];
  var STAGE_COLORS = [
    'rgba(200, 165, 110, 0.08)',  // duration — warm amber
    'rgba(170, 190, 140, 0.08)',  // commitment — muted green
    'rgba(180, 150, 120, 0.08)'   // energy — earthy
  ];

  // ── DOM Elements ────────────────────────────────────────────────────

  var horizonBar = document.getElementById('horizon-bar');
  var wizardOverlay = null; // created on first use

  function ensureOverlay() {
    if (wizardOverlay) return wizardOverlay;
    wizardOverlay = document.createElement('div');
    wizardOverlay.id = 'wizard-overlay';
    wizardOverlay.className = 'wizard-overlay hidden';
    wizardOverlay.innerHTML =
      '<div class="wizard-stage-label"></div>' +
      '<div class="wizard-presets"></div>';
    horizonBar.parentNode.insertBefore(wizardOverlay, horizonBar.nextSibling);
    return wizardOverlay;
  }

  // ── Wizard Activation ───────────────────────────────────────────────

  R.wizardActivate = function (taskId) {
    var overlay = ensureOverlay();
    wizard.active = true;
    wizard.stage = 0;
    wizard.hovered = -1;
    wizard.selections = [null, null, null];
    wizard.taskId = taskId;
    wizard.fadeIn = 0;
    wizard.stageStartTime = performance.now();
    wizard.completed = false;
    wizard.barRect = horizonBar.getBoundingClientRect();

    // Hide normal bar content, show wizard
    horizonBar.classList.add('wizard-active');
    overlay.classList.remove('hidden');
    renderWizardStage();
  };

  R.wizardDeactivate = function () {
    wizard.active = false;
    wizard.completed = false;
    wizard.taskId = null;
    horizonBar.classList.remove('wizard-active');
    if (wizardOverlay) wizardOverlay.classList.add('hidden');
  };

  R.wizardIsActive = function () {
    return wizard.active && !wizard.completed;
  };

  R.wizardIsCompleted = function () {
    return wizard.active && wizard.completed;
  };

  // ── Stage Rendering ─────────────────────────────────────────────────

  function getStagePresets() {
    if (wizard.stage === 0) {
      return R.getPresets().map(function (p) {
        return { v: p.m, l: p.l };
      });
    } else if (wizard.stage === 1) {
      return COMMITMENT_PRESETS;
    } else {
      return ENERGY_PRESETS;
    }
  }

  function renderWizardStage() {
    var overlay = ensureOverlay();
    var label = overlay.querySelector('.wizard-stage-label');
    var container = overlay.querySelector('.wizard-presets');

    label.textContent = STAGE_NAMES[wizard.stage];
    overlay.style.setProperty('--wizard-bg', STAGE_COLORS[wizard.stage]);

    var presets = getStagePresets();
    container.innerHTML = '';
    for (var i = 0; i < presets.length; i++) {
      var btn = document.createElement('div');
      btn.className = 'wizard-preset';
      btn.dataset.index = i;
      btn.textContent = presets[i].l;
      if (presets[i].label) {
        btn.innerHTML = '<span class="wizard-preset-label">' + presets[i].label + '</span>' + presets[i].l;
      }
      container.appendChild(btn);
    }

    // Trigger transition
    overlay.classList.remove('wizard-stage-0', 'wizard-stage-1', 'wizard-stage-2');
    overlay.classList.add('wizard-stage-' + wizard.stage);
    wizard.hovered = -1;
  }

  // ── Mouse Tracking (called from river-input.js mousemove) ──────────

  R.wizardMouseMove = function (mx, my) {
    if (!wizard.active || wizard.completed) return;

    // Update bar rect (might change on scroll)
    wizard.barRect = horizonBar.getBoundingClientRect();
    var rect = wizard.barRect;

    // Fade in
    var elapsed = performance.now() - wizard.stageStartTime;
    wizard.fadeIn = Math.min(1, elapsed / 200);

    // Check if cursor is in the bar area (vertically)
    var inBar = my >= rect.top - 10 && my <= rect.bottom + 10;

    if (inBar) {
      // Determine which preset the cursor is over (horizontal position)
      var overlay = ensureOverlay();
      var presetEls = overlay.querySelectorAll('.wizard-preset');
      var newHovered = -1;
      for (var i = 0; i < presetEls.length; i++) {
        var pr = presetEls[i].getBoundingClientRect();
        if (mx >= pr.left && mx <= pr.right) {
          newHovered = i;
          break;
        }
      }

      // Update hover state
      if (newHovered !== wizard.hovered) {
        wizard.hovered = newHovered;
        for (var j = 0; j < presetEls.length; j++) {
          presetEls[j].classList.toggle('wizard-preset-hover', j === newHovered);
        }
      }
    } else if (my > rect.bottom + 10) {
      // Cursor has exited below the bar — select current hover and advance
      var presets = getStagePresets();
      if (wizard.hovered >= 0 && wizard.hovered < presets.length) {
        wizard.selections[wizard.stage] = presets[wizard.hovered].v;
      }
      // else: keep default (null = no selection = skip)

      if (wizard.stage < 2) {
        wizard.stage++;
        wizard.stageStartTime = performance.now();
        wizard.hovered = -1;
        renderWizardStage();
      } else {
        // All stages done
        wizard.completed = true;
        applyWizardSelections();
        horizonBar.classList.remove('wizard-active');
        if (wizardOverlay) wizardOverlay.classList.add('hidden');
      }
    }
    // If cursor is above the bar, don't change anything (let them re-enter)
  };

  function applyWizardSelections() {
    var a = R.findTask(wizard.taskId);
    if (!a) return;

    // Apply duration if selected
    if (wizard.selections[0] !== null) {
      a.mass = wizard.selections[0];
    }
    // Apply commitment if selected
    if (wizard.selections[1] !== null) {
      a.solidity = wizard.selections[1];
    }
    // Apply energy if selected
    if (wizard.selections[2] !== null) {
      a.energy = wizard.selections[2];
    }
  }

  // ── Get Final Selections (called on mouseup to include in POST) ────

  R.wizardGetSelections = function () {
    return {
      mass: wizard.selections[0],
      solidity: wizard.selections[1],
      energy: wizard.selections[2]
    };
  };

  // ── Horizon Dwell Switcher ──────────────────────────────────────────
  // When dragging a RIVER task, hovering over a scale button for 500ms
  // triggers a timeframe switch.

  var dwell = {
    active: false,
    btnEl: null,
    btnHours: 0,
    startTime: 0,
    triggered: false
  };

  R.dwellState = dwell;

  R.dwellCheckStart = function (mx, my) {
    // Only active when dragging a river task (not during wizard)
    if (wizard.active) return;

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
      var hours = Number(found.dataset.hours);
      if (dwell.btnEl === found && !dwell.triggered) {
        // Still on same button — check elapsed
        var elapsed = performance.now() - dwell.startTime;
        if (elapsed >= 500) {
          dwell.triggered = true;
          // Remove the grow class before switching
          found.classList.remove('hz-btn-dwell');
          found.classList.add('hz-btn-trigger');
          // Switch timeframe
          R.scrollHours = 0;
          R.scrollVel = 0;
          R.setHorizon(hours);
          // Flash then remove trigger class
          setTimeout(function () {
            found.classList.remove('hz-btn-trigger');
          }, 300);
        } else {
          // Still dwelling — add grow animation
          found.classList.add('hz-btn-dwell');
        }
      } else if (dwell.btnEl !== found) {
        // Moved to a new button — reset
        if (dwell.btnEl) {
          dwell.btnEl.classList.remove('hz-btn-dwell', 'hz-btn-trigger');
        }
        dwell.btnEl = found;
        dwell.btnHours = hours;
        dwell.startTime = performance.now();
        dwell.triggered = false;
        dwell.active = true;
      }
    } else {
      // Not on any button
      if (dwell.btnEl) {
        dwell.btnEl.classList.remove('hz-btn-dwell', 'hz-btn-trigger');
      }
      dwell.btnEl = null;
      dwell.active = false;
      dwell.triggered = false;
    }
  };

  R.dwellReset = function () {
    if (dwell.btnEl) {
      dwell.btnEl.classList.remove('hz-btn-dwell', 'hz-btn-trigger');
    }
    dwell.btnEl = null;
    dwell.active = false;
    dwell.triggered = false;
  };
})();

// viewer/river-panel.js — panel show/hide/position, duration presets, time formatting, all panel listeners
(function () {
  'use strict';

  var R = window.River;

  // ── Panel DOM references ────────────────────────────────────────────

  var panel = document.getElementById('panel');
  var panelName = document.getElementById('panel-name');
  var panelDurations = document.getElementById('panel-durations');
  var panelDurInput = document.getElementById('panel-dur-input');
  var panelSolidity = document.getElementById('panel-solidity');
  var panelBackToCloud = document.getElementById('panel-backtocloud');
  var panelDissolve = document.getElementById('panel-dissolve');
  var panelTimes = document.getElementById('panel-times');
  var panelStart = document.getElementById('panel-start');
  var panelEnd = document.getElementById('panel-end');

  // Hidden native pickers — opened by icon click
  var startPicker = document.getElementById('panel-start-picker');
  var endPicker = document.getElementById('panel-end-picker');
  var startIcon = document.getElementById('panel-start-icon');
  var endIcon = document.getElementById('panel-end-icon');

  // ── Duration Presets ────────────────────────────────────────────────
  // Duration presets per frame. Your spec:
  // 6h-3d: 10, 30, 90, 180 min
  // week: add 1-3 days
  // month: weeks
  // quarter: 1 month
  // year: whatever

  var DURATION_PRESETS = {
    6:    [{ m: 10, l: '10m' }, { m: 30, l: '30m' }, { m: 90, l: '90m' }, { m: 180, l: '3h' }],
    24:   [{ m: 10, l: '10m' }, { m: 30, l: '30m' }, { m: 90, l: '90m' }, { m: 180, l: '3h' }],
    96:   [{ m: 10, l: '10m' }, { m: 30, l: '30m' }, { m: 90, l: '90m' }, { m: 180, l: '3h' }],
    168:  [{ m: 90, l: '90m' }, { m: 180, l: '3h' }, { m: 1440, l: '1d' }, { m: 4320, l: '3d' }],
    720:  [{ m: 10080, l: '1w' }, { m: 20160, l: '2w' }, { m: 30240, l: '3w' }, { m: 40320, l: '4w' }],
    2160: [{ m: 10080, l: '1w' }, { m: 20160, l: '2w' }, { m: 43200, l: '1mo' }, { m: 86400, l: '2mo' }],
    8760: [{ m: 43200, l: '1mo' }, { m: 129600, l: '3mo' }, { m: 259200, l: '6mo' }, { m: 525600, l: '1y' }]
  };
  R.DURATION_PRESETS = DURATION_PRESETS;

  R.getPresets = function () {
    // Find closest matching preset set
    var keys = [6, 24, 96, 168, 720, 2160, 8760];
    var best = 24;
    for (var i = 0; i < keys.length; i++) {
      if (Math.abs(keys[i] - R.horizonHours) < Math.abs(best - R.horizonHours)) best = keys[i];
    }
    return DURATION_PRESETS[best];
  };

  R.renderPresetButtons = function (currentMass) {
    var presets = R.getPresets();
    panelDurations.innerHTML = '';
    for (var i = 0; i < presets.length; i++) {
      var btn = document.createElement('button');
      btn.className = 'dur-btn' + (presets[i].m === currentMass ? ' active' : '');
      btn.dataset.mass = presets[i].m;
      btn.textContent = presets[i].l;
      btn.addEventListener('click', (function (mass) {
        return function () {
          if (!R.selectedId) return;
          for (var j = 0; j < R.selectedIds.length; j++) {
            var a = R.findTask(R.selectedIds[j]);
            if (!a) continue;
            var changes = { mass: mass };
            if (a.position !== null && a.position !== undefined) {
              var massDiffH = (mass - a.mass) / 60;
              changes.position = a.position + massDiffH / 2;
            }
            R.save(R.selectedIds[j], changes);
          }
          panelDurInput.value = R.formatDuration(mass);
          R.renderPresetButtons(mass);
        };
      })(presets[i].m));
      panelDurations.appendChild(btn);
    }
  };

  // ── Duration Formatting / Parsing ──────────────────────────────────

  R.formatDuration = function (mins) {
    if (mins >= 525600) return Math.round(mins / 525600) + 'y';
    if (mins >= 43200) return Math.round(mins / 43200) + 'mo';
    if (mins >= 10080) return Math.round(mins / 10080) + 'w';
    if (mins >= 1440) return (mins / 1440).toFixed(mins % 1440 ? 1 : 0).replace(/\.0$/, '') + 'd';
    if (mins >= 60) {
      var h = Math.floor(mins / 60), m = Math.round(mins % 60);
      return m ? h + 'h ' + m + 'm' : h + 'h';
    }
    return Math.round(mins) + 'm';
  };

  R.parseDuration = function (str) {
    str = str.trim().toLowerCase();
    var total = 0;
    // Match patterns like "2h 30m", "90m", "1.5h", "3d", "2w", "1mo", "1y"
    var patterns = [
      { re: /(\d+(?:\.\d+)?)\s*y/, mult: 525600 },
      { re: /(\d+(?:\.\d+)?)\s*mo/, mult: 43200 },
      { re: /(\d+(?:\.\d+)?)\s*w/, mult: 10080 },
      { re: /(\d+(?:\.\d+)?)\s*d/, mult: 1440 },
      { re: /(\d+(?:\.\d+)?)\s*h/, mult: 60 },
      { re: /(\d+(?:\.\d+)?)\s*m(?!o)/, mult: 1 }
    ];
    var matched = false;
    for (var i = 0; i < patterns.length; i++) {
      var match = str.match(patterns[i].re);
      if (match) { total += parseFloat(match[1]) * patterns[i].mult; matched = true; }
    }
    // Plain number = minutes
    if (!matched && /^\d+(\.\d+)?$/.test(str)) total = parseFloat(str);
    return total > 0 ? Math.round(total) : null;
  };

  // ── Compact Time Formatting / Parsing ──────────────────────────────

  R.parseCompactTime = function (str) {
    // Try parsing things like "3pm", "3:30pm", "Apr 10, 3pm", "4/10 3:30pm"
    str = str.trim().toLowerCase();
    var now = new Date();
    var dateMatch = str.match(/^([a-z]+)\s+(\d+),?\s*/);
    var slashMatch = str.match(/^(\d+)\/(\d+),?\s*/);
    var day = now.getDate(), month = now.getMonth(), year = now.getFullYear();

    if (dateMatch) {
      var mi = R.MONTHS.findIndex(function(m) { return m.toLowerCase().startsWith(dateMatch[1]); });
      if (mi >= 0) month = mi;
      day = parseInt(dateMatch[2]);
      str = str.slice(dateMatch[0].length);
    } else if (slashMatch) {
      month = parseInt(slashMatch[1]) - 1;
      day = parseInt(slashMatch[2]);
      str = str.slice(slashMatch[0].length);
    }

    var timeMatch = str.match(/(\d+)(?::(\d+))?\s*(am|pm)?/);
    if (!timeMatch) return null;
    var h = parseInt(timeMatch[1]);
    var m = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    var ampm = timeMatch[3];
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;

    return new Date(year, month, day, h, m);
  };

  R.fmtCompact = function (d) {
    var h = d.getHours(), m = d.getMinutes();
    var time = (h%12||12) + (m ? ':' + (m<10?'0':'') + m : '') + (h>=12?'pm':'am');
    var today = new Date();
    if (d.toDateString() === today.toDateString()) return time;
    return R.MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + time;
  };

  R.fmtDragTime = function (d) {
    var h = d.getHours(), m = d.getMinutes();
    var time = (h%12||12) + ':' + (m<10?'0':'') + m + (h>=12?'pm':'am');
    if (R.horizonHours >= 720) {
      return R.MONTHS[d.getMonth()] + ' ' + d.getDate();
    } else if (R.horizonHours >= 96) {
      return R.DAYS[d.getDay()] + ' ' + (d.getMonth()+1) + '/' + d.getDate() + ' ' + time;
    }
    return time;
  };

  R.toLocalISO = function (d) {
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' +
      String(d.getDate()).padStart(2,'0') + 'T' +
      String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  };

  R.applyDuration = function (parsed) {
    if (!parsed || !R.selectedId) return;
    if (R.selectedIds.length > 1 && R._panelAvgMass) {
      var delta = parsed - R._panelAvgMass;
      for (var i = 0; i < R.selectedIds.length; i++) {
        var a = R.findTask(R.selectedIds[i]);
        if (!a) continue;
        var s = R._panelStarts[R.selectedIds[i]];
        var newMass = Math.max(5, (s ? s.mass : a.mass) + delta);
        var changes = { mass: newMass };
        if (a.position !== null && a.position !== undefined) {
          changes.position = a.position + (newMass - a.mass) / 120;
        }
        R.save(R.selectedIds[i], changes);
      }
    } else {
      var a = R.findTask(R.selectedId);
      if (!a) return;
      var changes = { mass: parsed };
      if (a.position !== null && a.position !== undefined) {
        var massDiffH = (parsed - a.mass) / 60;
        changes.position = a.position + massDiffH / 2;
      }
      R.save(R.selectedId, changes);
    }
    panelDurInput.value = R.formatDuration(parsed);
    R.renderPresetButtons(parsed);
  };

  // ── Panel Show / Hide / Position ───────────────────────────────────

  R.showPanel = function (a, sx, sy) {
    R.selectedId = a.id;
    var isMulti = R.selectedIds.length > 1;

    // Store starting values for additive multi-select edits
    R._panelStarts = {};
    for (var pi = 0; pi < R.selectedIds.length; pi++) {
      var pt = R.findTask(R.selectedIds[pi]);
      if (pt) R._panelStarts[pt.id] = { sol: pt.solidity, energy: pt.energy != null ? pt.energy : 0.5, mass: pt.mass };
    }

    if (isMulti) {
      panelName.value = R.selectedIds.length + ' tasks';
      panelName.readOnly = true;

      var totalMass = 0, totalSol = 0, totalNrg = 0;
      for (var i = 0; i < R.selectedIds.length; i++) {
        var t = R.findTask(R.selectedIds[i]);
        if (t) {
          totalMass += t.mass;
          totalSol += t.solidity;
          totalNrg += (t.energy != null ? t.energy : 0.5);
        }
      }
      var n = R.selectedIds.length;
      R._panelAvgSol = totalSol / n;
      R._panelAvgNrg = totalNrg / n;
      R._panelAvgMass = Math.round(totalMass / n);
      panelDurInput.value = R.formatDuration(R._panelAvgMass);
      R.renderPresetButtons(R._panelAvgMass);
      panelSolidity.value = Math.round(R._panelAvgSol * 100);
      var panelEnergy = document.getElementById('panel-energy');
      panelEnergy.value = Math.round((totalNrg / n) * 100);

      var allFixed = true, allCloud = true;
      for (var j = 0; j < R.selectedIds.length; j++) {
        var t2 = R.findTask(R.selectedIds[j]);
        if (t2) {
          if (t2.fixed) allCloud = false;
          if (!t2.fixed) allFixed = false;
        }
      }
      panelBackToCloud.checked = allCloud;
      panelTimes.style.display = 'none';
    } else {
      panelName.value = a.name;
      panelName.readOnly = false;
      panelDurInput.value = R.formatDuration(a.mass);
      R.renderPresetButtons(a.mass);
      panelSolidity.value = Math.round(a.solidity * 100);
      var panelEnergy = document.getElementById('panel-energy');
      panelEnergy.value = Math.round((a.energy != null ? a.energy : 0.5) * 100);
      panelBackToCloud.checked = !a.fixed;

      if (a.position !== null && a.position !== undefined && R.state) {
        var now = new Date(R.state.now);
        var centerMs = now.getTime() + a.position * 3600000;
        var halfDurMs = a.mass * 30000;
        panelStart.value = R.fmtCompact(new Date(centerMs - halfDurMs));
        panelEnd.value = R.fmtCompact(new Date(centerMs + halfDurMs));
        panelTimes.style.display = '';
      } else {
        panelTimes.style.display = 'none';
      }
    }

    if (R.rebuildPanelTags) R.rebuildPanelTags();

    panel.classList.remove('hidden');
    R.positionPanel(a);
  };

  R.positionPanel = function (a) {
    if (!a) return;
    var pw = 200, ph = panel.offsetHeight || 220;
    var d = R.taskStretch(a);
    var screenX = (a.position !== null && a.position !== undefined)
      ? a.x - R.scrollHours * R.PIXELS_PER_HOUR
      : a.x;
    var grabHH = Math.max(R.MIN_HIT, d.hh);

    // Position ABOVE or BELOW the task — never overlapping it
    var px = screenX - pw / 2; // centered horizontally on the task
    var py;
    var gapAbove = a.y - grabHH; // space above task
    var gapBelow = R.H - (a.y + grabHH); // space below task

    if (gapBelow >= ph + 12) {
      // Below the task
      py = a.y + grabHH + 8;
    } else if (gapAbove >= ph + 12) {
      // Above the task
      py = a.y - grabHH - ph - 8;
    } else {
      // Not enough space above or below — put to the right
      var grabHW = Math.max(R.MIN_HIT, d.hw);
      px = screenX + grabHW + 12;
      py = a.y - ph / 2;
      if (px + pw > R.W - 10) px = screenX - grabHW - pw - 12;
    }

    // Clamp to viewport
    px = Math.max(10, Math.min(px, R.W - pw - 10));
    py = Math.max(10, Math.min(py, R.H - ph - 10));

    panel.style.left = px + 'px';
    panel.style.top = py + 'px';
  };

  R.hidePanel = function () { panel.classList.add('hidden'); R.selectedId = null; R.selectedIds = []; };

  // ── Panel Events ───────────────────────────────────────────────────

  var nameTimer = null;
  panelName.addEventListener('input', function () {
    if (!R.selectedId || panelName.readOnly) return;
    clearTimeout(nameTimer);
    nameTimer = setTimeout(function () {
      R.save(R.selectedId, { name: panelName.value });
    }, 300);
  });

  panelDurInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      R.applyDuration(R.parseDuration(panelDurInput.value));
      panelDurInput.blur();
    }
  });
  panelDurInput.addEventListener('blur', function () {
    R.applyDuration(R.parseDuration(panelDurInput.value));
  });

  panelSolidity.addEventListener('input', function () {
    if (!R.selectedId) return;
    var val = Number(panelSolidity.value) / 100;
    if (R.selectedIds.length > 1 && R._panelAvgSol !== undefined) {
      var delta = val - R._panelAvgSol;
      for (var i = 0; i < R.selectedIds.length; i++) {
        var s = R._panelStarts[R.selectedIds[i]];
        var newVal = s ? Math.max(0, Math.min(1, s.sol + delta)) : val;
        R.save(R.selectedIds[i], { solidity: newVal });
      }
    } else {
      R.save(R.selectedId, { solidity: val });
    }
  });

  startIcon.addEventListener('click', function() {
    var parsed = R.parseCompactTime(panelStart.value);
    if (parsed) startPicker.value = R.toLocalISO(parsed);
    startPicker.showPicker();
  });
  endIcon.addEventListener('click', function() {
    var parsed = R.parseCompactTime(panelEnd.value);
    if (parsed) endPicker.value = R.toLocalISO(parsed);
    endPicker.showPicker();
  });

  startPicker.addEventListener('change', function() {
    var d = new Date(startPicker.value);
    panelStart.value = R.fmtCompact(d);
    panelStart.dispatchEvent(new Event('blur'));
  });
  endPicker.addEventListener('change', function() {
    var d = new Date(endPicker.value);
    panelEnd.value = R.fmtCompact(d);
    panelEnd.dispatchEvent(new Event('blur'));
  });

  // Start changed: keep duration, move task
  panelStart.addEventListener('keydown', function(e) { if (e.key === 'Enter') { panelStart.blur(); } });
  panelStart.addEventListener('blur', function () {
    if (!R.selectedId || !R.state) return;
    var a = R.findTask(R.selectedId);
    if (!a) return;
    var parsed = R.parseCompactTime(panelStart.value);
    if (!parsed) return;
    var nowMs = new Date(R.state.now).getTime();
    var newCenterH = (parsed.getTime() - nowMs) / 3600000 + a.mass / 120;
    R.save(R.selectedId, { position: newCenterH });
    panelStart.value = R.fmtCompact(parsed);
    panelEnd.value = R.fmtCompact(new Date(parsed.getTime() + a.mass * 60000));
  });

  // End changed: keep start, change duration
  panelEnd.addEventListener('keydown', function(e) { if (e.key === 'Enter') { panelEnd.blur(); } });
  panelEnd.addEventListener('blur', function () {
    if (!R.selectedId || !R.state) return;
    var a = R.findTask(R.selectedId);
    if (!a) return;
    var startParsed = R.parseCompactTime(panelStart.value);
    var endParsed = R.parseCompactTime(panelEnd.value);
    if (!startParsed || !endParsed) return;
    var newMass = Math.max(5, Math.round((endParsed.getTime() - startParsed.getTime()) / 60000));
    var nowMs = new Date(R.state.now).getTime();
    var newCenterH = (startParsed.getTime() - nowMs) / 3600000 + newMass / 120;
    R.save(R.selectedId, { mass: newMass, position: newCenterH });
    panelDurInput.value = R.formatDuration(newMass);
    panelEnd.value = R.fmtCompact(endParsed);
    R.renderPresetButtons(newMass);
  });

  document.getElementById('panel-energy').addEventListener('input', function () {
    if (!R.selectedId) return;
    var val = Number(this.value) / 100;
    if (R.selectedIds.length > 1 && R._panelAvgNrg !== undefined) {
      var delta = val - R._panelAvgNrg;
      for (var i = 0; i < R.selectedIds.length; i++) {
        var s = R._panelStarts[R.selectedIds[i]];
        var newVal = s ? Math.max(0, Math.min(1, s.energy + delta)) : val;
        R.save(R.selectedIds[i], { energy: newVal });
      }
    } else {
      R.save(R.selectedId, { energy: val });
    }
  });
  panelBackToCloud.addEventListener('change', function () {
    if (!R.selectedId) return;
    var fixed = !panelBackToCloud.checked;
    for (var i = 0; i < R.selectedIds.length; i++) {
      R.save(R.selectedIds[i], { fixed: fixed });
    }
  });
  panelDissolve.addEventListener('click', function () {
    if (!R.selectedId) return;
    for (var i = 0; i < R.selectedIds.length; i++) {
      R.deleteTask(R.selectedIds[i]);
    }
    R.hidePanel();
  });

  document.getElementById('panel-copy').addEventListener('click', function () {
    if (!R.selectedId) return;
    for (var i = 0; i < R.selectedIds.length; i++) {
      var a = R.findTask(R.selectedIds[i]);
      if (!a) continue;
      if (a.ctx && a.ctx.type === 'lane') {
        // Copy within the same lane
        var copyLane = a.ctx.lane;
        var copyName = a.name;
        var copyPos = a.position != null ? a.position + a.mass / 120 : null;
        R.post('plan_lane_put', {
          lane: copyLane, name: copyName, position: copyPos
        }, function (tasks) {
          var bounds = R.planLaneBounds ? R.planLaneBounds(copyLane) : { midY: R.H * 0.6 };
          var tx = R.hoursToX ? R.hoursToX(copyPos || 0) : R.W * 0.5;
          tasks.push({
            id: '_temp_' + Date.now(), name: copyName, mass: 30, solidity: 0.3, energy: 0.5,
            fixed: false, alive: false, tags: [], position: copyPos, anchor: null,
            ctx: { type: 'lane', lane: copyLane }, _dirtyUntil: Date.now() + 5000,
            x: tx, y: bounds.midY || R.H * 0.6, tx: tx, ty: bounds.midY || R.H * 0.6, vx: 0, vy: 0
          });
        });
      } else {
        var copyData = {
          name: a.name, mass: a.mass, solidity: a.solidity, energy: a.energy, tags: a.tags
        };
        R.post('put', copyData, function (tasks) {
          var pos = R.cloudPos ? R.cloudPos({ name: copyData.name, mass: copyData.mass }) : { x: R.W * 0.5, y: R.H * 0.15 };
          tasks.push({
            id: '_temp_' + Date.now(), name: copyData.name, mass: copyData.mass,
            solidity: copyData.solidity, energy: copyData.energy,
            fixed: false, alive: false, tags: copyData.tags || [], position: null, anchor: null,
            ctx: { type: 'main' }, _dirtyUntil: Date.now() + 5000,
            x: pos.x, y: pos.y, tx: pos.x, ty: pos.y, vx: 0, vy: 0
          });
        });
      }
    }
    R.hidePanel();
  });
})();

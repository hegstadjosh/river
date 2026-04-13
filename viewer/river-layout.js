// viewer/river-layout.js — spatial layout: positions, hit geometry, snap physics
(function () {
  'use strict';

  var R = window.River;

  R.surfaceY = function () { return R.H * R.SURFACE_RATIO; };
  R.cloudTopY = function () { return 40; };
  R.riverMidY = function () { return R.surfaceY() + (R.H - R.surfaceY()) * 0.45; };

  // Convert hours-from-now to screen X, accounting for scroll
  R.hoursToX = function (h) { return R.W * R.NOW_X + (h - R.scrollHours) * R.PIXELS_PER_HOUR; };
  // The now-line's screen position (moves when scrolling)
  R.nx = function () { return R.hoursToX(0); };

  // Deterministic scatter from ID
  R.hashFrac = function (id, seed) {
    var h = 5381;
    var s = id + (seed || '');
    for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return (h % 10000) / 10000;
  };

  R.cloudPos = function (task) {
    var top = R.cloudTopY();
    var bot = R.surfaceY() - 50;
    var cx = (task.cloud_x != null) ? task.cloud_x : R.hashFrac(task.id, 'cx');
    var cy = (task.cloud_y != null) ? task.cloud_y : R.hashFrac(task.id, 'cy');
    return {
      x: R.W * 0.15 + cx * R.W * 0.7,
      y: top + cy * (bot - top)
    };
  };

  R.riverPos = function (task) {
    var x = R.hoursToX(task.position || 0);
    var top = R.surfaceY() + 30;
    var bot = R.H - 50;
    var ry = (task.river_y != null) ? task.river_y : R.hashFrac(task.id, 'ry');
    var y = top + ry * (bot - top);
    return { x: x, y: y };
  };

  R.taskStretch = function (a) {
    var hw, hh;
    if (a.position !== null && a.position !== undefined) {
      var dpx = (a.mass / 60) * R.PIXELS_PER_HOUR;
      hw = Math.max(8, dpx / 2);
      hh = Math.min(hw, Math.max(14, hw * 0.6));
      hh = Math.min(hh, 60);
    } else {
      hw = 18; hh = 18;
    }
    if (a.alive) { hw *= 1.3; hh *= 1.3; }
    // Clamp to lane slot height (matches drawBlob exactly)
    if (a.ctx && a.ctx.type === 'lane') {
      var maxHH = a._laneSlotH ? (a._laneSlotH - 4) / 2
        : (R.planLaneBounds ? (R.planLaneBounds(a.ctx.lane).bottom - R.planLaneBounds(a.ctx.lane).top - 4) / 2 : hh);
      hh = Math.min(hh, maxHH);
    }
    return { r: Math.max(hw, hh), hw: hw, hh: hh };
  };

  R.taskEdges = function (a) {
    var d = R.taskStretch(a);
    return { left: a.x - d.hw, right: a.x + d.hw, top: a.y - d.hh, bottom: a.y + d.hh, hw: d.hw };
  };

  // Base radius — log-scaled so short tasks differ visibly,
  // but month-long tasks don't become vertically enormous
  R.blobR = function (mass) {
    if (mass <= 240) return Math.sqrt(mass) * R.BLOB_SCALE; // normal for <=4h
    return Math.sqrt(240) * R.BLOB_SCALE + Math.log2(mass / 240) * 8; // log taper above 4h
  };

  R.recalcScale = function () {
    // The visible future spans from the now-line to the right edge
    var futureWidth = R.W * (1 - R.NOW_X) - 30; // 30px margin
    R.PIXELS_PER_HOUR = futureWidth / R.horizonHours;
  };

  // Sticky snap — binary, not gradient.
  // Inside SNAP_ZONE: locked to the line. Task doesn't move.
  // Outside: completely free, uniform scale, no pull.
  R.snapX = function (screenX) {
    if (!R.state || R.snapTimesMs.length === 0) return screenX;
    var now = new Date(R.state.now);

    // Find nearest grid line
    var nearestX = screenX;
    var nearestDist = R.SNAP_ZONE + 1;
    for (var i = 0; i < R.snapTimesMs.length; i++) {
      var hrs = (R.snapTimesMs[i] - now.getTime()) / 3600000;
      var gx = R.hoursToX(hrs);
      var dist = Math.abs(screenX - gx);
      if (dist < nearestDist) { nearestDist = dist; nearestX = gx; }
    }

    // Binary: inside the zone = locked. Outside = free.
    return nearestDist <= R.SNAP_ZONE ? nearestX : screenX;
  };

  // Convert screen X to hours-from-now with snapping
  R.screenXToHours = function (sx) {
    var snapped = R.snapX(sx);
    return (snapped - R.W * R.NOW_X) / R.PIXELS_PER_HOUR + R.scrollHours;
  };
})();

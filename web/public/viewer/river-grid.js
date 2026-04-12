// viewer/river-grid.js — drawTimeMarkers with ALL boundary helpers, MONTHS/DAYS, formatTime
(function () {
  'use strict';

  var R = window.River;

  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  R.MONTHS = MONTHS;
  R.DAYS = DAYS;

  // ── Helper: find local-time boundaries in visible range ──

  function localMidnights(startMs, endMs) {
    var times = [];
    var d = new Date(startMs);
    d.setHours(0,0,0,0); // snap to local midnight
    if (d.getTime() < startMs) d.setDate(d.getDate() + 1);
    while (d.getTime() <= endMs) {
      times.push(d.getTime());
      d.setDate(d.getDate() + 1);
    }
    return times;
  }

  function localHourBoundaries(startMs, endMs, intervalH) {
    var times = [];
    var intervalMs = intervalH * 3600000;
    var d = new Date(startMs);
    d.setMinutes(0,0,0);
    // Snap to nearest interval boundary
    var hourMs = d.getTime();
    var dayStart = new Date(d); dayStart.setHours(0,0,0,0);
    var msSinceMidnight = hourMs - dayStart.getTime();
    var snapped = Math.floor(msSinceMidnight / intervalMs) * intervalMs;
    d = new Date(dayStart.getTime() + snapped);
    if (d.getTime() < startMs) d = new Date(d.getTime() + intervalMs);
    while (d.getTime() <= endMs) {
      times.push(d.getTime());
      d = new Date(d.getTime() + intervalMs);
    }
    return times;
  }

  function localMondays(startMs, endMs) {
    var times = [];
    var d = new Date(startMs);
    d.setHours(0,0,0,0);
    var dayOfWeek = d.getDay();
    var daysToMon = dayOfWeek === 0 ? 1 : (dayOfWeek === 1 ? 0 : 8 - dayOfWeek);
    d.setDate(d.getDate() + daysToMon);
    while (d.getTime() <= endMs) {
      if (d.getTime() >= startMs) times.push(d.getTime());
      d.setDate(d.getDate() + 7);
    }
    return times;
  }

  function localMonthStarts(startMs, endMs, step) {
    var times = [];
    var d = new Date(startMs);
    d.setDate(1); d.setHours(0,0,0,0);
    if (step > 1) d.setMonth(Math.floor(d.getMonth() / step) * step);
    while (d.getTime() <= endMs) {
      if (d.getTime() >= startMs) times.push(d.getTime());
      d.setMonth(d.getMonth() + step);
    }
    return times;
  }

  // ── Drawing: Time Grid ──────────────────────────────────────────────
  // Major lines snap to intuitive time boundaries.
  // Minor lines (half-height) fill in between.
  //
  // Frame    Major interval    Minor interval
  // 6h       1h                30min
  // day      6h                3h
  // 4d       1 day (midnight)  12h (noon)
  // week     1 day (midnight)  12h
  // month    Monday            1 day
  // quarter  1st of month      ~2 weeks
  // year     quarter start     1 month

  R.drawTimeMarkers = function () {
    if (!R.state) return;
    var ctx = R.ctx;
    var now = new Date(R.state.now);
    var sY = R.surfaceY();
    var riverH = R.H - sY;

    // Visible time range
    var viewLeftH = R.scrollHours - (R.W * R.NOW_X) / R.PIXELS_PER_HOUR;
    var viewRightH = viewLeftH + R.W / R.PIXELS_PER_HOUR;
    var viewLeftMs = now.getTime() + viewLeftH * 3600000;
    var viewRightMs = now.getTime() + viewRightH * 3600000;

    // ── Build major + minor lists based on frame ──
    var majorTimes, minorTimes, majorLabel, minorLabel;

    if (R.horizonHours <= 6) {
      majorTimes = localHourBoundaries(viewLeftMs, viewRightMs, 1);
      minorTimes = localHourBoundaries(viewLeftMs, viewRightMs, 0.5);
      majorLabel = function(d) { var h=d.getHours(); return (h%12||12) + (h>=12?'pm':'am'); };
      minorLabel = function(d) { var m=d.getMinutes(); return m ? ':' + (m<10?'0':'') + m : ''; };
    } else if (R.horizonHours <= 24) {
      majorTimes = localHourBoundaries(viewLeftMs, viewRightMs, 6);
      minorTimes = localHourBoundaries(viewLeftMs, viewRightMs, 3);
      majorLabel = function(d) { var h=d.getHours(); return (h%12||12) + (h>=12?'pm':'am'); };
      minorLabel = function(d) { var h=d.getHours(); return (h%12||12) + (h>=12?'pm':'am'); };
    } else if (R.horizonHours <= 96) {
      majorTimes = localMidnights(viewLeftMs, viewRightMs);
      minorTimes = localHourBoundaries(viewLeftMs, viewRightMs, 12);
      majorLabel = function(d) { return DAYS[d.getDay()] + ' ' + (d.getMonth()+1) + '/' + d.getDate(); };
      minorLabel = function(d) { return d.getHours() === 12 ? 'noon' : ''; };
    } else if (R.horizonHours <= 168) {
      majorTimes = localMidnights(viewLeftMs, viewRightMs);
      minorTimes = []; // no half-lines in week view
      majorLabel = function(d) { return DAYS[d.getDay()] + ' ' + d.getDate(); };
      minorLabel = null;
    } else if (R.horizonHours <= 720) {
      majorTimes = localMondays(viewLeftMs, viewRightMs);
      minorTimes = localMidnights(viewLeftMs, viewRightMs);
      majorLabel = function(d) { return MONTHS[d.getMonth()] + ' ' + d.getDate(); };
      minorLabel = function(d) { return d.getDate(); };
    } else if (R.horizonHours <= 2160) {
      majorTimes = localMonthStarts(viewLeftMs, viewRightMs, 1);
      minorTimes = localMondays(viewLeftMs, viewRightMs);
      majorLabel = function(d) { return MONTHS[d.getMonth()]; };
      minorLabel = function(d) { return d.getDate(); };
    } else {
      majorTimes = localMonthStarts(viewLeftMs, viewRightMs, 3);
      minorTimes = localMonthStarts(viewLeftMs, viewRightMs, 1);
      majorLabel = function(d) { return MONTHS[d.getMonth()] + ' \u2019' + (d.getFullYear()%100); };
      minorLabel = function(d) { return MONTHS[d.getMonth()].slice(0,3); };
    }

    // Filter minors that overlap with majors
    var majorSet = {};
    for (var mi = 0; mi < majorTimes.length; mi++) majorSet[majorTimes[mi]] = true;
    minorTimes = minorTimes.filter(function(t) {
      for (var k in majorSet) { if (Math.abs(t - Number(k)) < 1800000) return false; }
      return true;
    });

    // ── Draw major lines — full river height ──
    ctx.font = '500 12px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (var i = 0; i < majorTimes.length; i++) {
      var hrs = (majorTimes[i] - now.getTime()) / 3600000;
      var x = R.hoursToX(hrs);
      if (x < 5 || x > R.W - 5) continue;

      ctx.beginPath();
      ctx.moveTo(x, sY + 10);
      ctx.lineTo(x, R.H);
      ctx.strokeStyle = 'rgba(200, 165, 110, 0.1)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = 'rgba(200, 165, 110, 0.4)';
      ctx.fillText(majorLabel(new Date(majorTimes[i])), x, R.H - 14);
    }

    // ── Draw minor lines — 20% river height from bottom, lighter ──
    if (minorTimes.length > 0 && minorLabel) {
      var minorH = riverH * 0.2;
      ctx.font = '400 10px -apple-system, system-ui, sans-serif';
      for (var j = 0; j < minorTimes.length; j++) {
        var hrs2 = (minorTimes[j] - now.getTime()) / 3600000;
        var x2 = R.hoursToX(hrs2);
        if (x2 < 5 || x2 > R.W - 5) continue;

        ctx.beginPath();
        ctx.moveTo(x2, R.H - minorH);
        ctx.lineTo(x2, R.H);
        ctx.strokeStyle = 'rgba(200, 165, 110, 0.06)';
        ctx.lineWidth = 1;
        ctx.stroke();

        var ml = minorLabel(new Date(minorTimes[j]));
        if (ml) {
          ctx.fillStyle = 'rgba(200, 165, 110, 0.2)';
          ctx.fillText(ml, x2, R.H - 8);
        }
      }
    }

    // Snap targets = visible lines + sub-grid for finer snapping
    R.snapTimesMs = majorTimes.concat(minorTimes);

    // Snap only to visible lines. No invisible sub-grid.
  };

  R.formatTime = function (d) {
    var h = d.getHours();
    return (h % 12 || 12) + (h >= 12 ? 'pm' : 'am');
  };
})();

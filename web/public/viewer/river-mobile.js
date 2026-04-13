// river-mobile.js — vertical river layout for mobile viewports
// Loaded AFTER all other viewer files. Overrides layout/render functions
// when viewport width < 768px.
//
// LAYOUT (bottom to top of screen):
//   Bottom:  Cloud (thumb zone) — unscheduled wisps
//   Above:   Timeframe bar (horizon selector)
//   Above:   Now-line — horizontal amber band, ~20% from bottom
//   Above:   Past fades between now-line and surface
//   Top:     River/Future — tasks emerge from top, drift DOWN toward now
//
// Time flows DOWNWARD. Future at top, past below now-line.
(function () {
  'use strict';

  var R = window.River;

  // ── Mobile Detection ───────────────────────────────────────────────
  R.isMobile = false;

  R.checkMobile = function () {
    R.isMobile = R.W < 768;
  };

  // Store original functions before overriding
  var _origSurfaceY = R.surfaceY;
  var _origCloudPos = R.cloudPos;
  var _origRiverPos = R.riverPos;
  var _origHoursToX = R.hoursToX;
  var _origNx = R.nx;
  var _origRecalcScale = R.recalcScale;
  var _origDrawWorld = R.drawWorld;
  var _origDrawStreaks = R.drawStreaks;
  var _origDrawNowLine = R.drawNowLine;
  var _origDrawPastFade = R.drawPastFade;
  var _origDrawTimeMarkers = R.drawTimeMarkers;
  var _origInitStreaks = R.initStreaks;
  var _origTaskStretch = R.taskStretch;
  var _origCloudTopY = R.cloudTopY;

  // ── Mobile Constants ───────────────────────────────────────────────
  var CLOUD_HEIGHT_RATIO = 0.28; // cloud is bottom 28%
  var HORIZON_BAR_H = 36;       // height reserved for timeframe bar

  // ── Mobile Layout ──────────────────────────────────────────────────

  // Surface Y = boundary between river (above) and cloud (below)
  // Located at 85% from top — cloud fills from here to bottom
  function mSurfaceY() { return R.H * (1 - CLOUD_HEIGHT_RATIO); }

  // Now-line sits ~20% from bottom of screen, above the cloud
  function mNowY() {
    var sY = mSurfaceY();
    return sY - HORIZON_BAR_H - 30; // just above the timeframe bar
  }

  // Cloud zone: full width, BOTTOM strip (thumb-reachable)
  // CLAMPED: cloud tasks must stay below surfaceY
  function mCloudPos(task) {
    var top = mSurfaceY() + HORIZON_BAR_H + 10; // below the timeframe bar
    var bot = R.H - 20;
    var cx = Math.max(0, Math.min(1, (task.cloud_x != null) ? task.cloud_x : R.hashFrac(task.id, 'cx')));
    var cy = Math.max(0, Math.min(1, (task.cloud_y != null) ? task.cloud_y : R.hashFrac(task.id, 'cy')));
    return {
      x: R.W * 0.1 + cx * R.W * 0.8,
      y: top + cy * (bot - top)
    };
  }

  function mCloudTopY() { return mSurfaceY() + HORIZON_BAR_H + 10; }

  // Convert screen Y to hours-from-now (inverse of mHoursToY)
  function mScreenYToHours(screenY) {
    var ny = mNowY();
    return R.scrollHours + (ny - screenY) / R.PIXELS_PER_HOUR;
  }

  // Convert hours-from-now to screen Y
  // Future (positive h) → UP (smaller Y, toward top of screen)
  // Past (negative h) → DOWN (larger Y, toward now-line and below)
  function mHoursToY(h) {
    var ny = mNowY();
    return ny - (h - R.scrollHours) * R.PIXELS_PER_HOUR;
  }

  // Stub: hoursToX returns center for river tasks (they scatter horizontally via hash)
  function mHoursToX() { return R.W * 0.5; }

  // River task position: Y from time, X from hash scatter
  // CLAMPED: river tasks must stay above surfaceY (never in cloud zone)
  function mRiverPos(task) {
    var y = mHoursToY(task.position || 0);
    y = Math.max(20, Math.min(y, mSurfaceY() - 10));
    var left = 20;
    var right = R.W - 20;
    var rx = (task.river_y != null) ? task.river_y : R.hashFrac(task.id, 'ry');
    var x = left + rx * (right - left);
    return { x: x, y: y };
  }

  function mRecalcScale() {
    // Future spans from now-line UP to the top of screen
    var futureHeight = mNowY() - 40; // 40px top margin for tag bar
    R.PIXELS_PER_HOUR = Math.max(1, futureHeight / R.horizonHours);
  }

  // Task dimensions: on mobile, height = duration (vertical), width adapts
  function mTaskStretch(a) {
    var hw, hh;
    if (a.position !== null && a.position !== undefined) {
      var durationPx = (a.mass / 60) * R.PIXELS_PER_HOUR;
      hh = Math.max(8, durationPx / 2);
      hw = Math.min(hh, Math.max(14, hh * 0.6));
      hw = Math.min(hw, 50);
    } else {
      hw = 16; hh = 16;
    }
    if (a.alive) { hw *= 1.3; hh *= 1.3; }
    return { r: Math.max(hw, hh), hw: hw, hh: hh };
  }

  // ── Mobile Rendering ───────────────────────────────────────────────

  function mDrawWorld() {
    var ctx = R.ctx;
    var sY = mSurfaceY();

    // River zone — warm water at TOP (0 to surfaceY)
    var waterGrad = ctx.createLinearGradient(0, 0, 0, sY);
    waterGrad.addColorStop(0, R.WATER_DEEP);
    waterGrad.addColorStop(1, R.WATER_TOP);
    ctx.fillStyle = waterGrad;
    ctx.fillRect(0, 0, R.W, sY);

    // Cloud zone — cool dark sky at BOTTOM (surfaceY to H)
    ctx.fillStyle = R.SKY_COLOR;
    ctx.fillRect(0, sY, R.W, R.H - sY);

    // Surface glow — horizontal band at the boundary
    var surfGrad = ctx.createLinearGradient(0, sY - 15, 0, sY + 15);
    surfGrad.addColorStop(0, 'rgba(200, 165, 110, 0)');
    surfGrad.addColorStop(0.3, 'rgba(200, 165, 110, 0.04)');
    surfGrad.addColorStop(0.5, 'rgba(200, 165, 110, 0.07)');
    surfGrad.addColorStop(0.7, 'rgba(200, 165, 110, 0.04)');
    surfGrad.addColorStop(1, 'rgba(200, 165, 110, 0)');
    ctx.fillStyle = surfGrad;
    ctx.fillRect(0, sY - 15, R.W, 30);

    // Breathing room: warm wash over the river
    ctx.fillStyle = 'rgba(200, 165, 110, 0.008)';
    ctx.fillRect(0, 0, R.W, sY);
  }

  function mInitStreaks() {
    R.streaks = [];
    var sY = mSurfaceY();
    for (var i = 0; i < R.NUM_STREAKS; i++) {
      R.streaks.push({
        x: 0,
        y: 20 + Math.random() * (sY - 40), // within river zone (0 to sY)
        len: 30 + Math.random() * (R.W * 0.6),
        speed: 6 + Math.random() * 18,
        alpha: 0.015 + Math.random() * 0.04,
        xOff: Math.random() * R.W * 0.4
      });
    }
  }

  function mDrawStreaks(dt) {
    var ctx = R.ctx;
    var sY = mSurfaceY();
    for (var i = 0; i < R.streaks.length; i++) {
      var s = R.streaks[i];
      // Streaks drift downward (time flows down)
      s.y += s.speed * dt;
      if (s.y > sY - 10) {
        s.y = 10; // recycle to top of river
        s.len = 30 + Math.random() * (R.W * 0.6);
        s.xOff = Math.random() * R.W * 0.3;
      }

      var fadeT = Math.min(1, s.y / 80);
      var fadeB = Math.min(1, (sY - s.y) / 80);
      var fade = fadeT * fadeB;

      var x1 = s.xOff;
      var x2 = s.xOff + s.len;

      ctx.beginPath();
      ctx.moveTo(x1, s.y);
      ctx.lineTo(Math.min(R.W, x2), s.y);
      ctx.strokeStyle = 'rgba(' + R.AMBER[0] + ',' + R.AMBER[1] + ',' + R.AMBER[2] + ',' + (s.alpha * fade).toFixed(4) + ')';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function mDrawNowLine(t) {
    var ctx = R.ctx;
    var y = mHoursToY(0); // moves with scroll
    if (y < -40 || y > mSurfaceY() + 40) return;

    var breath = Math.sin(t / 4000 * Math.PI * 2) * 0.5 + 0.5;

    // Glow — horizontal band
    var glowH = 15 + breath * 10;
    var glowGrad = ctx.createLinearGradient(0, y - glowH, 0, y + glowH);
    glowGrad.addColorStop(0, 'rgba(200, 165, 110, 0)');
    glowGrad.addColorStop(0.5, 'rgba(200, 165, 110, ' + (0.04 + breath * 0.04) + ')');
    glowGrad.addColorStop(1, 'rgba(200, 165, 110, 0)');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, y - glowH, R.W, glowH * 2);

    // Horizontal now line — edge to edge
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(R.W, y);
    ctx.strokeStyle = 'rgba(200, 165, 110, ' + (0.3 + breath * 0.15) + ')';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // "now" label — left edge
    ctx.fillStyle = 'rgba(200, 165, 110, ' + (0.3 + breath * 0.15) + ')';
    ctx.font = '500 11px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('now', 8, y - 6);
  }

  function mDrawPastFade() {
    var ctx = R.ctx;
    var sY = mSurfaceY();
    var ny = mNowY();
    var fadeH = (sY - ny) * 0.4;

    // Fade between now-line and surface — past dissolves toward cloud
    var fg = ctx.createLinearGradient(0, sY, 0, sY - fadeH);
    fg.addColorStop(0, R.WATER_TOP);
    fg.addColorStop(1, 'rgba(35, 30, 25, 0)');
    ctx.fillStyle = fg;
    ctx.fillRect(0, sY - fadeH, R.W, fadeH);
  }

  function mDrawTimeMarkers() {
    if (!R.state) return;
    var ctx = R.ctx;
    var now = new Date(R.state.now);
    var sY = mSurfaceY();
    var ny = mNowY();

    // Visible time range: top of screen = most future, now-line = h=0
    var viewTopH = R.scrollHours + (ny - 30) / R.PIXELS_PER_HOUR;
    var viewBotH = R.scrollHours - (sY - ny) / R.PIXELS_PER_HOUR;
    // Ensure top > bot (top is more future)
    var minH = Math.min(viewTopH, viewBotH);
    var maxH = Math.max(viewTopH, viewBotH);
    var viewMinMs = now.getTime() + minH * 3600000;
    var viewMaxMs = now.getTime() + maxH * 3600000;

    var majorTimes, majorLabel;

    if (R.horizonHours <= 6) {
      majorTimes = [];
      var d1 = new Date(viewMinMs); d1.setMinutes(0, 0, 0);
      while (d1.getTime() <= viewMaxMs) { majorTimes.push(d1.getTime()); d1 = new Date(d1.getTime() + 3600000); }
      majorLabel = function (d) { var h = d.getHours(); return (h % 12 || 12) + (h >= 12 ? 'pm' : 'am'); };
    } else if (R.horizonHours <= 24) {
      majorTimes = [];
      var step = 3 * 3600000;
      var d2 = new Date(viewMinMs); d2.setMinutes(0, 0, 0);
      d2 = new Date(Math.floor(d2.getTime() / step) * step);
      while (d2.getTime() <= viewMaxMs) { majorTimes.push(d2.getTime()); d2 = new Date(d2.getTime() + step); }
      majorLabel = function (d) { var h = d.getHours(); return (h % 12 || 12) + (h >= 12 ? 'pm' : 'am'); };
    } else {
      majorTimes = [];
      var d3 = new Date(viewMinMs); d3.setHours(0, 0, 0, 0);
      if (d3.getTime() < viewMinMs) d3.setDate(d3.getDate() + 1);
      while (d3.getTime() <= viewMaxMs) { majorTimes.push(d3.getTime()); d3.setDate(d3.getDate() + 1); }
      majorLabel = function (d) { return R.DAYS[d.getDay()] + ' ' + d.getDate(); };
    }

    // Draw horizontal time markers
    ctx.font = '500 10px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'right';
    for (var i = 0; i < majorTimes.length; i++) {
      var hrs = (majorTimes[i] - now.getTime()) / 3600000;
      var y = mHoursToY(hrs);
      if (y < 30 || y > sY - 10) continue;

      ctx.beginPath();
      ctx.moveTo(20, y);
      ctx.lineTo(R.W - 20, y);
      ctx.strokeStyle = 'rgba(200, 165, 110, 0.08)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = 'rgba(200, 165, 110, 0.3)';
      ctx.fillText(majorLabel(new Date(majorTimes[i])), R.W - 8, y - 4);
    }

    R.snapTimesMs = majorTimes;
  }

  // ── Apply / Remove Mobile Overrides ────────────────────────────────

  R.applyMobile = function () {
    R.surfaceY = mSurfaceY;
    R.cloudPos = mCloudPos;
    R.riverPos = mRiverPos;
    R.hoursToX = mHoursToX;
    R.hoursToY = mHoursToY;
    R.cloudTopY = mCloudTopY;
    R.screenYToHours = mScreenYToHours;
    R.snapY = function (screenY) {
      if (!R.state || !R.snapTimesMs || R.snapTimesMs.length === 0) return screenY;
      var now = new Date(R.state.now);
      var nearestY = screenY;
      var nearestDist = R.SNAP_ZONE + 1;
      for (var i = 0; i < R.snapTimesMs.length; i++) {
        var hrs = (R.snapTimesMs[i] - now.getTime()) / 3600000;
        var gy = mHoursToY(hrs);
        var dist = Math.abs(screenY - gy);
        if (dist < nearestDist) { nearestDist = dist; nearestY = gy; }
      }
      return nearestDist <= R.SNAP_ZONE ? nearestY : screenY;
    };
    R.nx = function () { return R.W * 0.5; };
    R.recalcScale = mRecalcScale;
    R.taskStretch = mTaskStretch;
    R.drawWorld = mDrawWorld;
    R.initStreaks = mInitStreaks;
    R.drawStreaks = mDrawStreaks;
    R.drawNowLine = mDrawNowLine;
    R.drawPastFade = mDrawPastFade;
    R.drawTimeMarkers = mDrawTimeMarkers;

    // Kill plan mode on mobile — force off, hide button
    R.planMode = false;
    R.planLanes = [];
    R.planWindowStart = null;
    R.planWindowEnd = null;
    var planBtn = document.getElementById('plan-btn');
    if (planBtn) planBtn.style.display = 'none';

    // Reposition horizon bar to sit at the surface line (between river and cloud)
    var horizonBar = document.getElementById('horizon-bar');
    if (horizonBar) {
      horizonBar.style.top = mSurfaceY() + 'px';
      horizonBar.style.transform = 'translateX(-50%) translateY(-50%)';
    }

    R.recalcScale();
    R.initStreaks();
  };

  R.removeMobile = function () {
    R.surfaceY = _origSurfaceY;
    R.cloudPos = _origCloudPos;
    R.riverPos = _origRiverPos;
    R.hoursToX = _origHoursToX;
    delete R.hoursToY;
    delete R.screenYToHours;
    delete R.snapY;
    R.cloudTopY = _origCloudTopY;
    R.nx = _origNx;
    R.recalcScale = _origRecalcScale;
    R.taskStretch = _origTaskStretch;
    R.drawWorld = _origDrawWorld;
    R.initStreaks = _origInitStreaks;
    R.drawStreaks = _origDrawStreaks;
    R.drawNowLine = _origDrawNowLine;
    R.drawPastFade = _origDrawPastFade;
    R.drawTimeMarkers = _origDrawTimeMarkers;

    var planBtn = document.getElementById('plan-btn');
    if (planBtn) planBtn.style.display = '';
    var horizonBar = document.getElementById('horizon-bar');
    if (horizonBar) {
      horizonBar.style.top = '';
      horizonBar.style.transform = '';
    }

    R.recalcScale();
    R.initStreaks();
  };

  // ── Hook into resize ───────────────────────────────────────────────
  var _origResize = R.resize;
  R.resize = function () {
    _origResize.call(R);
    var wasMobile = R.isMobile;
    R.checkMobile();
    if (R.isMobile && !wasMobile) R.applyMobile();
    else if (!R.isMobile && wasMobile) R.removeMobile();
    // Update horizon bar position on every resize in mobile mode
    if (R.isMobile) {
      var horizonBar = document.getElementById('horizon-bar');
      if (horizonBar) {
        horizonBar.style.top = mSurfaceY() + 'px';
      }
    }
  };

  // ── Touch Events ───────────────────────────────────────────────────

  var touchStart = null;
  var touchScrolling = false;
  var lastTapTime = 0;
  var lastTapX = 0;
  var lastTapY = 0;

  if (R.canvas) {
    R.canvas.addEventListener('touchstart', function (e) {
      if (!R.isMobile) return;
      var t = e.touches[0];
      touchStart = { x: t.clientX, y: t.clientY, time: Date.now(), scrollH: R.scrollHours };
      touchScrolling = false;
    }, { passive: true });

    R.canvas.addEventListener('touchmove', function (e) {
      if (!R.isMobile || !touchStart) return;
      e.preventDefault();
      var t = e.touches[0];
      var dy = t.clientY - touchStart.y;
      var dx = t.clientX - touchStart.x;

      if (!touchScrolling && (Math.abs(dy) > R.DRAG_THRESHOLD || Math.abs(dx) > R.DRAG_THRESHOLD)) {
        touchScrolling = true;
        R.dragging = null;
      }

      if (touchScrolling) {
        // Drag DOWN → scroll toward future (future is up, so adding hours reveals more future at top)
        var hoursPerPx = 1 / R.PIXELS_PER_HOUR;
        R.scrollHours = touchStart.scrollH + dy * hoursPerPx;
        R.sync();
      } else {
        var me = new MouseEvent('mousemove', { clientX: t.clientX, clientY: t.clientY });
        R.canvas.dispatchEvent(me);
      }
    }, { passive: false });

    R.canvas.addEventListener('touchend', function (e) {
      if (!R.isMobile) return;
      var endX = e.changedTouches[0].clientX;
      var endY = e.changedTouches[0].clientY;

      if (touchScrolling) {
        R.dragging = null;
        touchScrolling = false;
        touchStart = null;
        return;
      }

      // Detect double-tap (< 300ms, < 30px apart)
      var now = Date.now();
      if (now - lastTapTime < 300 && Math.abs(endX - lastTapX) < 30 && Math.abs(endY - lastTapY) < 30) {
        var dbl = new MouseEvent('dblclick', { clientX: endX, clientY: endY });
        R.canvas.dispatchEvent(dbl);
        lastTapTime = 0;
      } else {
        // Single tap
        var down = new MouseEvent('mousedown', { clientX: endX, clientY: endY });
        R.canvas.dispatchEvent(down);
        var up = new MouseEvent('mouseup', { clientX: endX, clientY: endY });
        R.canvas.dispatchEvent(up);
        lastTapTime = now;
        lastTapX = endX;
        lastTapY = endY;
      }

      touchStart = null;
    }, { passive: false });
  }

  // ── Initial Check ──────────────────────────────────────────────────
  setTimeout(function () {
    if (R.W > 0) {
      R.checkMobile();
      if (R.isMobile) R.applyMobile();
    }
  }, 100);

})();

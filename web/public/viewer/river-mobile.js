// river-mobile.js — vertical river layout for mobile viewports
// Loaded AFTER all other viewer files. Overrides layout/render functions
// when viewport width < 768px. Time flows top to bottom.
// Cloud is a horizontal strip at the top. River flows downward.
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

  // ── Mobile Constants ───────────────────────────────────────────────
  // Cloud is top 20% strip. River fills the rest.
  // Time flows top to bottom. NOW_Y at 25% from top of river zone.
  var CLOUD_HEIGHT_RATIO = 0.18;
  var NOW_Y_RATIO = 0.25; // now-line at 25% down the river zone

  // ── Mobile Layout ──────────────────────────────────────────────────

  // Surface Y = bottom of cloud strip (horizontal divider)
  function mSurfaceY() { return R.H * CLOUD_HEIGHT_RATIO; }

  // Cloud zone: full width, top strip
  function mCloudPos(task) {
    var top = 40;
    var bot = mSurfaceY() - 20;
    var cx = (task.cloud_x != null) ? task.cloud_x : R.hashFrac(task.id, 'cx');
    var cy = (task.cloud_y != null) ? task.cloud_y : R.hashFrac(task.id, 'cy');
    return {
      x: R.W * 0.1 + cx * R.W * 0.8,
      y: top + cy * (bot - top)
    };
  }

  // Convert hours-from-now to screen Y (time axis is vertical)
  function mHoursToY(h) {
    var riverTop = mSurfaceY() + 30;
    var nowY = riverTop + (R.H - riverTop) * NOW_Y_RATIO;
    return nowY + (h - R.scrollHours) * R.PIXELS_PER_HOUR;
  }

  // Stub: hoursToX returns center for all river tasks (they spread horizontally)
  function mHoursToX() { return R.W * 0.5; }

  // Now-line Y position
  function mNowY() { return mHoursToY(0); }

  // River task position: Y from time, X from hash scatter
  function mRiverPos(task) {
    var y = mHoursToY(task.position || 0);
    var left = 20;
    var right = R.W - 20;
    var rx = (task.river_y != null) ? task.river_y : R.hashFrac(task.id, 'ry');
    var x = left + rx * (right - left);
    return { x: x, y: y };
  }

  function mRecalcScale() {
    // Visible future spans from now-line to bottom edge
    var riverTop = mSurfaceY() + 30;
    var nowY = riverTop + (R.H - riverTop) * NOW_Y_RATIO;
    var futureHeight = R.H - nowY - 30;
    R.PIXELS_PER_HOUR = futureHeight / R.horizonHours;
  }

  // Task dimensions: on mobile, height = duration (vertical), width = fixed
  function mTaskStretch(a) {
    var hw, hh;
    if (a.position !== null && a.position !== undefined) {
      var durationPx = (a.mass / 60) * R.PIXELS_PER_HOUR;
      hh = Math.max(8, durationPx / 2); // height = duration
      hw = Math.min(hh, Math.max(14, hh * 0.6)); // width adapts
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

    // Cloud zone — cool dark sky at top
    ctx.fillStyle = R.SKY_COLOR;
    ctx.fillRect(0, 0, R.W, sY);

    // River zone — warm water below
    var waterGrad = ctx.createLinearGradient(0, sY, 0, R.H);
    waterGrad.addColorStop(0, R.WATER_TOP);
    waterGrad.addColorStop(1, R.WATER_DEEP);
    ctx.fillStyle = waterGrad;
    ctx.fillRect(0, sY, R.W, R.H - sY);

    // Surface glow — horizontal band
    var surfGrad = ctx.createLinearGradient(0, sY - 10, 0, sY + 20);
    surfGrad.addColorStop(0, 'rgba(200, 165, 110, 0)');
    surfGrad.addColorStop(0.3, 'rgba(200, 165, 110, 0.04)');
    surfGrad.addColorStop(0.5, 'rgba(200, 165, 110, 0.07)');
    surfGrad.addColorStop(0.7, 'rgba(200, 165, 110, 0.04)');
    surfGrad.addColorStop(1, 'rgba(200, 165, 110, 0)');
    ctx.fillStyle = surfGrad;
    ctx.fillRect(0, sY - 10, R.W, 30);
  }

  function mInitStreaks() {
    R.streaks = [];
    var sY = mSurfaceY();
    for (var i = 0; i < R.NUM_STREAKS; i++) {
      R.streaks.push({
        x: 0, // unused — streaks are horizontal lines that move DOWN
        y: sY + 20 + Math.random() * (R.H - sY - 40),
        len: 30 + Math.random() * (R.W * 0.6),
        speed: 6 + Math.random() * 18,
        alpha: 0.015 + Math.random() * 0.04,
        xOff: Math.random() * R.W * 0.4 // horizontal offset for variety
      });
    }
  }

  function mDrawStreaks(dt) {
    var ctx = R.ctx;
    var sY = mSurfaceY();
    for (var i = 0; i < R.streaks.length; i++) {
      var s = R.streaks[i];
      // Streaks drift downward (direction of time flow)
      s.y += s.speed * dt;
      if (s.y - 20 > R.H) {
        s.y = sY + 10;
        s.len = 30 + Math.random() * (R.W * 0.6);
        s.xOff = Math.random() * R.W * 0.3;
      }

      var fadeT = Math.min(1, (s.y - sY) / 80);
      var fadeB = Math.min(1, (R.H - s.y) / 80);
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
    var y = mNowY();
    if (y < mSurfaceY() - 40 || y > R.H + 40) return;

    var breath = Math.sin(t / 4000 * Math.PI * 2) * 0.5 + 0.5;

    // Glow — horizontal band
    var glowH = 15 + breath * 10;
    var glowGrad = ctx.createLinearGradient(0, y - glowH, 0, y + glowH);
    glowGrad.addColorStop(0, 'rgba(200, 165, 110, 0)');
    glowGrad.addColorStop(0.5, 'rgba(200, 165, 110, ' + (0.04 + breath * 0.04) + ')');
    glowGrad.addColorStop(1, 'rgba(200, 165, 110, 0)');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, y - glowH, R.W, glowH * 2);

    // Horizontal now line
    ctx.beginPath();
    ctx.moveTo(20, y);
    ctx.lineTo(R.W - 20, y);
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
    var fadeH = (R.H - sY) * 0.1;

    // Fade at top of river zone (past fades up)
    var fg = ctx.createLinearGradient(0, sY, 0, sY + fadeH);
    fg.addColorStop(0, R.WATER_TOP);
    fg.addColorStop(1, 'rgba(35, 30, 25, 0)');
    ctx.fillStyle = fg;
    ctx.fillRect(0, sY, R.W, fadeH);
  }

  function mDrawTimeMarkers() {
    if (!R.state) return;
    var ctx = R.ctx;
    var now = new Date(R.state.now);
    var sY = mSurfaceY();

    // Visible time range (vertical)
    var riverTop = sY + 30;
    var nowY = riverTop + (R.H - riverTop) * NOW_Y_RATIO;
    var viewTopH = R.scrollHours - (nowY - riverTop) / R.PIXELS_PER_HOUR;
    var viewBotH = viewTopH + (R.H - riverTop) / R.PIXELS_PER_HOUR;
    var viewTopMs = now.getTime() + viewTopH * 3600000;
    var viewBotMs = now.getTime() + viewBotH * 3600000;

    // Use the same boundary helpers from river-grid.js (they're on the R namespace)
    var majorTimes, majorLabel;

    if (R.horizonHours <= 6) {
      majorTimes = [];
      var d = new Date(viewTopMs); d.setMinutes(0,0,0);
      while (d.getTime() <= viewBotMs) { majorTimes.push(d.getTime()); d = new Date(d.getTime() + 3600000); }
      majorLabel = function(d) { var h=d.getHours(); return (h%12||12) + (h>=12?'pm':'am'); };
    } else if (R.horizonHours <= 24) {
      majorTimes = [];
      var d = new Date(viewTopMs); d.setMinutes(0,0,0);
      var step = 3 * 3600000;
      d = new Date(Math.floor(d.getTime() / step) * step);
      while (d.getTime() <= viewBotMs) { majorTimes.push(d.getTime()); d = new Date(d.getTime() + step); }
      majorLabel = function(d) { var h=d.getHours(); return (h%12||12) + (h>=12?'pm':'am'); };
    } else {
      // Wider horizons: daily markers
      majorTimes = [];
      var d = new Date(viewTopMs); d.setHours(0,0,0,0);
      if (d.getTime() < viewTopMs) d.setDate(d.getDate() + 1);
      while (d.getTime() <= viewBotMs) { majorTimes.push(d.getTime()); d.setDate(d.getDate() + 1); }
      majorLabel = function(d) { return R.DAYS[d.getDay()] + ' ' + d.getDate(); };
    }

    // Draw horizontal time markers
    ctx.font = '500 10px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'right';
    for (var i = 0; i < majorTimes.length; i++) {
      var hrs = (majorTimes[i] - now.getTime()) / 3600000;
      var y = mHoursToY(hrs);
      if (y < sY + 10 || y > R.H - 10) continue;

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
    R.hoursToX = mHoursToX; // stub — returns center
    R.hoursToY = mHoursToY; // new: time → Y
    R.nx = function () { return R.W * 0.5; }; // unused but safe
    R.recalcScale = mRecalcScale;
    R.taskStretch = mTaskStretch;
    R.drawWorld = mDrawWorld;
    R.initStreaks = mInitStreaks;
    R.drawStreaks = mDrawStreaks;
    R.drawNowLine = mDrawNowLine;
    R.drawPastFade = mDrawPastFade;
    R.drawTimeMarkers = mDrawTimeMarkers;

    // Hide plan button on mobile
    var planBtn = document.getElementById('plan-btn');
    if (planBtn) planBtn.style.display = 'none';

    // Hide horizon bar on mobile (use default day view)
    var horizonBar = document.getElementById('horizon-bar');
    if (horizonBar) horizonBar.style.display = 'none';

    R.recalcScale();
    R.initStreaks();
  };

  R.removeMobile = function () {
    R.surfaceY = _origSurfaceY;
    R.cloudPos = _origCloudPos;
    R.riverPos = _origRiverPos;
    R.hoursToX = _origHoursToX;
    delete R.hoursToY;
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
    if (horizonBar) horizonBar.style.display = '';

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
  };

  // ── Touch Events ───────────────────────────────────────────────────

  var touchStart = null;
  var touchScrolling = false;

  if (R.canvas) {
    R.canvas.addEventListener('touchstart', function (e) {
      if (!R.isMobile) return;
      e.preventDefault();
      var t = e.touches[0];
      touchStart = { x: t.clientX, y: t.clientY, time: Date.now(), scrollH: R.scrollHours };
      touchScrolling = false;

      // Simulate mousedown for hit testing
      var me = new MouseEvent('mousedown', { clientX: t.clientX, clientY: t.clientY });
      R.canvas.dispatchEvent(me);
    }, { passive: false });

    R.canvas.addEventListener('touchmove', function (e) {
      if (!R.isMobile || !touchStart) return;
      e.preventDefault();
      var t = e.touches[0];
      var dy = t.clientY - touchStart.y;

      if (Math.abs(dy) > R.DRAG_THRESHOLD) {
        touchScrolling = true;
      }

      if (touchScrolling) {
        // Scroll time by dragging vertically
        var hoursPerPx = 1 / R.PIXELS_PER_HOUR;
        R.scrollHours = touchStart.scrollH - dy * hoursPerPx;
      } else {
        // Drag task
        var me = new MouseEvent('mousemove', { clientX: t.clientX, clientY: t.clientY });
        R.canvas.dispatchEvent(me);
      }
    }, { passive: false });

    R.canvas.addEventListener('touchend', function (e) {
      if (!R.isMobile) return;
      e.preventDefault();
      if (touchScrolling) {
        // Could add momentum here
        touchScrolling = false;
        touchStart = null;
        return;
      }

      var me = new MouseEvent('mouseup', {
        clientX: e.changedTouches[0].clientX,
        clientY: e.changedTouches[0].clientY
      });
      R.canvas.dispatchEvent(me);
      touchStart = null;
    }, { passive: false });
  }

  // ── Initial Check ──────────────────────────────────────────────────
  // Run after canvas is sized
  setTimeout(function () {
    if (R.W > 0) {
      R.checkMobile();
      if (R.isMobile) R.applyMobile();
    }
  }, 100);

})();

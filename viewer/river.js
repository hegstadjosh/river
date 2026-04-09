// ─────────────────────────────────────────────────────────────────────
// River — a river of time, watched from a bridge
//
// Time flows continuously from right to left.
// The present is a vertical line of warm light.
// Future tasks emerge from the right. Past fades left.
// Above the river: the cloud — where uncommitted thoughts float.
// Below: the river — where things have weight and position in time.
// Nothing is punitive. Nothing is overdue. Things simply drift.
// ─────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // ── World Constants ─────────────────────────────────────────────────

  var PIXELS_PER_HOUR = 0; // set by horizon selector
  var horizonHours = 24;  // default: day view
  var scrollHours = 0;    // horizontal scroll offset (hours from now)
  var scrollVel = 0;      // scroll momentum (hours/sec)
  var CLOUD_RATIO = 0.30;       // top 30% is cloud (sky)
  var SURFACE_RATIO = 0.35;     // the river surface starts here
  var NOW_X = 0.25;             // now-line at 25% from left
  var BLOB_SCALE = 4.0;         // radius = sqrt(mass) * scale
  var SPRING_K = 0.06;          // spring stiffness (lower = more fluid)
  var DAMPING = 0.78;           // spring damping (higher = more viscous)
  var DRAG_THRESHOLD = 5;

  // Tag → hue (warm palette, earth tones)
  var TAG_HUES = { work: 28, school: 28, personal: 205, health: 145, creative: 275 };
  var DEFAULT_HUE = 32;

  // ── Palette ─────────────────────────────────────────────────────────
  // The world has two zones: sky (cloud) and water (river).
  // Sky is cool and still. Water is warm and moving.

  var SKY_COLOR    = '#17161a';  // cool dark — a night sky
  var WATER_TOP    = '#231e19';  // warm dark — shallow water
  var WATER_DEEP   = '#1e1a15';  // slightly deeper
  var SURFACE_GLOW = 'rgba(200, 165, 110, 0.06)'; // where light hits water
  var AMBER        = [200, 165, 110]; // the color of the now-light

  // ── State ───────────────────────────────────────────────────────────

  var state = null;
  var animTasks = [];
  var selectedId = null;
  var dragging = null;
  var lastTime = 0;
  var mouseX = 0, mouseY = 0;

  // Flow streaks — the river's current
  var streaks = [];
  var NUM_STREAKS = 20;

  // ── Canvas ──────────────────────────────────────────────────────────

  var canvas = document.getElementById('river-canvas');
  var ctx = canvas.getContext('2d');
  var W, H, dpr;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    initStreaks();
  }

  function recalcScale() {
    // The visible future spans from the now-line to the right edge
    var futureWidth = W * (1 - NOW_X) - 30; // 30px margin
    PIXELS_PER_HOUR = futureWidth / horizonHours;
  }

  window.addEventListener('resize', function () { resize(); recalcScale(); sync(); });
  resize();
  recalcScale();

  // ── Horizon Bar ──────────────────────────────────────────────────────

  var hzBtns = document.querySelectorAll('.hz-btn');
  var hzLabel = document.getElementById('hz-label');
  var hzPrev = document.getElementById('hz-prev');
  var hzNext = document.getElementById('hz-next');

  var FRAME_LABELS = {
    6: '6 hours', 24: 'day', 96: '4 days',
    168: 'week', 720: 'month', 2160: 'quarter', 8760: 'year'
  };

  function setHorizon(hours) {
    hzBtns.forEach(function (b) { b.classList.remove('active'); });
    hzBtns.forEach(function (b) { if (Number(b.dataset.hours) === hours) b.classList.add('active'); });
    horizonHours = hours;
    recalcScale();
    sync();
    updateFrameLabel();
  }

  function updateFrameLabel() {
    if (!state) { hzLabel.textContent = FRAME_LABELS[horizonHours] || ''; return; }
    var now = new Date(state.now);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    // For short horizons (6h, day) — show relative offset in hours
    if (horizonHours <= 24) {
      if (Math.abs(scrollHours) < 1) {
        hzLabel.textContent = horizonHours <= 6 ? 'now' : 'today';
      } else {
        var sign = scrollHours > 0 ? '+' : '';
        var h = Math.round(scrollHours);
        hzLabel.textContent = sign + h + 'h';
      }
      return;
    }

    // For longer horizons — show the center date contextually
    var center = new Date(now.getTime() + (scrollHours + horizonHours / 2) * 3600000);

    if (Math.abs(scrollHours) < horizonHours * 0.1) {
      if (horizonHours <= 96) hzLabel.textContent = 'next 4 days';
      else if (horizonHours <= 168) hzLabel.textContent = 'this week';
      else if (horizonHours <= 720) hzLabel.textContent = months[now.getMonth()];
      else if (horizonHours <= 2160) hzLabel.textContent = 'Q' + (Math.floor(now.getMonth()/3)+1) + ' \u2019' + (now.getFullYear()%100);
      else hzLabel.textContent = '' + now.getFullYear();
    } else {
      if (horizonHours <= 168) {
        var start = new Date(now.getTime() + scrollHours * 3600000);
        hzLabel.textContent = months[start.getMonth()] + ' ' + start.getDate() + '\u2009\u2013\u2009' + new Date(start.getTime() + horizonHours*3600000).getDate();
      } else if (horizonHours <= 720) {
        hzLabel.textContent = months[center.getMonth()] + ' \u2019' + (center.getFullYear()%100);
      } else if (horizonHours <= 2160) {
        hzLabel.textContent = 'Q' + (Math.floor(center.getMonth()/3)+1) + ' \u2019' + (center.getFullYear()%100);
      } else {
        hzLabel.textContent = '' + center.getFullYear();
      }
    }
  }

  function getCalendarHorizon(nominal) {
    return nominal; // all frames are fixed durations
  }

  hzBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      scrollHours = 0; scrollVel = 0;
      var nominal = Number(btn.dataset.hours);
      setHorizon(getCalendarHorizon(nominal));
      // Store nominal so we know which button is active
      btn._nominal = nominal;
    });
  });

  function frameStep() {
    if (horizonHours <= 6) return 6;
    if (horizonHours <= 24) return 24;      // 1 day
    if (horizonHours <= 96) return 24;      // 4d: iterate 1 day
    if (horizonHours <= 168) return 168;    // 1 week
    if (horizonHours <= 720) return 720;    // 1 month
    if (horizonHours <= 2160) return 2160;  // 1 quarter
    return 8760;
  }

  hzPrev.addEventListener('click', function () {
    scrollHours -= frameStep();
    scrollVel = 0;
    sync(); updateFrameLabel();
  });

  hzNext.addEventListener('click', function () {
    scrollHours += frameStep();
    scrollVel = 0;
    sync(); updateFrameLabel();
  });

  // ── Scroll / Trackpad ──────────────────────────────────────────────
  // Horizontal scroll (wheel or trackpad) pans the river smoothly.

  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    // deltaX for horizontal trackpad, deltaY for mouse wheel
    var delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    // Convert pixels to hours
    var hoursPerPx = 1 / PIXELS_PER_HOUR;
    scrollHours += delta * hoursPerPx * 1.2;
    scrollVel = 0; // kill momentum on direct input
    sync();
    updateFrameLabel();
  }, { passive: false });

  // ── Layout ──────────────────────────────────────────────────────────

  function surfaceY()  { return H * SURFACE_RATIO; }
  function cloudTopY() { return 40; }
  function riverMidY() { return surfaceY() + (H - surfaceY()) * 0.45; }

  // Convert hours-from-now to screen X, accounting for scroll
  function hoursToX(h) { return W * NOW_X + (h - scrollHours) * PIXELS_PER_HOUR; }
  // The now-line's screen position (moves when scrolling)
  function nx() { return hoursToX(0); }

  // Deterministic scatter from ID
  function hashFrac(id, seed) {
    var h = 5381;
    var s = id + (seed || '');
    for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return (h % 10000) / 10000;
  }

  function cloudPos(task) {
    var top = cloudTopY();
    var bot = surfaceY() - 50; // stay well above the surface
    return {
      x: W * 0.15 + hashFrac(task.id, 'cx') * W * 0.7,
      y: top + hashFrac(task.id, 'cy') * (bot - top)
    };
  }

  function riverPos(task) {
    var x = hoursToX(task.position || 0);
    var top = surfaceY() + 30;
    var bot = H - 50;
    var mid = (top + bot) / 2;
    var spread = (bot - top) * 0.2;
    var y = mid + (hashFrac(task.id, 'ry') - 0.5) * 2 * spread;
    return { x: x, y: y };
  }

  // Base radius — log-scaled so short tasks differ visibly,
  // but month-long tasks don't become vertically enormous
  function blobR(mass) {
    if (mass <= 240) return Math.sqrt(mass) * BLOB_SCALE; // normal for ≤4h
    return Math.sqrt(240) * BLOB_SCALE + Math.log2(mass / 240) * 8; // log taper above 4h
  }

  function tagHue(tags) {
    if (!tags || !tags.length) return DEFAULT_HUE;
    for (var i = 0; i < tags.length; i++) {
      var h = TAG_HUES[tags[i].toLowerCase()];
      if (h !== undefined) return h;
    }
    return DEFAULT_HUE;
  }

  // ── Flow Streaks ────────────────────────────────────────────────────
  // The river's current. Faint horizontal wisps drifting left.
  // They exist at the edge of perception — you feel the motion
  // more than you see it. But they're there.

  function initStreaks() {
    streaks = [];
    var sY = surfaceY();
    for (var i = 0; i < NUM_STREAKS; i++) {
      streaks.push({
        x: Math.random() * W * 1.5,
        y: sY + 20 + Math.random() * (H - sY - 40),
        len: 60 + Math.random() * 180,
        speed: 8 + Math.random() * 25,
        alpha: 0.015 + Math.random() * 0.04 // 1.5–5.5% — perceptible but quiet
      });
    }
  }

  // ── Sync State → Animation Tasks ───────────────────────────────────

  function sync() {
    if (!state) return;
    var all = (state.river || []).concat(state.cloud || []);
    var map = {};
    for (var i = 0; i < all.length; i++) map[all[i].id] = all[i];

    // Remove gone tasks
    animTasks = animTasks.filter(function (a) { return map[a.id]; });

    var existing = {};
    for (var j = 0; j < animTasks.length; j++) existing[animTasks[j].id] = j;

    for (var k = 0; k < all.length; k++) {
      var t = all[k];
      var tgt = (t.position !== null && t.position !== undefined) ? riverPos(t) : cloudPos(t);

      if (existing[t.id] !== undefined) {
        var a = animTasks[existing[t.id]];
        a.name = t.name; a.mass = t.mass; a.solidity = t.solidity;
        a.fixed = t.fixed; a.alive = t.alive; a.tags = t.tags;
        a.position = t.position; a.anchor = t.anchor;
        a.tx = tgt.x;
        a.ty = (a.customY !== undefined) ? a.customY : tgt.y;
      } else {
        animTasks.push({
          id: t.id, name: t.name, mass: t.mass, solidity: t.solidity,
          fixed: t.fixed, alive: t.alive, tags: t.tags,
          position: t.position, anchor: t.anchor,
          x: tgt.x, y: tgt.y, tx: tgt.x, ty: tgt.y, vx: 0, vy: 0
        });
      }
    }
  }

  // ── SSE + Fetch ─────────────────────────────────────────────────────

  function connectSSE() {
    var es = new EventSource('/events');
    es.onmessage = function (e) {
      try { state = JSON.parse(e.data); sync(); } catch (_) {}
    };
  }

  fetch('/state').then(function (r) { return r.json(); })
    .then(function (d) { state = d; sync(); }).catch(function () {});
  connectSSE();

  // ── API ─────────────────────────────────────────────────────────────

  function post(action, data) {
    fetch('/state', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ action: action }, data))
    }).catch(function () {});
  }

  // ── Drawing: The World ──────────────────────────────────────────────

  function drawWorld(t) {
    var sY = surfaceY();

    // Sky — cool, dark, still
    ctx.fillStyle = SKY_COLOR;
    ctx.fillRect(0, 0, W, sY);

    // Water — warm, deep
    var waterGrad = ctx.createLinearGradient(0, sY, 0, H);
    waterGrad.addColorStop(0, WATER_TOP);
    waterGrad.addColorStop(1, WATER_DEEP);
    ctx.fillStyle = waterGrad;
    ctx.fillRect(0, sY, W, H - sY);

    // The surface — where sky meets water
    // A band of warm light, like sunlight on a river's surface
    var surfGrad = ctx.createLinearGradient(0, sY - 15, 0, sY + 25);
    surfGrad.addColorStop(0, 'rgba(200, 165, 110, 0)');
    surfGrad.addColorStop(0.3, 'rgba(200, 165, 110, 0.04)');
    surfGrad.addColorStop(0.5, 'rgba(200, 165, 110, 0.07)');
    surfGrad.addColorStop(0.7, 'rgba(200, 165, 110, 0.04)');
    surfGrad.addColorStop(1, 'rgba(200, 165, 110, 0)');
    ctx.fillStyle = surfGrad;
    ctx.fillRect(0, sY - 15, W, 40);

    // Breathing room: the river between tasks glows slightly warmer
    // This is the "valleys of light" — we paint a very subtle warm wash
    // over the river, and the blobs will darken their footprint
    ctx.fillStyle = 'rgba(200, 165, 110, 0.008)';
    ctx.fillRect(0, sY + 25, W, H - sY - 25);
  }

  // ── Drawing: Flow Streaks ───────────────────────────────────────────

  function drawStreaks(dt) {
    var sY = surfaceY();
    for (var i = 0; i < streaks.length; i++) {
      var s = streaks[i];
      s.x -= s.speed * dt;
      if (s.x + s.len < 0) {
        s.x = W + 20 + Math.random() * 200;
        s.y = sY + 20 + Math.random() * (H - sY - 40);
        s.len = 60 + Math.random() * 180;
      }

      // Streaks fade near edges
      var fadeL = Math.min(1, (s.x + s.len) / 100);
      var fadeR = Math.min(1, (W - s.x) / 100);
      var fade = fadeL * fadeR;

      ctx.beginPath();
      ctx.moveTo(Math.max(0, s.x), s.y);
      ctx.lineTo(Math.min(W, s.x + s.len), s.y);
      ctx.strokeStyle = 'rgba(' + AMBER[0] + ',' + AMBER[1] + ',' + AMBER[2] + ',' + (s.alpha * fade).toFixed(4) + ')';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // ── Drawing: Now Line ───────────────────────────────────────────────
  // The only pulsing element. A vertical thread of warm light
  // in the river zone. The perceptual anchor. Where you stand.

  function drawNowLine(t) {
    var x = nx();
    // Don't draw if scrolled off screen
    if (x < -40 || x > W + 40) return;

    var sY = surfaceY();
    var breath = Math.sin(t / 4000 * Math.PI * 2) * 0.5 + 0.5;

    // Glow — a soft wash of amber around the line
    var glowW = 20 + breath * 15;
    var glowGrad = ctx.createLinearGradient(x - glowW, 0, x + glowW, 0);
    glowGrad.addColorStop(0, 'rgba(200, 165, 110, 0)');
    glowGrad.addColorStop(0.5, 'rgba(200, 165, 110, ' + (0.04 + breath * 0.04) + ')');
    glowGrad.addColorStop(1, 'rgba(200, 165, 110, 0)');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(x - glowW, sY, glowW * 2, H - sY);

    // The line itself — only in the river
    ctx.beginPath();
    ctx.moveTo(x, sY + 5);
    ctx.lineTo(x, H);
    ctx.strokeStyle = 'rgba(200, 165, 110, ' + (0.3 + breath * 0.15) + ')';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // "now" label — at the surface
    ctx.fillStyle = 'rgba(200, 165, 110, ' + (0.3 + breath * 0.15) + ')';
    ctx.font = '500 11px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('now', x, sY + 18);
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

  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  function drawTimeMarkers() {
    if (!state) return;
    var now = new Date(state.now);
    var sY = surfaceY();
    var riverH = H - sY;

    // Visible time range
    var viewLeftH = scrollHours - (W * NOW_X) / PIXELS_PER_HOUR;
    var viewRightH = viewLeftH + W / PIXELS_PER_HOUR;
    var viewLeftMs = now.getTime() + viewLeftH * 3600000;
    var viewRightMs = now.getTime() + viewRightH * 3600000;

    // Pick major/minor intervals based on frame
    var majorMs, minorMs, labelFn;

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
      var d = new Date(startMs);
      d.setMinutes(0,0,0);
      d.setHours(Math.floor(d.getHours() / intervalH) * intervalH);
      if (d.getTime() < startMs) d.setHours(d.getHours() + intervalH);
      while (d.getTime() <= endMs) {
        times.push(d.getTime());
        d.setHours(d.getHours() + intervalH);
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

    // ── Build major + minor lists based on frame ──
    var majorTimes, minorTimes, majorLabel, minorLabel;

    if (horizonHours <= 6) {
      majorTimes = localHourBoundaries(viewLeftMs, viewRightMs, 1);
      minorTimes = localHourBoundaries(viewLeftMs, viewRightMs, 0.5);
      majorLabel = function(d) { var h=d.getHours(); return (h%12||12) + (h>=12?'pm':'am'); };
      minorLabel = function(d) { var m=d.getMinutes(); return m ? ':' + (m<10?'0':'') + m : ''; };
    } else if (horizonHours <= 24) {
      majorTimes = localHourBoundaries(viewLeftMs, viewRightMs, 6);
      minorTimes = localHourBoundaries(viewLeftMs, viewRightMs, 3);
      majorLabel = function(d) { var h=d.getHours(); return (h%12||12) + (h>=12?'pm':'am'); };
      minorLabel = function(d) { var h=d.getHours(); return (h%12||12) + (h>=12?'pm':'am'); };
    } else if (horizonHours <= 96) {
      majorTimes = localMidnights(viewLeftMs, viewRightMs);
      minorTimes = localHourBoundaries(viewLeftMs, viewRightMs, 12);
      majorLabel = function(d) { return DAYS[d.getDay()] + ' ' + (d.getMonth()+1) + '/' + d.getDate(); };
      minorLabel = function(d) { return d.getHours() === 12 ? 'noon' : ''; };
    } else if (horizonHours <= 168) {
      majorTimes = localMidnights(viewLeftMs, viewRightMs);
      minorTimes = []; // no half-lines in week view
      majorLabel = function(d) { return DAYS[d.getDay()] + ' ' + d.getDate(); };
      minorLabel = null;
    } else if (horizonHours <= 720) {
      majorTimes = localMondays(viewLeftMs, viewRightMs);
      minorTimes = localMidnights(viewLeftMs, viewRightMs);
      majorLabel = function(d) { return MONTHS[d.getMonth()] + ' ' + d.getDate(); };
      minorLabel = function(d) { return d.getDate(); };
    } else if (horizonHours <= 2160) {
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
      var x = hoursToX(hrs);
      if (x < 5 || x > W - 5) continue;

      ctx.beginPath();
      ctx.moveTo(x, sY + 10);
      ctx.lineTo(x, H);
      ctx.strokeStyle = 'rgba(200, 165, 110, 0.1)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = 'rgba(200, 165, 110, 0.4)';
      ctx.fillText(majorLabel(new Date(majorTimes[i])), x, H - 14);
    }

    // ── Draw minor lines — 20% river height from bottom, lighter ──
    if (minorTimes.length > 0 && minorLabel) {
      var minorH = riverH * 0.2;
      ctx.font = '400 10px -apple-system, system-ui, sans-serif';
      for (var j = 0; j < minorTimes.length; j++) {
        var hrs2 = (minorTimes[j] - now.getTime()) / 3600000;
        var x2 = hoursToX(hrs2);
        if (x2 < 5 || x2 > W - 5) continue;

        ctx.beginPath();
        ctx.moveTo(x2, H - minorH);
        ctx.lineTo(x2, H);
        ctx.strokeStyle = 'rgba(200, 165, 110, 0.06)';
        ctx.lineWidth = 1;
        ctx.stroke();

        var ml = minorLabel(new Date(minorTimes[j]));
        if (ml) {
          ctx.fillStyle = 'rgba(200, 165, 110, 0.2)';
          ctx.fillText(ml, x2, H - 8);
        }
      }
    }
  }

  // ── Drawing: Blobs ──────────────────────────────────────────────────
  // Each blob is organic — not a circle. 2-3 overlapping ellipses
  // with slightly offset radial gradients. Like cells. Like watercolors.
  //
  // Solidity controls everything visual:
  //   0.9+ → crystalline, sharp edges, vivid color, full presence
  //   0.5  → forming, moderate blur, coming into focus
  //   0.1  → a wisp, barely there, bleeding edges, suggestion of a thought

  // ── Drawing: Unified blob rendering ─────────────────────────────────
  // One continuous function. Solidity drives EVERYTHING:
  //   0.0 → circular wisp, maximum blur, barely visible
  //   0.5 → forming, widening, coming into focus
  //   0.8 → crisp rounded rectangle spanning actual duration
  //   1.0 → sharp time block, full opacity, minimal corner radius
  // "Fixed" just means pinned to a time. Not a different shape.

  function drawBlob(a, t) {
    var hue = tagHue(a.tags);
    var sol = a.solidity;
    var x = a.x, y = a.y;

    // Is anything alive? If so, non-alive tasks dim.
    var anyAlive = false;
    for (var i = 0; i < animTasks.length; i++) {
      if (animTasks[i].alive) { anyAlive = true; break; }
    }
    var dim = (anyAlive && !a.alive) ? 0.55 : 1.0;

    // ── Dimensions ──
    // Width = exact duration in pixels. Always.
    // Height = proportional to width, clamped. Never more oblong than ~3:1.
    var hw, hh;
    if (a.position !== null && a.position !== undefined) {
      var durationPx = (a.mass / 60) * PIXELS_PER_HOUR;
      hw = Math.max(8, durationPx / 2); // min 8px so it's grabbable
      hh = Math.min(hw, Math.max(14, hw * 0.6)); // proportional, max ratio ~1.7:1
      hh = Math.min(hh, 60); // absolute max height
    } else {
      // Cloud: circle based on a modest fixed size
      hw = 18; hh = 18;
    }

    // ── Visual parameters from solidity ──
    var alpha = (0.2 + sol * 0.75) * dim;
    var blur = Math.max(0, (1 - sol) * 10);
    var sat = 30 + sol * 45;
    var lit = 40 + sol * 18;

    // Past tasks: desaturate
    if (a.position !== null && a.position < 0) {
      sat *= 0.4;
      hue = hue * 0.5 + 210 * 0.5;
      alpha *= Math.max(0.1, 1 + a.position * 0.3);
    }

    // Corner radius: fully round at sol=0, tight at sol=1
    var maxCorner = Math.min(hw, hh);
    var cornerR = maxCorner * (1 - sol * 0.85); // round → 15% of size

    ctx.save();

    // ── Alive glow ──
    if (a.alive) {
      hw *= 1.3; hh *= 1.3;
      var breath = Math.sin(t / 4000 * Math.PI * 2) * 0.5 + 0.5;
      var glowR = Math.max(hw, hh) * 2.0 + breath * 10;
      var gg = ctx.createRadialGradient(x, y, Math.min(hw, hh) * 0.5, x, y, glowR);
      gg.addColorStop(0, 'hsla(' + hue + ',' + sat + '%,' + lit + '%,0.18)');
      gg.addColorStop(1, 'hsla(' + hue + ',' + sat + '%,' + lit + '%,0)');
      ctx.fillStyle = gg;
      ctx.beginPath();
      ctx.ellipse(x, y, glowR, glowR * 0.85, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    if (blur > 1.5) ctx.filter = 'blur(' + blur.toFixed(1) + 'px)';

    // ── The shape: continuous morph ──
    // Low solidity: overlapping organic ellipses (wispy, scattered)
    // High solidity: single filled roundRect (crisp time block)
    // The crossover is around sol 0.55

    var rectness = Math.max(0, Math.min(1, (sol - 0.35) / 0.45)); // 0 at ≤0.35, 1 at ≥0.8

    if (rectness < 1) {
      // Organic layers — fade out as rectness increases
      var organicAlpha = alpha * (1 - rectness * 0.7);
      var scatter = Math.max(0, 1 - sol * 1.2);
      var sc = Math.min(hw, hh) * 0.12 * scatter; // scatter distance
      var layers = [
        { dx: 0,     dy: 0,     rx: hw,        ry: hh,        a: organicAlpha },
        { dx: sc,    dy: -sc*0.7, rx: hw * 0.9,  ry: hh * 1.05, a: organicAlpha * 0.6 },
        { dx: -sc*0.7, dy: sc,   rx: hw * 0.85, ry: hh * 0.9,  a: organicAlpha * 0.4 }
      ];

      for (var li = 0; li < layers.length; li++) {
        var L = layers[li];
        var cx = x + L.dx, cy = y + L.dy;
        var maxR = Math.max(L.rx, L.ry);
        var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
        g.addColorStop(0,   'hsla(' + hue + ',' + sat + '%,' + lit + '%,' + L.a + ')');
        g.addColorStop(0.5, 'hsla(' + hue + ',' + (sat*0.8) + '%,' + (lit*0.9) + '%,' + (L.a*0.6) + ')');
        g.addColorStop(0.8, 'hsla(' + hue + ',' + (sat*0.6) + '%,' + (lit*0.8) + '%,' + (L.a*0.2) + ')');
        g.addColorStop(1,   'hsla(' + hue + ',' + sat + '%,' + lit + '%,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(cx, cy, L.rx, L.ry, 0.05 * (li - 1) * scatter, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (rectness > 0) {
      // Solid form — fades in as rectness increases
      var solidAlpha = alpha * rectness;
      var fg = ctx.createLinearGradient(x - hw, y, x + hw, y);
      fg.addColorStop(0,   'hsla(' + hue + ',' + sat + '%,' + (lit - 3) + '%,' + solidAlpha + ')');
      fg.addColorStop(0.5, 'hsla(' + hue + ',' + (sat + 5) + '%,' + lit + '%,' + solidAlpha + ')');
      fg.addColorStop(1,   'hsla(' + hue + ',' + sat + '%,' + (lit - 3) + '%,' + (solidAlpha * 0.9) + ')');
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.roundRect(x - hw, y - hh, hw * 2, hh * 2, cornerR);
      ctx.fill();

      // Subtle top bevel at high solidity
      if (sol > 0.7) {
        var bevelA = (sol - 0.7) / 0.3 * 0.1 * dim;
        var bg = ctx.createLinearGradient(x, y - hh, x, y - hh + 6);
        bg.addColorStop(0, 'rgba(255, 255, 255, ' + bevelA + ')');
        bg.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.roundRect(x - hw, y - hh, hw * 2, 6, [cornerR, cornerR, 0, 0]);
        ctx.fill();
      }

      // Shadow at high solidity — things with form have weight
      if (sol > 0.6) {
        var shadowA = (sol - 0.6) / 0.4 * 0.08 * dim;
        var bs = ctx.createLinearGradient(x, y + hh - 4, x, y + hh);
        bs.addColorStop(0, 'rgba(0, 0, 0, 0)');
        bs.addColorStop(1, 'rgba(0, 0, 0, ' + shadowA + ')');
        ctx.fillStyle = bs;
        ctx.beginPath();
        ctx.roundRect(x - hw, y + hh - 4, hw * 2, 4, [0, 0, cornerR, cornerR]);
        ctx.fill();
      }
    }

    ctx.filter = 'none';

    // Selection ring
    if (selectedId === a.id) {
      ctx.beginPath();
      ctx.roundRect(x - hw - 5, y - hh - 5, hw * 2 + 10, hh * 2 + 10, cornerR + 3);
      ctx.strokeStyle = 'rgba(200, 165, 110, 0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();

    // Label — hide during resize
    if (resizing && resizing.id === a.id) return;

    var fontSize = Math.max(10, Math.min(14, hh * 0.65));
    var labelA = Math.min(0.9, (sol * 0.6 + 0.3)) * dim;
    ctx.font = (sol > 0.6 ? '600 ' : '400 ') + fontSize + 'px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(215, 200, 180, ' + labelA.toFixed(3) + ')';

    var nameW = ctx.measureText(a.name).width;
    if (nameW < hw * 1.8) {
      ctx.fillText(a.name, x, y);
    } else {
      ctx.fillText(a.name, x, y + hh + fontSize + 2);
    }
  }

  // ── Drawing: Past Fade ──────────────────────────────────────────────
  // The leftmost portion of the viewport fades to background.
  // Things behind you dissolve. No record. No judgment.

  function drawPastFade() {
    var fadeW = W * 0.12;
    var sY = surfaceY();
    var fg = ctx.createLinearGradient(0, 0, fadeW, 0);
    fg.addColorStop(0, SKY_COLOR);
    fg.addColorStop(1, 'rgba(23, 22, 26, 0)');
    ctx.fillStyle = fg;
    ctx.fillRect(0, 0, fadeW, sY);

    var fr = ctx.createLinearGradient(0, 0, fadeW, 0);
    fr.addColorStop(0, WATER_DEEP);
    fr.addColorStop(1, 'rgba(30, 26, 21, 0)');
    ctx.fillStyle = fr;
    ctx.fillRect(0, sY, fadeW, H - sY);
  }

  // ── Hit Testing ─────────────────────────────────────────────────────

  function taskStretch(a) {
    var hw, hh;
    if (a.position !== null && a.position !== undefined) {
      var dpx = (a.mass / 60) * PIXELS_PER_HOUR;
      hw = Math.max(8, dpx / 2);
      hh = Math.min(hw, Math.max(14, hw * 0.6));
      hh = Math.min(hh, 60);
    } else {
      hw = 18; hh = 18;
    }
    if (a.alive) { hw *= 1.3; hh *= 1.3; }
    return { r: Math.max(hw, hh), hw: hw, hh: hh };
  }

  var MIN_HIT = 15; // minimum grab area radius
  function hitTest(mx, my) {
    for (var i = animTasks.length - 1; i >= 0; i--) {
      var a = animTasks[i];
      var d = taskStretch(a);
      var hitHW = Math.max(MIN_HIT, d.hw + 5);
      var hitHH = Math.max(MIN_HIT, d.hh + 5);
      if (Math.abs(mx - a.x) <= hitHW && Math.abs(my - a.y) <= hitHH) return a;
    }
    return null;
  }

  // ── Panel ───────────────────────────────────────────────────────────

  var panel = document.getElementById('panel');
  var panelName = document.getElementById('panel-name');
  var panelDurations = document.getElementById('panel-durations');
  var panelDurInput = document.getElementById('panel-dur-input');
  var panelSolidity = document.getElementById('panel-solidity');
  var panelFixed = document.getElementById('panel-fixed');
  var panelDissolve = document.getElementById('panel-dissolve');

  // Duration presets adapt to the current horizon
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

  function getPresets() {
    // Find closest matching preset set
    var keys = [6, 24, 96, 168, 720, 2160, 8760];
    var best = 24;
    for (var i = 0; i < keys.length; i++) {
      if (Math.abs(keys[i] - horizonHours) < Math.abs(best - horizonHours)) best = keys[i];
    }
    return DURATION_PRESETS[best];
  }

  function renderPresetButtons(currentMass) {
    var presets = getPresets();
    panelDurations.innerHTML = '';
    for (var i = 0; i < presets.length; i++) {
      var btn = document.createElement('button');
      btn.className = 'dur-btn' + (presets[i].m === currentMass ? ' active' : '');
      btn.dataset.mass = presets[i].m;
      btn.textContent = presets[i].l;
      btn.addEventListener('click', (function (mass) {
        return function () {
          if (!selectedId) return;
          post('put', { id: selectedId, mass: mass });
          panelDurInput.value = formatDuration(mass);
          renderPresetButtons(mass);
        };
      })(presets[i].m));
      panelDurations.appendChild(btn);
    }
  }

  function formatDuration(mins) {
    if (mins >= 525600) return Math.round(mins / 525600) + 'y';
    if (mins >= 43200) return Math.round(mins / 43200) + 'mo';
    if (mins >= 10080) return Math.round(mins / 10080) + 'w';
    if (mins >= 1440) return (mins / 1440).toFixed(mins % 1440 ? 1 : 0).replace(/\.0$/, '') + 'd';
    if (mins >= 60) {
      var h = Math.floor(mins / 60), m = Math.round(mins % 60);
      return m ? h + 'h ' + m + 'm' : h + 'h';
    }
    return Math.round(mins) + 'm';
  }

  function parseDuration(str) {
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
  }

  function showPanel(a, sx, sy) {
    selectedId = a.id;
    panelName.value = a.name;
    panelDurInput.value = formatDuration(a.mass);
    renderPresetButtons(a.mass);
    panelSolidity.value = Math.round(a.solidity * 100);
    panelFixed.checked = a.fixed;

    var pw = 220, ph = 200;
    var px = sx + 20, py = sy - ph / 2;
    if (px + pw > W - 10) px = sx - pw - 20;
    if (py < 10) py = 10;
    if (py + ph > H - 10) py = H - ph - 10;

    panel.style.left = px + 'px';
    panel.style.top = py + 'px';
    panel.classList.remove('hidden');
  }

  function hidePanel() { panel.classList.add('hidden'); selectedId = null; }

  // Panel events
  var nameTimer = null;
  panelName.addEventListener('input', function () {
    if (!selectedId) return;
    clearTimeout(nameTimer);
    nameTimer = setTimeout(function () {
      post('put', { id: selectedId, name: panelName.value });
    }, 300);
  });
  panelDurInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      var parsed = parseDuration(panelDurInput.value);
      if (parsed && selectedId) {
        post('put', { id: selectedId, mass: parsed });
        panelDurInput.value = formatDuration(parsed);
        renderPresetButtons(parsed);
      }
      panelDurInput.blur();
    }
  });
  panelDurInput.addEventListener('blur', function () {
    // Reformat on blur
    var parsed = parseDuration(panelDurInput.value);
    if (parsed && selectedId) {
      post('put', { id: selectedId, mass: parsed });
      panelDurInput.value = formatDuration(parsed);
      renderPresetButtons(parsed);
    }
  });
  panelSolidity.addEventListener('input', function () {
    if (!selectedId) return;
    post('put', { id: selectedId, solidity: Number(panelSolidity.value) / 100 });
  });
  panelFixed.addEventListener('change', function () {
    if (!selectedId) return;
    post('put', { id: selectedId, fixed: panelFixed.checked });
  });
  panelDissolve.addEventListener('click', function () {
    if (!selectedId) return;
    post('delete', { id: selectedId });
    hidePanel();
  });

  // ── Mouse ───────────────────────────────────────────────────────────

  function findTask(id) {
    for (var i = 0; i < animTasks.length; i++)
      if (animTasks[i].id === id) return animTasks[i];
    return null;
  }

  function taskEdges(a) {
    var d = taskStretch(a);
    return { left: a.x - d.hw, right: a.x + d.hw, top: a.y - d.hh, bottom: a.y + d.hh, hw: d.hw };
  }

  // Detect if mouse is in the resize handle zone.
  // Handles are OUTSIDE the grab area — they extend beyond the task edges.
  var HANDLE_ZONE = 14;
  function edgeHit(mx, my) {
    for (var i = animTasks.length - 1; i >= 0; i--) {
      var a = animTasks[i];
      if (a.position === null || a.position === undefined) continue;
      var d = taskStretch(a);
      // Compute the outer edge of the grab area (whichever is bigger: task or MIN_HIT)
      var grabHW = Math.max(MIN_HIT, d.hw);
      var grabHH = Math.max(MIN_HIT, d.hh);
      if (my < a.y - grabHH - 5 || my > a.y + grabHH + 5) continue;
      // Handles sit OUTSIDE the grab area
      var rEdge = a.x + grabHW;
      var lEdge = a.x - grabHW;
      if (mx >= rEdge - 2 && mx <= rEdge + HANDLE_ZONE) return { task: a, side: 'right' };
      if (mx >= lEdge - HANDLE_ZONE && mx <= lEdge + 2) return { task: a, side: 'left' };
    }
    return null;
  }

  var resizing = null; // { id, side, startMass, startPosition, startMX }

  canvas.addEventListener('mousedown', function (e) {
    // Grab always wins inside the task. Resize only on outer handles.
    var hit = hitTest(e.clientX, e.clientY);
    var edge = edgeHit(e.clientX, e.clientY);

    // Resize only if we're NOT inside the grab area, OR the task is big
    if (edge && !hit) {
      resizing = {
        id: edge.task.id,
        side: edge.side,
        startMass: edge.task.mass,
        startPosition: edge.task.position,
        startMX: e.clientX,
        startX: edge.task.x
      };
      canvas.style.cursor = 'ew-resize';
      return;
    }

    if (hit) {
      dragging = {
        id: hit.id,
        sx: hit.x, sy: hit.y,
        mx: e.clientX, my: e.clientY,
        moved: false,
        zone: (hit.position !== null && hit.position !== undefined) ? 'river' : 'cloud'
      };
    } else {
      hidePanel();
    }
  });

  canvas.addEventListener('mousemove', function (e) {
    mouseX = e.clientX; mouseY = e.clientY;

    // Resizing
    if (resizing) {
      var deltaPx = e.clientX - resizing.startMX;
      var deltaMins = (deltaPx / PIXELS_PER_HOUR) * 60;
      var a = findTask(resizing.id);
      if (!a) return;

      if (resizing.side === 'right') {
        // Stretch right: keep left edge fixed, grow rightward
        a.mass = Math.max(5, Math.round(resizing.startMass + deltaMins));
        // Shift visual center rightward to keep left edge pinned
        var massDelta = a.mass - resizing.startMass;
        var pxDelta = (massDelta / 60) * PIXELS_PER_HOUR / 2;
        a.x = resizing.startX + pxDelta;
        a.tx = a.x;
      } else {
        // Stretch left: keep right edge fixed, grow leftward
        a.mass = Math.max(5, Math.round(resizing.startMass - deltaMins));
        var massDelta = a.mass - resizing.startMass;
        var pxDelta = (massDelta / 60) * PIXELS_PER_HOUR / 2;
        a.x = resizing.startX - pxDelta;
        a.tx = a.x;
      }
      canvas.style.cursor = 'ew-resize';
      return;
    }

    if (!dragging) {
      // Cursor: resize handles take priority
      var edge = edgeHit(e.clientX, e.clientY);
      if (edge) {
        canvas.style.cursor = 'ew-resize';
      } else {
        canvas.style.cursor = hitTest(e.clientX, e.clientY) ? 'grab' : 'default';
      }
      return;
    }
    var dx = e.clientX - dragging.mx, dy = e.clientY - dragging.my;
    if (!dragging.moved && Math.sqrt(dx*dx + dy*dy) < DRAG_THRESHOLD) return;
    dragging.moved = true;
    canvas.style.cursor = 'grabbing';
    var a = findTask(dragging.id);
    if (a) { a.x = dragging.sx + dx; a.y = dragging.sy + dy; a.tx = a.x; a.ty = a.y; }
  });

  canvas.addEventListener('mouseup', function (e) {
    // Finish resize
    if (resizing) {
      var a = findTask(resizing.id);
      if (a) {
        var newMass = a.mass;
        var massDiffHours = (newMass - resizing.startMass) / 60;
        var updates = { id: resizing.id, mass: newMass };

        // Position = center point. To keep an edge fixed when mass changes,
        // we must shift the center by half the mass delta.
        if (resizing.side === 'right') {
          // Keep LEFT edge fixed: center shifts right by half the growth
          updates.position = resizing.startPosition + massDiffHours / 2;
        } else {
          // Keep RIGHT edge fixed: center shifts left by half the growth
          updates.position = resizing.startPosition - massDiffHours / 2;
        }
        post('put', updates);
      }
      resizing = null;
      canvas.style.cursor = 'default';
      return;
    }

    if (!dragging) return;
    var d = dragging; dragging = null; canvas.style.cursor = 'default';

    if (!d.moved) {
      var a = findTask(d.id);
      if (a) showPanel(a, e.clientX, e.clientY);
      return;
    }

    var a = findTask(d.id);
    if (!a) return;
    var boundary = surfaceY();

    // Convert screen X to hours-from-now: invert hoursToX
    var dropHours = (a.x - W * NOW_X) / PIXELS_PER_HOUR + scrollHours;
    if (d.zone === 'cloud' && a.y > boundary) {
      a.customY = a.y;
      post('move', { id: d.id, position: dropHours });
    } else if (d.zone === 'river' && a.y < boundary) {
      a.customY = a.y;
      post('move', { id: d.id, position: null });
    } else if (d.zone === 'river') {
      a.customY = a.y;
      post('move', { id: d.id, position: dropHours });
    } else {
      a.customY = a.y;
    }
    a.ty = a.y;
  });

  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // ── Quick Add (double-click) ────────────────────────────────────────
  // Double-click empty space → input appears → type name → task created
  // In cloud zone: creates a cloud task. In river zone: creates at that time position.

  var quickAdd = document.getElementById('quick-add');
  var quickAddPos = null; // null = cloud, number = hours from now

  canvas.addEventListener('dblclick', function (e) {
    if (hitTest(e.clientX, e.clientY)) return; // double-clicked a task, ignore

    var sY = surfaceY();
    quickAddPos = (e.clientY > sY)
      ? (e.clientX - W * NOW_X) / PIXELS_PER_HOUR + scrollHours
      : null;

    quickAdd.style.left = (e.clientX - 100) + 'px';
    quickAdd.style.top = (e.clientY - 18) + 'px';
    quickAdd.classList.remove('hidden');
    quickAdd.value = '';
    quickAdd.focus();
  });

  quickAdd.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && quickAdd.value.trim()) {
      var payload = { name: quickAdd.value.trim() };
      if (quickAddPos !== null) payload.position = quickAddPos;
      post('put', payload);
      quickAdd.classList.add('hidden');
      quickAdd.value = '';
    } else if (e.key === 'Escape') {
      quickAdd.classList.add('hidden');
    }
  });

  quickAdd.addEventListener('blur', function () {
    quickAdd.classList.add('hidden');
  });

  // ── The Loop ────────────────────────────────────────────────────────
  // Everything moves like it's underwater.

  function frame(t) {
    requestAnimationFrame(frame);

    var dt = lastTime ? (t - lastTime) / 1000 : 1/60;
    dt = Math.min(dt, 0.1);
    lastTime = t;

    // Spring physics — fluid, damped, organic
    for (var i = 0; i < animTasks.length; i++) {
      var a = animTasks[i];
      if (dragging && dragging.id === a.id && dragging.moved) continue;
      a.vx += (a.tx - a.x) * SPRING_K;
      a.vy += (a.ty - a.y) * SPRING_K;
      a.vx *= DAMPING;
      a.vy *= DAMPING;
      a.x += a.vx;
      a.y += a.vy;
    }

    // Draw the world
    drawWorld(t);
    drawStreaks(dt);
    drawNowLine(t);
    drawTimeMarkers();

    // Sort: fixed first (they're terrain), then by alive (on top)
    var sorted = animTasks.slice().sort(function (a, b) {
      if (a.alive !== b.alive) return a.alive ? 1 : -1;
      if (a.fixed !== b.fixed) return a.fixed ? -1 : 1;
      return 0;
    });

    for (var j = 0; j < sorted.length; j++) {
      var task = sorted[j];
      // Viewport culling — skip river tasks far off-screen
      if (task.position !== null && task.position !== undefined) {
        var screenX = hoursToX(task.position);
        var cullHW = taskStretch(task).hw + 50;
        if (screenX + cullHW < 0 || screenX - cullHW > W) continue;
      }
      drawBlob(task, t);
    }

    drawPastFade();

    // ── Resize indicators ──────────────────────────────────────────
    // Hover: show handle dots on edges. Resizing: show duration + time.

    if (resizing) {
      var ra = findTask(resizing.id);
      if (ra) {
        var re = taskEdges(ra);
        var durLabel = formatDuration(ra.mass);

        // Duration inside the blob
        ctx.font = '600 13px -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.fillText(durLabel, ra.x, ra.y);

        // Time label at the active edge
        if (state) {
          var now = new Date(state.now);
          var edgeHours = resizing.side === 'right'
            ? (ra.position || 0) + ra.mass / 60
            : (ra.position || 0);
          // For left resize, position changes so recalc
          if (resizing.side === 'left') {
            var massDiff = ra.mass - resizing.startMass;
            edgeHours = resizing.startPosition - massDiff / 60;
          }
          var edgeTime = new Date(now.getTime() + edgeHours * 3600000);
          var eh = edgeTime.getHours(), em = edgeTime.getMinutes();
          var eLabel = (eh % 12 || 12) + ':' + (em < 10 ? '0' : '') + em + (eh >= 12 ? 'pm' : 'am');

          var labelX = resizing.side === 'right' ? re.right + 8 : re.left - 8;
          ctx.font = '500 10px -apple-system, system-ui, sans-serif';
          ctx.textAlign = resizing.side === 'right' ? 'left' : 'right';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'rgba(200, 165, 110, 0.7)';
          ctx.fillText(eLabel, labelX, ra.y);
        }

        // Handle dot on active edge
        var dotX = resizing.side === 'right' ? re.right : re.left;
        ctx.beginPath();
        ctx.arc(dotX, ra.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(200, 165, 110, 0.6)';
        ctx.fill();
      }
    } else if (!dragging) {
      // Hover: show handle dots outside the grab area
      var hoverEdge = edgeHit(mouseX, mouseY);
      if (hoverEdge) {
        var hd = taskStretch(hoverEdge.task);
        var grabHW = Math.max(MIN_HIT, hd.hw);
        var dotX = hoverEdge.side === 'right' ? hoverEdge.task.x + grabHW : hoverEdge.task.x - grabHW;
        ctx.beginPath();
        ctx.arc(dotX, hoverEdge.task.y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(200, 165, 110, 0.4)';
        ctx.fill();
        // Small vertical line as grip indicator
        ctx.beginPath();
        ctx.moveTo(dotX, hoverEdge.task.y - 8);
        ctx.lineTo(dotX, hoverEdge.task.y + 8);
        ctx.strokeStyle = 'rgba(200, 165, 110, 0.3)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // ── Drag overlay: show start/end times while moving ──
    if (dragging && dragging.moved) {
      var da = findTask(dragging.id);
      if (da && da.position !== null && da.position !== undefined && state) {
        var dnow = new Date(state.now);
        var dd = taskStretch(da);
        var startHours = (da.x - W * NOW_X) / PIXELS_PER_HOUR + scrollHours;
        var endHours = startHours + da.mass / 60;

        var startTime = new Date(dnow.getTime() + startHours * 3600000);
        var endTime = new Date(dnow.getTime() + endHours * 3600000);

        function fmtDragTime(d) {
          var h = d.getHours(), m = d.getMinutes();
          return (h%12||12) + ':' + (m<10?'0':'') + m + (h>=12?'pm':'am');
        }

        ctx.font = '500 11px -apple-system, system-ui, sans-serif';
        ctx.textBaseline = 'middle';

        // Start time to the left
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(200, 165, 110, 0.7)';
        ctx.fillText(fmtDragTime(startTime), da.x - dd.hw - 8, da.y);

        // End time to the right
        ctx.textAlign = 'left';
        ctx.fillText(fmtDragTime(endTime), da.x + dd.hw + 8, da.y);
      }
    }
  }

  requestAnimationFrame(frame);
})();

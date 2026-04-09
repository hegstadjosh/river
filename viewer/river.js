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
    6: '6 hours', 24: 'day', 72: '3 days',
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
      if (horizonHours <= 72) hzLabel.textContent = 'next 3 days';
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
    // "day" = rest of today (hours until midnight, min 4h)
    // Others are fixed durations
    if (nominal === 24 && state) {
      var now = new Date(state.now);
      var midnight = new Date(now);
      midnight.setHours(23, 59, 59, 999);
      var remaining = (midnight.getTime() - now.getTime()) / 3600000;
      return Math.max(4, remaining);
    }
    return nominal;
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

  hzPrev.addEventListener('click', function () {
    scrollHours -= horizonHours * 0.75;
    scrollVel = 0;
    sync(); updateFrameLabel();
  });

  hzNext.addEventListener('click', function () {
    scrollHours += horizonHours * 0.75;
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

  function blobR(mass) { return Math.sqrt(mass) * BLOB_SCALE; }

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

    // "now" label — small, at the surface
    ctx.fillStyle = 'rgba(200, 165, 110, ' + (0.25 + breath * 0.1) + ')';
    ctx.font = '9px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('now', x, sY + 18);
  }

  // ── Drawing: Time Markers + Division Lines ──────────────────────────
  // Always exactly 3 division lines to the right of now, evenly splitting
  // the horizon into quarters. Labels adapt to the timescale.

  function drawTimeMarkers() {
    if (!state) return;
    var now = new Date(state.now);
    var sY = surfaceY();
    var futureW = W * (1 - NOW_X) - 30;
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    // ── 3 division lines, splitting the visible window ──
    // They divide the viewport's river portion into quarters
    var viewStartHours = scrollHours;
    var viewEndHours = scrollHours + horizonHours;
    for (var q = 1; q <= 3; q++) {
      var divHours = viewStartHours + horizonHours * q / 4;
      var divX = hoursToX(divHours);
      var divTime = new Date(now.getTime() + divHours * 3600000);

      // Vertical line — thinner and fainter than now-line
      ctx.beginPath();
      ctx.moveTo(divX, sY + 10);
      ctx.lineTo(divX, H);
      ctx.strokeStyle = 'rgba(200, 165, 110, 0.08)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Label for this division
      var label = formatTime(divTime, divHours);
      ctx.font = '9px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(200, 165, 110, 0.25)';
      ctx.fillText(label, divX, H - 10);
    }

    // ── Finer tick marks between divisions ──
    // Pick a sub-step that gives ~4-8 ticks per quarter
    var quarterHours = horizonHours / 4;
    var subStepCandidates = [0.5, 1, 2, 3, 4, 6, 12, 24, 48, 168, 720];
    var subStep = 1;
    for (var c = 0; c < subStepCandidates.length; c++) {
      subStep = subStepCandidates[c];
      var ticksPerQuarter = quarterHours / subStep;
      if (ticksPerQuarter <= 8) break;
    }

    var subStepMs = subStep * 3600000;
    var viewStartMs = now.getTime() + scrollHours * 3600000;
    var viewEndMs = now.getTime() + (scrollHours + horizonHours) * 3600000;
    var startMs = Math.floor(viewStartMs / subStepMs) * subStepMs - subStepMs;

    ctx.font = '8px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';

    for (var ms = startMs; ms < viewEndMs + subStepMs; ms += subStepMs) {
      var hrs = (ms - now.getTime()) / 3600000;
      var x = hoursToX(hrs);
      if (x < 5 || x > W - 5) continue;

      // Skip if too close to a division line
      var nearDiv = false;
      for (var dq = 1; dq <= 3; dq++) {
        if (Math.abs(x - hoursToX(viewStartHours + horizonHours * dq / 4)) < 25) {
          nearDiv = true; break;
        }
      }
      if (nearDiv) continue;

      // Small tick
      ctx.beginPath();
      ctx.moveTo(x, H - 3);
      ctx.lineTo(x, H);
      ctx.strokeStyle = 'rgba(200, 165, 110, 0.06)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Sub-label (only if there's room — skip if PIXELS_PER_HOUR is tiny)
      if (subStep * PIXELS_PER_HOUR > 30) {
        var st = new Date(ms);
        var subLabel = formatTime(st, hrs);
        ctx.fillStyle = 'rgba(200, 165, 110, 0.12)';
        ctx.fillText(subLabel, x, H - 8);
      }
    }
  }

  // Format a date for display — always clean, never "11:21pm"
  function formatTime(date) {
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    var h = date.getHours(), m = date.getMinutes();
    var ampm = h >= 12 ? 'pm' : 'am';
    var dh = h % 12 || 12;

    if (horizonHours <= 6) {
      // "2pm", "2:30pm" — show :30 but not :21
      if (m === 0) return dh + ampm;
      if (m === 30) return dh + ':30' + ampm;
      return dh + ':' + (m < 10 ? '0' : '') + m + ampm;
    } else if (horizonHours <= 24) {
      return dh + ampm;
    } else if (horizonHours <= 168) {
      // "Wed", "Thu 9", showing day name
      if (h === 0 && m === 0) return days[date.getDay()];
      return days[date.getDay()] + ' ' + dh + (ampm === 'am' ? 'a' : 'p');
    } else if (horizonHours <= 2160) {
      return months[date.getMonth()] + ' ' + date.getDate();
    } else {
      return months[date.getMonth()] + ' \u2019' + (date.getFullYear() % 100);
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

  function drawBlob(a, t) {
    var r = blobR(a.mass);
    var hue = tagHue(a.tags);
    var sol = a.solidity;
    var x = a.x, y = a.y;

    // Is anything alive? If so, non-alive tasks dim.
    var anyAlive = false;
    for (var i = 0; i < animTasks.length; i++) {
      if (animTasks[i].alive) { anyAlive = true; break; }
    }
    var dim = (anyAlive && !a.alive) ? 0.55 : 1.0;

    // Alive: grow, intensify
    if (a.alive) r *= 1.35;

    // Duration-based horizontal stretch for river tasks
    // At low solidity: circular (stretch = 1). At high: width = actual duration.
    var stretch = 1;
    if (a.position !== null && a.position !== undefined && sol > 0.3) {
      var durationPx = (a.mass / 60) * PIXELS_PER_HOUR;
      var targetStretch = Math.max(1, durationPx / (r * 2));
      stretch = 1 + (targetStretch - 1) * Math.min(1, (sol - 0.3) / 0.6);
    }

    // Fixed tasks → rock (always show full duration)
    if (a.fixed) {
      var rockStretch = Math.max(1, ((a.mass / 60) * PIXELS_PER_HOUR) / (r * 2));
      drawRock(x, y, r, rockStretch, a, dim, t);
      return;
    }

    // Solidity → visual parameters
    var alpha = (0.2 + sol * 0.75) * dim;          // 0.2 – 0.95
    var blur = Math.max(0, (1 - sol) * 10);         // 0 – 10px
    var sat = 30 + sol * 45;                         // 30 – 75%
    var lit = 40 + sol * 18;                         // 40 – 58%

    // For past tasks (position < 0), desaturate and cool
    var isPast = (a.position !== null && a.position < 0);
    if (isPast) {
      sat *= 0.4;
      hue = hue * 0.5 + 210 * 0.5; // shift toward blue-gray
      alpha *= Math.max(0.1, 1 + a.position * 0.3); // fade over ~3 hours
    }

    ctx.save();

    // Alive glow — pulses with the now-line
    if (a.alive) {
      var breath = Math.sin(t / 4000 * Math.PI * 2) * 0.5 + 0.5;
      var gr = r * 2.0 + breath * r * 0.4;
      var gg = ctx.createRadialGradient(x, y, r * 0.5, x, y, gr);
      gg.addColorStop(0, 'hsla(' + hue + ',' + sat + '%,' + lit + '%,0.18)');
      gg.addColorStop(1, 'hsla(' + hue + ',' + sat + '%,' + lit + '%,0)');
      ctx.fillStyle = gg;
      ctx.beginPath();
      ctx.ellipse(x, y, gr, gr * 0.85, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Apply blur for softer blobs
    if (blur > 1.5) ctx.filter = 'blur(' + blur.toFixed(1) + 'px)';

    // The blob: 3 overlapping ellipses, slightly offset
    // `stretch` widens them horizontally as solidity increases (blob → time block)
    var scatter = Math.max(0, 1 - sol * 1.2); // organic scatter decreases with solidity
    var layers = [
      { dx: 0,                     dy: 0,                     rx: r * stretch,        ry: r * 0.85, rot: 0,                a: alpha },
      { dx: r * 0.1 * scatter,     dy: -r * 0.07 * scatter,   rx: r * 0.9 * stretch,  ry: r * 0.92, rot: 0.15 * scatter,  a: alpha * 0.65 },
      { dx: -r * 0.07 * scatter,   dy: r * 0.09 * scatter,    rx: r * 0.82 * stretch, ry: r * 0.78, rot: -0.1 * scatter,  a: alpha * 0.45 }
    ];

    for (var li = 0; li < layers.length; li++) {
      var L = layers[li];
      var cx = x + L.dx, cy = y + L.dy;
      var maxR = Math.max(L.rx, L.ry);
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);

      // Inner: warm and present. Outer: fades to nothing.
      g.addColorStop(0,   'hsla(' + hue + ',' + sat + '%,' + lit + '%,' + L.a + ')');
      g.addColorStop(0.5, 'hsla(' + hue + ',' + (sat * 0.8) + '%,' + (lit * 0.9) + '%,' + (L.a * 0.6) + ')');
      g.addColorStop(0.8, 'hsla(' + hue + ',' + (sat * 0.6) + '%,' + (lit * 0.8) + '%,' + (L.a * 0.2) + ')');
      g.addColorStop(1,   'hsla(' + hue + ',' + sat + '%,' + lit + '%,0)');

      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx, cy, L.rx, L.ry, L.rot, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.filter = 'none';

    // Selection indicator — soft dashed ring
    if (selectedId === a.id) {
      ctx.beginPath();
      ctx.ellipse(x, y, r * stretch + 6, r * 0.85 + 6, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(200, 165, 110, 0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();

    // Label — always legible, positioned inside or below depending on size
    var fontSize = Math.max(11, Math.min(14, r * 0.4));
    var labelA = Math.min(0.9, (sol * 0.6 + 0.3)) * dim;
    ctx.font = (sol > 0.6 ? '600 ' : '400 ') + fontSize + 'px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(215, 200, 180, ' + labelA.toFixed(3) + ')';

    // For small blobs, render label below instead of inside
    var nameW = ctx.measureText(a.name).width;
    if (nameW < r * stretch * 2) {
      ctx.fillText(a.name, x, y);
    } else {
      ctx.fillText(a.name, x, y + r + fontSize + 2);
    }
  }

  // ── Drawing: Rocks ──────────────────────────────────────────────────
  // Fixed tasks. The geology of your day. Immovable. Geometric.
  // Rounded rectangles with a stone texture — warm grays, subtle bevel.
  // The river flows around them; they don't flow with it.

  function drawRock(x, y, r, rockStretch, a, dim, t) {
    var w = r * 2.0 * rockStretch;
    var h = r * 1.3;
    var cr = 8;
    var alpha = 0.9 * dim;

    ctx.save();

    // Shadow — rocks have weight
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;

    // Stone body
    var sg = ctx.createLinearGradient(x, y - h/2, x, y + h/2);
    sg.addColorStop(0,   'rgba(155, 145, 128, ' + alpha + ')');
    sg.addColorStop(0.4, 'rgba(135, 125, 110, ' + alpha + ')');
    sg.addColorStop(1,   'rgba(110, 102, 88, '  + alpha + ')');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.roundRect(x - w/2, y - h/2, w, h, cr);
    ctx.fill();

    ctx.shadowColor = 'transparent';

    // Top bevel — light catching the edge
    var bg = ctx.createLinearGradient(x, y - h/2, x, y - h/2 + 8);
    bg.addColorStop(0, 'rgba(255, 255, 255, 0.1)');
    bg.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(x - w/2, y - h/2, w, 8, [cr, cr, 0, 0]);
    ctx.fill();

    // Bottom shadow — depth
    var bs = ctx.createLinearGradient(x, y + h/2 - 6, x, y + h/2);
    bs.addColorStop(0, 'rgba(0, 0, 0, 0)');
    bs.addColorStop(1, 'rgba(0, 0, 0, 0.08)');
    ctx.fillStyle = bs;
    ctx.beginPath();
    ctx.roundRect(x - w/2, y + h/2 - 6, w, 6, [0, 0, cr, cr]);
    ctx.fill();

    // Subtle border
    ctx.strokeStyle = 'rgba(180, 170, 155, ' + (0.15 * dim) + ')';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.roundRect(x - w/2, y - h/2, w, h, cr);
    ctx.stroke();

    // Selection
    if (selectedId === a.id) {
      ctx.beginPath();
      ctx.roundRect(x - w/2 - 5, y - h/2 - 5, w + 10, h + 10, cr + 3);
      ctx.strokeStyle = 'rgba(200, 165, 110, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();

    // Label — always crisp on rocks
    var fontSize = Math.max(11, Math.min(14, r * 0.32));
    ctx.fillStyle = 'rgba(235, 225, 210, ' + (0.9 * dim) + ')';
    ctx.font = '600 ' + fontSize + 'px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(a.name, x, y);
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

  function hitTest(mx, my) {
    for (var i = animTasks.length - 1; i >= 0; i--) {
      var a = animTasks[i];
      var r = blobR(a.mass) * (a.alive ? 1.35 : 1.0);
      // Account for horizontal stretch
      var s = 1;
      if (a.position !== null && a.position !== undefined) {
        var dpx = (a.mass / 60) * PIXELS_PER_HOUR;
        s = Math.max(1, dpx / (r * 2));
        if (!a.fixed && a.solidity <= 0.3) s = 1;
      }
      var hw = r * s + 5, hh = r * 0.85 + 5;
      if (Math.abs(mx - a.x) <= hw && Math.abs(my - a.y) <= hh) return a;
    }
    return null;
  }

  // ── Panel ───────────────────────────────────────────────────────────

  var panel = document.getElementById('panel');
  var panelName = document.getElementById('panel-name');
  var panelDurations = document.getElementById('panel-durations');
  var durBtns = document.querySelectorAll('.dur-btn');
  var panelSolidity = document.getElementById('panel-solidity');
  var panelFixed = document.getElementById('panel-fixed');
  var panelDissolve = document.getElementById('panel-dissolve');

  function showPanel(a, sx, sy) {
    selectedId = a.id;
    panelName.value = a.name;
    // Highlight matching duration button
    durBtns.forEach(function (b) {
      b.classList.toggle('active', Number(b.dataset.mass) === a.mass);
    });
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
  durBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!selectedId) return;
      durBtns.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      post('put', { id: selectedId, mass: Number(btn.dataset.mass) });
    });
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

  canvas.addEventListener('mousedown', function (e) {
    var hit = hitTest(e.clientX, e.clientY);
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
    if (!dragging) {
      canvas.style.cursor = hitTest(e.clientX, e.clientY) ? 'grab' : 'default';
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
      a.customY = a.y; // persist vertical position
      post('move', { id: d.id, position: dropHours });
    } else if (d.zone === 'river' && a.y < boundary) {
      a.customY = a.y; // persist in cloud too
      post('move', { id: d.id, position: null });
    } else if (d.zone === 'river') {
      a.customY = a.y; // persist vertical position
      post('move', { id: d.id, position: dropHours });
    } else {
      // Cloud → Cloud: just persist the Y
      a.customY = a.y;
    }
    // Update target to where it was dropped (keep Y, let X snap to data)
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
        var r = blobR(task.mass) * 2;
        if (screenX + r < -50 || screenX - r > W + 50) continue;
      }
      drawBlob(task, t);
    }

    drawPastFade();
  }

  requestAnimationFrame(frame);
})();

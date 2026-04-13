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

// Namespace init — all other files attach to window.River
window.River = {};

(function () {
  'use strict';

  var R = window.River;

  // ── World Constants ─────────────────────────────────────────────────

  R.PIXELS_PER_HOUR = 0;  // set by horizon selector
  R.horizonHours = 24;    // default: day view
  R.scrollHours = 0;      // horizontal scroll offset (hours from now)
  R.scrollVel = 0;        // scroll momentum (hours/sec)
  R.CLOUD_RATIO = 0.30;         // top 30% is cloud (sky)
  R.SURFACE_RATIO = 0.35;       // the river surface starts here
  R.NOW_X = 0.25;               // now-line at 25% from left
  R.BLOB_SCALE = 4.0;           // radius = sqrt(mass) * scale
  R.SPRING_K = 0.06;            // spring stiffness (lower = more fluid)
  R.DAMPING = 0.78;             // spring damping (higher = more viscous)
  R.DRAG_THRESHOLD = 5;
  R.SNAP_ZONE = 8;
  R.MIN_HIT = 15;               // minimum grab area radius
  R.HANDLE_ZONE = 14;
  R.NUM_STREAKS = 20;

  // ── Palette ─────────────────────────────────────────────────────────
  R.SKY_COLOR    = '#17161a';  // cool dark — a night sky
  R.WATER_TOP    = '#231e19';  // warm dark — shallow water
  R.WATER_DEEP   = '#1e1a15';  // slightly deeper
  R.SURFACE_GLOW = 'rgba(200, 165, 110, 0.06)'; // where light hits water
  R.AMBER        = [200, 165, 110]; // the color of the now-light

  // ── State ───────────────────────────────────────────────────────────

  R.state = null;
  R.tasks = [];
  R.planMode = false;
  R.planLanes = [];
  R.planWindowStart = null;
  R.planWindowEnd = null;
  R.selectedId = null;
  R.selectedIds = [];
  R.isSelected = function (id) { return R.selectedIds.indexOf(id) >= 0; };
  R.dragging = null;
  R.resizing = null;
  R.lastTime = 0;
  R.mouseX = 0;
  R.mouseY = 0;
  R.snapTimesMs = [];    // major + minor grid times, updated each frame

  // Flow streaks — the river's current
  R.streaks = [];

  // ── Horizon Bar Constants ───────────────────────────────────────────
  R.FRAME_LABELS = {
    6: '6 hours', 24: 'day', 96: '4 days',
    168: 'week', 720: 'month', 2160: 'quarter', 8760: 'year'
  };

  // ── Canvas ──────────────────────────────────────────────────────────

  R.canvas = document.getElementById('river-canvas');
  R.ctx = R.canvas.getContext('2d');
  R.W = 0;
  R.H = 0;
  R.dpr = 1;

  // ── Utility ─────────────────────────────────────────────────────────

  // findTask is now in river-store.js

  R.authToken = null;

  R.authHeaders = function () {
    var token = R.authToken || window._riverAuthToken;
    var h = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
  };

  // ── Supabase helpers ───────────────────────────────────────────
  R.sb = function () { return window._riverSB; };
  R.userId = function () { return window._riverUserId; };
  R.timelineId = function () { return window._riverTimelineId; };

  R.positionToAnchor = function (pos) {
    return new Date(Date.now() + pos * 3600000).toISOString();
  };

  R.anchorToPosition = function (anchor) {
    return (new Date(anchor).getTime() - Date.now()) / 3600000;
  };

  // ── Direct Supabase operations ─────────────────────────────────
  // CRUD goes direct to Supabase (no API route, no cold start).
  // Plan operations still go through /api/state (multi-step transactions).

  var PLAN_ACTIONS = {
    plan_start: 1, plan_end: 1, plan_commit: 1,
    plan_lane_put: 1, plan_to_cloud: 1, plan_add: 1,
    plan_move: 1, plan_copy: 1,
  };

  R.post = function (action, data, optimisticFn) {
    if (optimisticFn) {
      try { optimisticFn(R.tasks); } catch (e) { console.error('optimistic', e); }
    }

    // Plan operations go through API route (need server-side transactions)
    if (PLAN_ACTIONS[action]) {
      fetch('/api/state', {
        method: 'POST', headers: R.authHeaders(),
        body: JSON.stringify(Object.assign({ action: action }, data))
      }).then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.river !== undefined) { R.state = d; R.sync(); }
        }).catch(function () {});
      return;
    }

    // CRUD goes direct to Supabase
    var sb = R.sb();
    var uid = R.userId();
    var tid = R.timelineId();
    if (!sb || !uid || !tid) {
      // Fallback to API route if Supabase client not ready
      fetch('/api/state', {
        method: 'POST', headers: R.authHeaders(),
        body: JSON.stringify(Object.assign({ action: action }, data))
      }).catch(function () {});
      return;
    }

    switch (action) {
      case 'put':
        var anchor = data.position !== undefined
          ? (data.position === null ? null : R.positionToAnchor(data.position))
          : undefined;
        if (data.id) {
          var updates = {};
          if (data.name !== undefined) updates.name = data.name;
          if (data.mass !== undefined) updates.mass = data.mass;
          if (anchor !== undefined) updates.anchor = anchor;
          if (data.solidity !== undefined) updates.solidity = data.solidity;
          if (data.energy !== undefined) updates.energy = data.energy;
          if (data.fixed !== undefined) updates.fixed = data.fixed;
          if (data.alive !== undefined) updates.alive = data.alive;
          if (data.tags !== undefined) updates.tags = data.tags;
          if (data.cloud_x !== undefined) updates.cloud_x = data.cloud_x;
          if (data.cloud_y !== undefined) updates.cloud_y = data.cloud_y;
          if (data.river_y !== undefined) updates.river_y = data.river_y;
          sb.from('tasks').update(updates)
            .eq('id', data.id).eq('user_id', uid).eq('timeline_id', tid)
            .then(function () {});
        } else {
          sb.from('tasks').insert({
            id: crypto.randomUUID(), user_id: uid, timeline_id: tid,
            name: data.name || 'untitled', mass: data.mass || 30,
            anchor: anchor || null, solidity: data.solidity || 0.1,
            energy: data.energy || 0.5, fixed: data.fixed || false,
            alive: data.alive || false, tags: data.tags || [],
            created: new Date().toISOString(),
            cloud_x: data.cloud_x || null, cloud_y: data.cloud_y || null,
            river_y: data.river_y || null
          }).then(function () {});
        }
        break;
      case 'move':
        var moveAnchor = data.position === null ? null : R.positionToAnchor(data.position);
        sb.from('tasks').update({ anchor: moveAnchor })
          .eq('id', data.id).eq('user_id', uid).eq('timeline_id', tid)
          .then(function () {});
        break;
      case 'delete':
        sb.from('tasks').delete()
          .eq('id', data.id).eq('user_id', uid).eq('timeline_id', tid)
          .then(function () {});
        break;
      case 'tag_create':
        sb.from('meta').select('value').eq('user_id', uid).eq('key', 'known_tags').single()
          .then(function (r) {
            var tags = r.data ? JSON.parse(r.data.value) : [];
            if (tags.indexOf(data.name) < 0) {
              tags.push(data.name);
              sb.from('meta').upsert({ user_id: uid, key: 'known_tags', value: JSON.stringify(tags) })
                .then(function () {});
            }
          });
        break;
      case 'plan_update_task':
        var lBranchP = sb.from('timelines').select('id')
          .eq('user_id', uid).eq('name', '_plan_lane_' + (data.lane + 1)).single();
        lBranchP.then(function (r) {
          if (!r.data) return;
          var patch = {};
          if (data.mass !== undefined) patch.mass = data.mass;
          if (data.solidity !== undefined) patch.solidity = data.solidity;
          if (data.energy !== undefined) patch.energy = data.energy;
          if (data.position !== undefined) patch.anchor = R.positionToAnchor(data.position);
          sb.from('tasks').update(patch)
            .eq('id', data.task_id).eq('user_id', uid).eq('timeline_id', r.data.id)
            .then(function () {});
        });
        break;
      case 'plan_reposition':
        var rpBranch = sb.from('timelines').select('id')
          .eq('user_id', uid).eq('name', '_plan_lane_' + (data.lane + 1)).single();
        rpBranch.then(function (r) {
          if (!r.data) return;
          sb.from('tasks').update({ anchor: R.positionToAnchor(data.position) })
            .eq('id', data.task_id).eq('user_id', uid).eq('timeline_id', r.data.id)
            .then(function () {});
        });
        break;
      case 'plan_remove':
        var rmBranch = sb.from('timelines').select('id')
          .eq('user_id', uid).eq('name', '_plan_lane_' + (data.lane + 1)).single();
        rmBranch.then(function (r) {
          if (!r.data) return;
          sb.from('tasks').delete()
            .eq('id', data.task_id).eq('user_id', uid).eq('timeline_id', r.data.id)
            .then(function () {});
        });
        break;
    }
  };

})();
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
// viewer/river-render.js — world drawing, streaks (with initStreaks), now line, past fade
(function () {
  'use strict';

  var R = window.River;

  // ── Flow Streaks Init ──────────────────────────────────────────────

  R.initStreaks = function () {
    R.streaks = [];
    var sY = R.surfaceY();
    for (var i = 0; i < R.NUM_STREAKS; i++) {
      R.streaks.push({
        x: Math.random() * R.W * 1.5,
        y: sY + 20 + Math.random() * (R.H - sY - 40),
        len: 60 + Math.random() * 180,
        speed: 8 + Math.random() * 25,
        alpha: 0.015 + Math.random() * 0.04 // 1.5-5.5% — perceptible but quiet
      });
    }
  };

  // ── Drawing: The World ──────────────────────────────────────────────

  R.drawWorld = function (t) {
    var ctx = R.ctx;
    var sY = R.surfaceY();

    // Sky — cool, dark, still
    ctx.fillStyle = R.SKY_COLOR;
    ctx.fillRect(0, 0, R.W, sY);

    // Water — warm, deep
    var waterGrad = ctx.createLinearGradient(0, sY, 0, R.H);
    waterGrad.addColorStop(0, R.WATER_TOP);
    waterGrad.addColorStop(1, R.WATER_DEEP);
    ctx.fillStyle = waterGrad;
    ctx.fillRect(0, sY, R.W, R.H - sY);

    // The surface — where sky meets water
    // A band of warm light, like sunlight on a river's surface
    var surfGrad = ctx.createLinearGradient(0, sY - 15, 0, sY + 25);
    surfGrad.addColorStop(0, 'rgba(200, 165, 110, 0)');
    surfGrad.addColorStop(0.3, 'rgba(200, 165, 110, 0.04)');
    surfGrad.addColorStop(0.5, 'rgba(200, 165, 110, 0.07)');
    surfGrad.addColorStop(0.7, 'rgba(200, 165, 110, 0.04)');
    surfGrad.addColorStop(1, 'rgba(200, 165, 110, 0)');
    ctx.fillStyle = surfGrad;
    ctx.fillRect(0, sY - 15, R.W, 40);

    // Breathing room: warm wash over the river
    ctx.fillStyle = 'rgba(200, 165, 110, 0.008)';
    ctx.fillRect(0, sY + 25, R.W, R.H - sY - 25);
  };

  // ── Drawing: Flow Streaks ───────────────────────────────────────────

  R.drawStreaks = function (dt) {
    var ctx = R.ctx;
    var sY = R.surfaceY();
    for (var i = 0; i < R.streaks.length; i++) {
      var s = R.streaks[i];
      s.x -= s.speed * dt;
      if (s.x + s.len < 0) {
        s.x = R.W + 20 + Math.random() * 200;
        s.y = sY + 20 + Math.random() * (R.H - sY - 40);
        s.len = 60 + Math.random() * 180;
      }

      // Streaks fade near edges
      var fadeL = Math.min(1, (s.x + s.len) / 100);
      var fadeR = Math.min(1, (R.W - s.x) / 100);
      var fade = fadeL * fadeR;

      ctx.beginPath();
      ctx.moveTo(Math.max(0, s.x), s.y);
      ctx.lineTo(Math.min(R.W, s.x + s.len), s.y);
      ctx.strokeStyle = 'rgba(' + R.AMBER[0] + ',' + R.AMBER[1] + ',' + R.AMBER[2] + ',' + (s.alpha * fade).toFixed(4) + ')';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  };

  // ── Drawing: Now Line ───────────────────────────────────────────────
  // The only pulsing element. A vertical thread of warm light
  // in the river zone. The perceptual anchor. Where you stand.

  R.drawNowLine = function (t) {
    var ctx = R.ctx;
    var x = R.nx();
    // Don't draw if scrolled off screen
    if (x < -40 || x > R.W + 40) return;

    var sY = R.surfaceY();
    var breath = Math.sin(t / 4000 * Math.PI * 2) * 0.5 + 0.5;

    // Glow — a soft wash of amber around the line
    var glowW = 20 + breath * 15;
    var glowGrad = ctx.createLinearGradient(x - glowW, 0, x + glowW, 0);
    glowGrad.addColorStop(0, 'rgba(200, 165, 110, 0)');
    glowGrad.addColorStop(0.5, 'rgba(200, 165, 110, ' + (0.04 + breath * 0.04) + ')');
    glowGrad.addColorStop(1, 'rgba(200, 165, 110, 0)');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(x - glowW, sY, glowW * 2, R.H - sY);

    // The line itself — only in the river
    ctx.beginPath();
    ctx.moveTo(x, sY + 5);
    ctx.lineTo(x, R.H);
    ctx.strokeStyle = 'rgba(200, 165, 110, ' + (0.3 + breath * 0.15) + ')';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // "now" label — at the surface
    ctx.fillStyle = 'rgba(200, 165, 110, ' + (0.3 + breath * 0.15) + ')';
    ctx.font = '500 11px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('now', x, sY + 18);
  };

  // ── Drawing: Past Fade ──────────────────────────────────────────────
  // The leftmost portion of the viewport fades to background.
  // Things behind you dissolve. No record. No judgment.

  R.drawPastFade = function () {
    var ctx = R.ctx;
    var fadeW = R.W * 0.12;
    var sY = R.surfaceY();
    var fg = ctx.createLinearGradient(0, 0, fadeW, 0);
    fg.addColorStop(0, R.SKY_COLOR);
    fg.addColorStop(1, 'rgba(23, 22, 26, 0)');
    ctx.fillStyle = fg;
    ctx.fillRect(0, 0, fadeW, sY);

    var fr = ctx.createLinearGradient(0, 0, fadeW, 0);
    fr.addColorStop(0, R.WATER_DEEP);
    fr.addColorStop(1, 'rgba(30, 26, 21, 0)');
    ctx.fillStyle = fr;
    ctx.fillRect(0, sY, fadeW, R.H - sY);
  };
})();
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
// viewer/river-blobs.js — blob rendering: the unified drawBlob function, colorStops
(function () {
  'use strict';

  var R = window.River;

  // 5 stops defined in RGB, linearly interpolated:
  //   0.00 = dark blue    rgb(35, 50, 90)
  //   0.25 = light blue   rgb(90, 130, 170)
  //   0.50 = gold         rgb(200, 165, 110)  <- matches now-bar exactly
  //   0.75 = mid red      rgb(180, 80, 55)
  //   1.00 = dark red     rgb(140, 40, 35)
  var colorStops = [
    [0,    35,  50,  90],
    [0.25, 90,  130, 170],
    [0.5,  200, 165, 110],
    [0.75, 180, 80,  55],
    [1,    140, 40,  35]
  ];
  R.colorStops = colorStops;

  // ── Drawing: Unified blob rendering ─────────────────────────────────
  // One continuous function. Solidity drives EVERYTHING:
  //   0.0 -> circular wisp, maximum blur, barely visible
  //   0.5 -> forming, widening, coming into focus
  //   0.8 -> crisp rounded rectangle spanning actual duration
  //   1.0 -> sharp time block, full opacity, minimal corner radius
  // "Fixed" just means pinned to a time. Not a different shape.

  R.drawBlob = function (a, t) {
    var ctx = R.ctx;

    // Tag filter — hidden tasks don't render at all
    if (R.isTaskHidden && R.isTaskHidden(a)) return;

    var energy = (a.energy !== undefined && a.energy !== null) ? a.energy : 0.5;
    var sol = a.solidity;
    var x = a.x, y = a.y;

    // Is anything alive? If so, non-alive tasks dim.
    var anyAlive = false;
    for (var i = 0; i < R.tasks.length; i++) {
      if (R.tasks[i].alive) { anyAlive = true; break; }
    }
    var dim = (anyAlive && !a.alive) ? 0.55 : 1.0;

    // ── Dimensions — delegate to taskStretch (handles mobile axis swap) ──
    var _s = R.taskStretch(a);
    var hw = _s.hw, hh = _s.hh;

    // ── Visual parameters ──
    var alpha = (0.2 + sol * 0.75) * dim;
    var blur = Math.max(0, (1 - sol) * 10);

    // Color from energy — RGB interpolation to avoid hue-wheel green.
    var e = Math.max(0, Math.min(1, energy));
    var cr = 200, cg = 165, cb = 110; // default gold
    for (var ci = 0; ci < colorStops.length - 1; ci++) {
      if (e >= colorStops[ci][0] && e <= colorStops[ci+1][0]) {
        var ct = (e - colorStops[ci][0]) / (colorStops[ci+1][0] - colorStops[ci][0]);
        cr = colorStops[ci][1] + (colorStops[ci+1][1] - colorStops[ci][1]) * ct;
        cg = colorStops[ci][2] + (colorStops[ci+1][2] - colorStops[ci][2]) * ct;
        cb = colorStops[ci][3] + (colorStops[ci+1][3] - colorStops[ci][3]) * ct;
        break;
      }
    }
    // Solidity dims the color
    var dimSol = 0.4 + sol * 0.6;
    // Convert to HSL for the existing rendering pipeline
    var rn = cr/255, gn = cg/255, bn = cb/255;
    var cmax = Math.max(rn,gn,bn), cmin = Math.min(rn,gn,bn), delta = cmax - cmin;
    var hue = 0, sat = 0, lit = (cmax + cmin) / 2;
    if (delta > 0) {
      sat = delta / (1 - Math.abs(2 * lit - 1));
      if (cmax === rn) hue = 60 * (((gn - bn) / delta) % 6);
      else if (cmax === gn) hue = 60 * ((bn - rn) / delta + 2);
      else hue = 60 * ((rn - gn) / delta + 4);
      if (hue < 0) hue += 360;
    }
    sat = sat * 100 * dimSol;
    lit = lit * 100;

    // Past tasks: desaturate and cool
    if (a.position !== null && a.position < 0) {
      sat *= 0.4;
      hue = hue * 0.5 + 210 * 0.5;
      alpha *= Math.max(0.1, 1 + a.position * 0.3);
    }

    // Corner radius: fully round at sol=0, tight at sol=1
    var maxCorner = Math.min(hw, hh);
    var cornerR = maxCorner * (1 - sol * 0.85); // round -> 15% of size

    ctx.save();

    // ── Alive glow ──
    if (a.alive) {
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

    var rectness = Math.max(0, Math.min(1, (sol - 0.35) / 0.45)); // 0 at <=0.35, 1 at >=0.8

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
      var fg = (R.isMobile && a.position !== null && a.position !== undefined)
        ? ctx.createLinearGradient(x, y - hh, x, y + hh)
        : ctx.createLinearGradient(x - hw, y, x + hw, y);
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
    if (R.isSelected && R.isSelected(a.id)) {
      ctx.strokeStyle = 'rgba(200, 165, 110, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.roundRect(x - hw - 3, y - hh - 3, (hw + 3) * 2, (hh + 3) * 2, rectness > 0.3 ? 4 : (hw + 3));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();

    // Label — hide during resize
    if (R.resizing && R.resizing.id === a.id) return;

    var fontSize = Math.max(10, Math.min(14, hh * 0.65));
    var labelA = Math.min(0.95, 0.75 + sol * 0.2) * dim;
    ctx.font = (sol > 0.6 ? '600 ' : '400 ') + fontSize + 'px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Color label by tag (N/A or no tags = warm white)
    var labelColor = 'rgba(215, 200, 180, ' + labelA.toFixed(3) + ')';
    if (a.tags && a.tags.length > 0 && a.tags[0] !== 'N/A' && R.tagColor) {
      // Parse the tag color and apply the label alpha
      var tc = R.tagColor(a.tags[0]);
      var m = tc.match(/[\d.]+/g);
      if (m && m.length >= 3) {
        labelColor = 'rgba(' + m[0] + ', ' + m[1] + ', ' + m[2] + ', ' + labelA.toFixed(3) + ')';
      }
    }
    ctx.fillStyle = labelColor;

    var nameW = ctx.measureText(a.name).width;
    if (nameW < hw * 1.8) {
      ctx.fillText(a.name, x, y);
    } else {
      ctx.fillText(a.name, x, y + hh + fontSize + 2);
    }

  };
})();
// viewer/river-plan.js — Plan mode rendering and interaction
// When R.planMode is truthy, the river zone splits into 5 horizontal swim lanes
(function () {
  'use strict';

  var R = window.River;

  // ── Plan Mode State ────────────────────────────────────────────────
  // R.planMode, R.planLanes, R.planWindowStart, R.planWindowEnd — set by R.sync() in river-store.js
  R.planHoverLane = -1;    // which lane the mouse is over (-1 = none)
  R.planStreaks = [];       // per-lane flow streaks (array of arrays)

  // ── Layout Helpers ─────────────────────────────────────────────────

  R.planLaneCount = function () { return 4; };

  R.planRiverTop = function () { return R.surfaceY() + 5; };

  R.planRiverHeight = function () { return R.H - R.planRiverTop() - 30; };

  // Current lane (0) gets 40% of height, rest split evenly
  var CURRENT_LANE_RATIO = 0.33;

  R.planLaneHeight = function (i) {
    var total = R.planRiverHeight();
    if (i === 0 || i === undefined) {
      return i === 0 ? total * CURRENT_LANE_RATIO : total / R.planLaneCount();
    }
    return total * (1 - CURRENT_LANE_RATIO) / (R.planLaneCount() - 1);
  };

  // Returns { top, bottom, midY } for a given lane index
  R.planLaneBounds = function (i) {
    var rTop = R.planRiverTop();
    var total = R.planRiverHeight();
    var currentH = total * CURRENT_LANE_RATIO;
    var otherH = (total - currentH) / (R.planLaneCount() - 1);
    var top, h;
    if (i === 0) {
      top = rTop;
      h = currentH;
    } else {
      top = rTop + currentH + (i - 1) * otherH;
      h = otherH;
    }
    return { top: top, bottom: top + h, midY: top + h / 2 };
  };

  // Which lane is the mouse in? Returns 0-3 or -1 if not in a lane
  R.planLaneAt = function (my) {
    if (!R.planMode) return -1;
    var rTop = R.planRiverTop();
    var rH = R.planRiverHeight();
    if (my < rTop || my > rTop + rH) return -1;
    // Check each lane's bounds
    for (var i = 0; i < R.planLaneCount(); i++) {
      var b = R.planLaneBounds(i);
      if (my >= b.top && my < b.bottom) return i;
    }
    return R.planLaneCount() - 1;
  };


  // ── Per-lane flow streaks ──────────────────────────────────────────

  R.initPlanStreaks = function () {
    R.planStreaks = [];
    for (var lane = 0; lane < R.planLaneCount(); lane++) {
      var streaks = [];
      var bounds = R.planLaneBounds(lane);
      var count = 6; // fewer per lane — subtler
      for (var i = 0; i < count; i++) {
        streaks.push({
          x: Math.random() * R.W * 1.5,
          y: bounds.top + 10 + Math.random() * (bounds.bottom - bounds.top - 20),
          len: 40 + Math.random() * 120,
          speed: 4 + Math.random() * 12, // slower than main river
          alpha: 0.01 + Math.random() * 0.025
        });
      }
      R.planStreaks.push(streaks);
    }
  };

  // ── Drawing: Plan Mode ─────────────────────────────────────────────

  R.drawPlanMode = function (t, dt) {
    if (!R.planMode || R.isMobile) return;
    var ctx = R.ctx;

    // ── Clip to plan window bounds ──
    var now = new Date(R.state.now);
    var wStartH = (new Date(R.planWindowStart).getTime() - now.getTime()) / 3600000;
    var wEndH = (new Date(R.planWindowEnd).getTime() - now.getTime()) / 3600000;
    var wLeftX = R.hoursToX(wStartH);
    var wRightX = R.hoursToX(wEndH);

    ctx.save();
    ctx.beginPath();
    ctx.rect(wLeftX, R.planRiverTop(), wRightX - wLeftX, R.planRiverHeight());
    ctx.clip();

    // ── Draw lane separators (sediment layers) ──
    for (var i = 0; i < R.planLaneCount(); i++) {
      var bounds = R.planLaneBounds(i);
      var isCurrent = (i === 0);
      var isActive = (R.planHoverLane === i);
      var laneData = R.planLanes[i];
      var label = (laneData && laneData.label) ? laneData.label : '';

      // Lane background — current lane slightly brighter
      var bgAlpha = isCurrent ? (isActive ? 0.04 : 0.02) : (isActive ? 0.02 : 0.005);
      ctx.fillStyle = 'rgba(200, 165, 110, ' + bgAlpha + ')';
      var thisLaneH = bounds.bottom - bounds.top;
      ctx.fillRect(wLeftX, bounds.top, wRightX - wLeftX, thisLaneH);

      // Separator line at bottom of lane (except last) — more visible
      if (i < R.planLaneCount() - 1) {
        ctx.beginPath();
        ctx.moveTo(wLeftX, bounds.bottom);
        ctx.lineTo(wRightX, bounds.bottom);
        ctx.strokeStyle = 'rgba(200, 165, 110, ' + (isActive ? 0.25 : 0.15) + ')';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // ── Per-lane flow streaks ──
      if (R.planStreaks[i]) {
        for (var si = 0; si < R.planStreaks[i].length; si++) {
          var s = R.planStreaks[i][si];
          s.x -= s.speed * dt;
          if (s.x + s.len < 0) {
            s.x = R.W + 20 + Math.random() * 200;
            s.y = bounds.top + 10 + Math.random() * (thisLaneH - 20);
            s.len = 40 + Math.random() * 120;
          }
          var fadeL = Math.min(1, (s.x + s.len) / 100);
          var fadeR = Math.min(1, (R.W - s.x) / 100);
          var fade = fadeL * fadeR;

          ctx.beginPath();
          ctx.moveTo(Math.max(0, s.x), s.y);
          ctx.lineTo(Math.min(R.W, s.x + s.len), s.y);
          ctx.strokeStyle = 'rgba(' + R.AMBER[0] + ',' + R.AMBER[1] + ',' + R.AMBER[2] + ',' + (s.alpha * fade).toFixed(4) + ')';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // ── Lane labels on LEFT edge of plan area ──
      ctx.save();
      if (isCurrent) {
        // Current lane: prominent label + left accent bar
        ctx.font = '600 12px -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(200, 165, 110, 0.6)';
        ctx.fillText('current', wLeftX + 12, bounds.midY);
        // Left edge accent bar
        ctx.fillStyle = 'rgba(200, 165, 110, 0.2)';
        ctx.fillRect(wLeftX, bounds.top + 2, 3, thisLaneH - 4);
      } else {
        // Other lanes: number + optional label
        ctx.font = '500 11px -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(200, 165, 110, ' + (isActive ? 0.4 : 0.2) + ')';
        ctx.fillText(label || ('lane ' + (i + 1)), wLeftX + 12, bounds.midY);
      }
      ctx.restore();
    }

    // ── Draw plan tasks (sorted same as normal) ──
    var allLaneTasks = R.laneTasks();
    var sorted = allLaneTasks.slice().sort(function (a, b) {
      if (a.alive !== b.alive) return a.alive ? 1 : -1;
      if (a.fixed !== b.fixed) return a.fixed ? -1 : 1;
      return 0;
    });

    for (var j = 0; j < sorted.length; j++) {
      R.drawBlob(sorted[j], t);
    }

    ctx.restore(); // end plan window clip
  };

  // ── Commit Buttons ─────────────────────────────────────────────────
  // Small "Use this" button at right edge of each non-empty lane

  R.planCommitBtns = []; // cached button rects for hit testing

  R.drawPlanCommitButtons = function (t) {
    if (R.isMobile) return;
    var ctx = R.ctx;
    R.planCommitBtns = [];

    for (var i = 0; i < R.planLaneCount(); i++) {
      var laneData = R.planLanes[i];
      if (!laneData || !laneData.tasks || laneData.tasks.length === 0) continue;

      var bounds = R.planLaneBounds(i);
      var btnW = 68, btnH = 24;
      var btnX = R.W - btnW - 20;
      var btnY = bounds.top + 8;

      R.planCommitBtns.push({ lane: i, x: btnX, y: btnY, w: btnW, h: btnH });

      // Button background
      var isHover = R.mouseX >= btnX && R.mouseX <= btnX + btnW &&
                    R.mouseY >= btnY && R.mouseY <= btnY + btnH;

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(btnX, btnY, btnW, btnH, 6);
      ctx.fillStyle = isHover
        ? 'rgba(180, 70, 50, 0.25)'
        : 'rgba(180, 70, 50, 0.12)';
      ctx.fill();
      ctx.strokeStyle = isHover
        ? 'rgba(180, 70, 50, 0.5)'
        : 'rgba(180, 70, 50, 0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Button text — bright red
      ctx.font = '600 10px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isHover
        ? 'rgba(220, 90, 60, 0.95)'
        : 'rgba(180, 70, 50, 0.7)';
      ctx.fillText('Use lane', btnX + btnW / 2, btnY + btnH / 2);
      ctx.restore();
    }
  };

  // Check if a click hit a commit button
  R.planCommitHitTest = function (mx, my) {
    for (var i = 0; i < R.planCommitBtns.length; i++) {
      var b = R.planCommitBtns[i];
      if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
        return b.lane;
      }
    }
    return -1;
  };

  // ── Plan Window Outline ────────────────────────────────────────────

  R.drawPlanWindowOutline = function (t) {
    if (!R.planWindowStart || !R.planWindowEnd || !R.state) return;
    var ctx = R.ctx;
    var now = new Date(R.state.now);
    var startHours = (new Date(R.planWindowStart).getTime() - now.getTime()) / 3600000;
    var endHours = (new Date(R.planWindowEnd).getTime() - now.getTime()) / 3600000;
    var leftX = R.hoursToX(startHours);
    var rightX = R.hoursToX(endHours);
    var top = R.surfaceY();
    var bottom = R.H;

    ctx.save();
    // Filled tint inside the window (keep warm)
    ctx.fillStyle = 'rgba(200, 165, 110, 0.02)';
    ctx.fillRect(leftX, top, rightX - leftX, bottom - top);
    // Red vertical boundary lines
    ctx.strokeStyle = 'rgba(180, 70, 50, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(leftX, top); ctx.lineTo(leftX, bottom);
    ctx.moveTo(rightX, top); ctx.lineTo(rightX, bottom);
    ctx.stroke();
    // Red dashed lines extend into cloud zone
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.moveTo(leftX, 0); ctx.lineTo(leftX, top);
    ctx.moveTo(rightX, 0); ctx.lineTo(rightX, top);
    ctx.strokeStyle = 'rgba(180, 70, 50, 0.2)';
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  };

  // ── Plan indicator DOM toggle ──────────────────────────────────────

  var planBtn = document.getElementById('plan-btn');
  R._lastPlanIndicatorState = false;

  R.updatePlanIndicator = function () {
    if (R.planMode !== R._lastPlanIndicatorState) {
      R._lastPlanIndicatorState = R.planMode;
      if (planBtn) {
        if (R.planMode) {
          planBtn.textContent = 'exit plan';
          planBtn.classList.add('active');
        } else {
          planBtn.textContent = 'plan';
          planBtn.classList.remove('active');
        }
      }
    }
  };

})();
// viewer/river-store.js — Unified task store
// One array. One findTask. One save path.
// Tasks carry a ctx field: { type: 'main' } or { type: 'lane', lane: N }
(function () {
  'use strict';

  var R = window.River;

  // ── The Store ──────────────────────────────────────────────────────
  R.tasks = [];

  // ── Selectors ──────────────────────────────────────────────────────

  R.findTask = function (id) {
    for (var i = 0; i < R.tasks.length; i++)
      if (R.tasks[i].id === id) return R.tasks[i];
    return null;
  };

  R.mainTasks = function () {
    return R.tasks.filter(function (t) { return t.ctx && t.ctx.type === 'main'; });
  };

  R.riverTasks = function () {
    return R.tasks.filter(function (t) {
      return t.ctx && t.ctx.type === 'main' && t.position !== null && t.position !== undefined;
    });
  };

  R.cloudTasks = function () {
    return R.tasks.filter(function (t) {
      return t.ctx && t.ctx.type === 'main' && (t.position === null || t.position === undefined);
    });
  };

  R.tasksInLane = function (lane) {
    return R.tasks.filter(function (t) { return t.ctx && t.ctx.type === 'lane' && t.ctx.lane === lane; });
  };

  R.laneTasks = function () {
    return R.tasks.filter(function (t) { return t.ctx && t.ctx.type === 'lane'; });
  };

  // ── Save Path ──────────────────────────────────────────────────────
  // Resolves the right HTTP action based on task context.

  R.save = function (taskId, changes) {
    var t = R.findTask(taskId);
    if (!t || !t.ctx) return;

    // Mark dirty — sync will skip overwriting this task until server confirms
    t._dirtyUntil = Date.now() + 3000;

    // Optimistic: apply changes locally NOW
    var optimistic = function () {
      for (var k in changes) { if (changes.hasOwnProperty(k)) t[k] = changes[k]; }
    };

    if (t.ctx.type === 'lane') {
      var payload = { lane: t.ctx.lane, task_id: taskId };
      for (var k in changes) payload[k] = changes[k];
      R.post('plan_update_task', payload, optimistic);
    } else {
      var payload = { id: taskId };
      for (var k in changes) payload[k] = changes[k];
      R.post('put', payload, optimistic);
    }
  };

  R.savePosition = function (taskId, position) {
    var t = R.findTask(taskId);
    if (!t || !t.ctx) return;
    t._dirtyUntil = Date.now() + 3000;

    // Optimistic: update position locally NOW
    var optimistic = function () { t.position = position; };

    if (t.ctx.type === 'lane') {
      R.post('plan_reposition', { lane: t.ctx.lane, task_id: taskId, position: position }, optimistic);
    } else {
      R.post('move', { id: taskId, position: position }, optimistic);
    }
  };

  R.deleteTask = function (taskId) {
    var t = R.findTask(taskId);
    if (!t || !t.ctx) return;

    // Optimistic: remove from local store NOW
    var optimistic = function (tasks) {
      for (var i = tasks.length - 1; i >= 0; i--) {
        if (tasks[i].id === taskId) { tasks.splice(i, 1); break; }
      }
    };

    if (t.ctx.type === 'lane') {
      R.post('plan_remove', { lane: t.ctx.lane, task_id: taskId }, optimistic);
    } else {
      R.post('delete', { id: taskId }, optimistic);
    }
  };

  // ── Cross-context operations ────────────────────────────────────────

  R.moveToCloud = function (taskId, fromLane) {
    R.post('plan_to_cloud', { lane: fromLane, task_id: taskId });
  };

  R.moveToLane = function (taskId, fromLane, toLane, position) {
    R.post('plan_move', { from_lane: fromLane, to_lane: toLane, task_id: taskId, position: position });
  };

  R.copyToLane = function (taskId, toLane, position) {
    R.post('plan_add', { lane: toLane, task_id: taskId, position: position, copy: true });
  };

  R.visibleTasks = function () {
    var base;
    if (R.planMode) {
      // All tasks: lane tasks + cloud tasks + river tasks (visible outside plan window)
      base = R.tasks.slice();
    } else {
      base = R.mainTasks();
    }
    return base.filter(function (t) { return !R.isTaskHidden || !R.isTaskHidden(t); });
  };

  // ── Sync: merge server state into the store ────────────────────────
  // Preserves animation state (x, y, vx, vy) for existing tasks.

  R.sync = function () {
    if (!R.state) return;

    // ── Detect plan mode (disabled on mobile) ──
    var wasPlanMode = R.planMode;
    R.planMode = R.isMobile ? false : !!(R.state.plan && R.state.plan.active !== false);
    R.planWindowStart = R.planMode ? (R.state.plan.window_start || null) : null;
    R.planWindowEnd = R.planMode ? (R.state.plan.window_end || null) : null;

    // Build lane data for plan rendering
    if (R.planMode) {
      R.planLanes = [];
      var lanes = R.state.plan.lanes || [];
      var laneCount = R.planLaneCount ? R.planLaneCount() : 4;
      for (var li = 0; li < laneCount; li++) {
        R.planLanes.push(lanes[li] || { label: '', tasks: [] });
      }
      if (!wasPlanMode && R.initPlanStreaks) R.initPlanStreaks();
    } else {
      R.planLanes = [];
      R.planHoverLane = -1;
    }
    if (R.updatePlanIndicator) R.updatePlanIndicator();

    // ── Build unified task list from server state ──
    var incoming = [];

    // Main tasks (river + cloud)
    var mainAll = (R.state.river || []).concat(R.state.cloud || []);
    for (var i = 0; i < mainAll.length; i++) {
      var t = mainAll[i];
      t.ctx = { type: 'main' };
      incoming.push(t);
    }

    // Plan lane tasks
    if (R.planMode && R.state.plan && R.state.plan.lanes) {
      var planLanes = R.state.plan.lanes;
      for (var li = 0; li < planLanes.length; li++) {
        var laneTasks = planLanes[li].tasks || [];
        for (var ti = 0; ti < laneTasks.length; ti++) {
          var lt = laneTasks[ti];
          lt.ctx = { type: 'lane', lane: li };
          incoming.push(lt);
        }
      }
    }

    // ── Merge into R.tasks, preserving animation state ──
    var incomingMap = {};
    for (var j = 0; j < incoming.length; j++) {
      // Lane tasks need a compound key to avoid ID collisions across lanes
      var key = incoming[j].ctx.type === 'lane'
        ? incoming[j].id + '_L' + incoming[j].ctx.lane
        : incoming[j].id;
      incomingMap[key] = incoming[j];
    }

    // Remove tasks that no longer exist
    R.tasks = R.tasks.filter(function (a) {
      var key = a.ctx && a.ctx.type === 'lane'
        ? a.id + '_L' + a.ctx.lane
        : a.id;
      return incomingMap[key];
    });

    // Build map of existing animated tasks
    var existingMap = {};
    for (var k = 0; k < R.tasks.length; k++) {
      var eKey = R.tasks[k].ctx && R.tasks[k].ctx.type === 'lane'
        ? R.tasks[k].id + '_L' + R.tasks[k].ctx.lane
        : R.tasks[k].id;
      existingMap[eKey] = k;
    }

    // Update existing or add new
    for (var m = 0; m < incoming.length; m++) {
      var src = incoming[m];
      var sKey = src.ctx.type === 'lane'
        ? src.id + '_L' + src.ctx.lane
        : src.id;

      var tgt = computeTarget(src);

      if (existingMap[sKey] !== undefined) {
        var a = R.tasks[existingMap[sKey]];
        // Skip overwriting SERVER data for tasks with unconfirmed local changes
        // But ALWAYS update target position (so scroll works correctly)
        if (a._dirtyUntil && Date.now() < a._dirtyUntil) {
          a.ctx = src.ctx;
          a.tx = tgt.x;
          a.ty = tgt.y;
          continue;
        }
        delete a._dirtyUntil;
        a.name = src.name;
        a.mass = src.mass;
        a.solidity = src.solidity;
        a.energy = src.energy;
        a.fixed = src.fixed;
        a.alive = src.alive;
        a.tags = src.tags;
        a.position = src.position;
        a.anchor = src.anchor;
        a.ctx = src.ctx;
        a.tx = tgt.x;
        a.ty = tgt.y;
      } else {
        // Add new task with initial position at target
        R.tasks.push({
          id: src.id, name: src.name, mass: src.mass, solidity: src.solidity,
          energy: src.energy, fixed: src.fixed, alive: src.alive, tags: src.tags,
          position: src.position, anchor: src.anchor, ctx: src.ctx,
          x: tgt.x, y: tgt.y, tx: tgt.x, ty: tgt.y, vx: 0, vy: 0
        });
      }
    }

    spreadLaneTasks();
    R.rebuildTagBar();
  };

  // After sync, spread overlapping lane tasks vertically
  function spreadLaneTasks() {
    if (!R.planMode || !R.planLaneBounds) return;
    var laneCount = R.planLaneCount ? R.planLaneCount() : 4;
    for (var lane = 0; lane < laneCount; lane++) {
      var tasks = R.tasksInLane(lane);
      if (tasks.length < 2) continue;
      var bounds = R.planLaneBounds(lane);
      var pad = 4;
      var laneH = bounds.bottom - bounds.top - pad * 2;

      // Sort by position (time)
      tasks.sort(function (a, b) { return (a.position || 0) - (b.position || 0); });

      // Find overlap groups — tasks whose time ranges intersect
      var groups = [];
      var cur = [tasks[0]];
      var curEnd = (tasks[0].position || 0) + tasks[0].mass / 60;
      for (var i = 1; i < tasks.length; i++) {
        var tStart = tasks[i].position || 0;
        if (tStart < curEnd) {
          cur.push(tasks[i]);
          curEnd = Math.max(curEnd, tStart + tasks[i].mass / 60);
        } else {
          groups.push(cur);
          cur = [tasks[i]];
          curEnd = tStart + tasks[i].mass / 60;
        }
      }
      groups.push(cur);

      // For each group, spread tasks vertically within the lane
      for (var gi = 0; gi < groups.length; gi++) {
        var g = groups[gi];
        if (g.length === 1) {
          g[0].ty = bounds.midY;
          g[0]._laneSlotH = laneH; // full lane height available
          continue;
        }
        var slotH = laneH / g.length;
        for (var si = 0; si < g.length; si++) {
          g[si].ty = bounds.top + pad + slotH * si + slotH / 2;
          g[si]._laneSlotH = slotH; // constrain blob height to slot
        }
      }
    }
  }

  // Compute target position for a task based on its context
  function computeTarget(t) {
    if (t.ctx.type === 'lane') {
      // Plan lane task — initial center, spreadLaneTasks adjusts after
      var bounds = R.planLaneBounds ? R.planLaneBounds(t.ctx.lane) : { midY: R.H * 0.6 };
      var x = R.hoursToX(t.position || 0);
      return { x: x, y: bounds.midY || R.H * 0.6 };
    } else {
      // Main task — river or cloud
      return (t.position !== null && t.position !== undefined) ? R.riverPos(t) : R.cloudPos(t);
    }
  }

  // ── Tag Filter ──────────────────────────────────────────────────────
  // Tags that are dimmed (filtered out) — tasks with these tags render at low opacity.

  R.hiddenTags = {};  // { tagName: true } — hidden tags (tasks with these don't render)
  R.allTags = [];
  R.allOn = true;     // ALL toggle state

  var TAG_COLORS = [
    'rgba(200, 165, 110, 0.7)',
    'rgba(170, 120, 90, 0.7)',
    'rgba(130, 155, 110, 0.7)',
    'rgba(165, 115, 130, 0.7)',
    'rgba(100, 145, 150, 0.7)',
    'rgba(155, 135, 100, 0.7)',
    'rgba(120, 130, 160, 0.7)',
    'rgba(175, 145, 80, 0.7)',
  ];

  R.tagColor = function (tag) {
    if (tag === 'N/A') return 'rgba(160, 155, 145, 0.5)';
    var h = 0;
    for (var i = 0; i < tag.length; i++) h = ((h * 31) + tag.charCodeAt(i)) >>> 0;
    return TAG_COLORS[h % TAG_COLORS.length];
  };

  function effectiveTags(task) {
    return (task.tags && task.tags.length > 0) ? task.tags : ['N/A'];
  }

  R.isTaskHidden = function (task) {
    var tags = effectiveTags(task);
    for (var i = 0; i < tags.length; i++) {
      if (!R.hiddenTags[tags[i]]) return false;
    }
    return true;
  };

  R.rebuildTagBar = function () {
    // Read persistent tags from server state
    var serverTags = (R.state && R.state.known_tags) ? R.state.known_tags : [];
    var tagSet = {};
    for (var si = 0; si < serverTags.length; si++) tagSet[serverTags[si]] = true;
    // Always include N/A
    tagSet['N/A'] = true;
    var sorted = Object.keys(tagSet).sort(function (a, b) {
      if (a === 'N/A') return -1;
      if (b === 'N/A') return 1;
      return a.localeCompare(b);
    });
    R.allTags = sorted;

    // Check if all are visible
    R.allOn = true;
    for (var ai = 0; ai < R.allTags.length; ai++) {
      if (R.hiddenTags[R.allTags[ai]]) { R.allOn = false; break; }
    }

    var bar = document.getElementById('tag-bar');
    if (!bar) return;
    bar.innerHTML = '';

    // ALL toggle
    var allItem = document.createElement('div');
    allItem.className = 'tag-item' + (R.allOn ? ' active' : ' dimmed');
    allItem.style.setProperty('--tag-color', 'rgba(200, 165, 110, 0.5)');
    var allSwatch = document.createElement('div');
    allSwatch.className = 'tag-swatch';
    allSwatch.style.background = 'rgba(200, 165, 110, 0.4)';
    var allLabel = document.createElement('span');
    allLabel.className = 'tag-label';
    allLabel.textContent = 'all';
    allSwatch.addEventListener('click', function () {
      if (R.allOn) {
        for (var xi = 0; xi < R.allTags.length; xi++) R.hiddenTags[R.allTags[xi]] = true;
      } else {
        R.hiddenTags = {};
      }
      R.rebuildTagBar();
    });
    allItem.appendChild(allSwatch);
    allItem.appendChild(allLabel);
    bar.appendChild(allItem);

    // Tag swatches
    for (var k = 0; k < R.allTags.length; k++) {
      (function (tag) {
        var color = R.tagColor(tag);
        var isHidden = !!R.hiddenTags[tag];

        var item = document.createElement('div');
        item.className = 'tag-item' + (isHidden ? ' dimmed' : ' active');
        item.style.setProperty('--tag-color', color);

        var swatch = document.createElement('div');
        swatch.className = 'tag-swatch';
        swatch.style.background = color;

        var label = document.createElement('span');
        label.className = 'tag-label';
        label.textContent = tag;

        swatch.addEventListener('click', function () {
          if (R.hiddenTags[tag]) { delete R.hiddenTags[tag]; }
          else { R.hiddenTags[tag] = true; }
          R.rebuildTagBar();
        });

        // Double-click label to rename
        label.addEventListener('dblclick', function (e) {
          e.stopPropagation();
          if (tag === 'N/A') return;
          var input = document.createElement('input');
          input.className = 'tag-label-edit';
          input.value = tag;
          input.type = 'text';
          item.replaceChild(input, label);
          input.focus();
          input.select();
          function commit() {
            var newName = input.value.trim();
            if (newName && newName !== tag) {
              for (var ti = 0; ti < R.tasks.length; ti++) {
                var t = R.tasks[ti];
                if (t.tags && t.tags.indexOf(tag) >= 0) {
                  var newTags = t.tags.map(function (x) { return x === tag ? newName : x; });
                  R.save(t.id, { tags: newTags });
                }
              }
              if (R.hiddenTags[tag]) { R.hiddenTags[newName] = true; delete R.hiddenTags[tag]; }
            }
            R.rebuildTagBar();
          }
          input.addEventListener('blur', commit);
          input.addEventListener('keydown', function (ke) {
            if (ke.key === 'Enter') { ke.preventDefault(); input.blur(); }
            if (ke.key === 'Escape') { item.replaceChild(label, input); }
          });
        });

        item.appendChild(swatch);
        item.appendChild(label);
        bar.appendChild(item);
      })(R.allTags[k]);
    }

    // + button — inline popup
    var addBtn = document.createElement('button');
    addBtn.className = 'tag-add';
    addBtn.textContent = '+';
    addBtn.addEventListener('click', function () {
      // Remove existing popup
      var old = document.querySelector('.tag-add-popup');
      if (old) { old.remove(); return; }

      var popup = document.createElement('div');
      popup.className = 'tag-add-popup';
      var rect = addBtn.getBoundingClientRect();
      popup.style.left = rect.left + 'px';
      popup.style.top = (rect.bottom + 4) + 'px';
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.placeholder = 'tag name';
      popup.appendChild(inp);
      document.body.appendChild(popup);
      inp.focus();

      function finish() {
        var name = inp.value.trim();
        if (name) {
          R.post('tag_create', { name: name });
        }
        popup.remove();
      }
      inp.addEventListener('keydown', function (ke) {
        if (ke.key === 'Enter') finish();
        if (ke.key === 'Escape') popup.remove();
      });
      inp.addEventListener('blur', function () { setTimeout(function () { popup.remove(); }, 100); });
    });
    bar.appendChild(addBtn);

    // Also rebuild panel tag checks if panel is open
    if (R.selectedId) R.rebuildPanelTags();
  };

  // Panel tag checkboxes — small colored dots you click to toggle
  R.rebuildPanelTags = function () {
    var container = document.getElementById('panel-tags');
    if (!container) return;
    container.innerHTML = '';

    var isMulti = R.selectedIds.length > 1;
    var tasks = [];
    for (var k = 0; k < R.selectedIds.length; k++) {
      var tk = R.findTask(R.selectedIds[k]);
      if (tk) tasks.push(tk);
    }
    if (!tasks.length) return;

    var unionTags = [];
    if (isMulti) {
      for (var u = 0; u < tasks.length; u++) {
        var tt = tasks[u].tags || [];
        for (var v = 0; v < tt.length; v++) {
          if (unionTags.indexOf(tt[v]) < 0) unionTags.push(tt[v]);
        }
      }
    } else {
      unionTags = (tasks[0].tags || []).slice();
    }

    for (var i = 0; i < R.allTags.length; i++) {
      (function (tag) {
        if (tag === 'N/A') return;
        var hasTag = unionTags.indexOf(tag) >= 0;
        var check = document.createElement('div');
        check.className = 'panel-tag-check' + (hasTag ? '' : ' off');
        var dot = document.createElement('div');
        dot.className = 'panel-tag-dot';
        dot.style.background = R.tagColor(tag);
        var name = document.createElement('span');
        name.className = 'panel-tag-name';
        name.textContent = tag;
        check.appendChild(dot);
        check.appendChild(name);
        check.addEventListener('click', function () {
          for (var m = 0; m < tasks.length; m++) {
            var tags = (tasks[m].tags || []).slice();
            var idx = tags.indexOf(tag);
            if (hasTag) {
              if (idx >= 0) tags.splice(idx, 1);
            } else {
              if (idx < 0) tags.push(tag);
            }
            R.save(tasks[m].id, { tags: tags });
            tasks[m].tags = tags;
          }
          R.rebuildPanelTags();
        });
        container.appendChild(check);
      })(R.allTags[i]);
    }
  };

  // ── Direct Supabase fetch (no API route, no cold start) ─────────

  R.fetchState = function () {
    var sb = window._riverSB;
    var uid = window._riverUserId;
    if (!sb || !uid) {
      // Fallback: API route (before Supabase client is ready)
      fetch('/api/state', { headers: R.authHeaders() })
        .then(function (r) { return r.json(); })
        .then(function (d) { R.state = d; R.sync(); })
        .catch(function () {});
      return;
    }

    // Get timeline ID (cached or from meta)
    var tidPromise;
    if (window._riverTimelineId) {
      tidPromise = Promise.resolve(window._riverTimelineId);
    } else {
      tidPromise = sb.from('meta').select('value')
        .eq('user_id', uid).eq('key', 'current_timeline_id').single()
        .then(function (r) {
          var id = r.data ? r.data.value : null;
          window._riverTimelineId = id;
          return id;
        });
    }

    tidPromise.then(function (tid) {
      if (!tid) return;
      var now = new Date();
      var nowIso = now.toISOString();

      // All queries in parallel — direct to Supabase
      Promise.all([
        sb.from('tasks').select('*').eq('user_id', uid).eq('timeline_id', tid)
          .not('anchor', 'is', null).order('anchor', { ascending: true }),
        sb.from('tasks').select('*').eq('user_id', uid).eq('timeline_id', tid)
          .is('anchor', null),
        sb.from('meta').select('value').eq('user_id', uid).eq('key', 'known_tags').maybeSingle(),
        sb.from('meta').select('value').eq('user_id', uid).eq('key', 'plan_mode').maybeSingle(),
        sb.from('meta').select('value').eq('user_id', uid).eq('key', 'plan_window_start').maybeSingle(),
        sb.from('meta').select('value').eq('user_id', uid).eq('key', 'plan_window_end').maybeSingle(),
      ]).then(function (results) {
        var riverRows = results[0].data || [];
        var cloudRows = results[1].data || [];
        var knownTagsRaw = results[2].data ? results[2].data.value : null;
        var planActive = results[3].data && results[3].data.value === 'true';
        var planWinStart = results[4].data ? results[4].data.value : null;
        var planWinEnd = results[5].data ? results[5].data.value : null;

        // Compute positions client-side
        function withPos(t) {
          t.position = t.anchor ? (new Date(t.anchor).getTime() - Date.now()) / 3600000 : null;
          t.tags = t.tags || [];
          return t;
        }

        var river = riverRows.map(withPos);
        var cloud = cloudRows.map(withPos);

        // Breathing room
        var endOf4h = new Date(now.getTime() + 4 * 3600000);
        var endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);
        var usedNext4h = river.filter(function (t) {
          return t.anchor && new Date(t.anchor) >= now && new Date(t.anchor) <= endOf4h;
        }).reduce(function (s, t) { return s + t.mass; }, 0);
        var usedRoD = river.filter(function (t) {
          return t.anchor && new Date(t.anchor) >= now && new Date(t.anchor) <= endOfDay;
        }).reduce(function (s, t) { return s + t.mass; }, 0);
        var minsToEoD = (endOfDay.getTime() - now.getTime()) / 60000;

        var state = {
          river: river, cloud: cloud,
          breathing_room: { next_4h: Math.max(0, 240 - usedNext4h), rest_of_day: Math.max(0, minsToEoD - usedRoD) },
          now: nowIso, timeline: 'main',
          known_tags: knownTagsRaw ? JSON.parse(knownTagsRaw).sort() : [],
        };

        // Plan state — IMPORTANT: only call R.sync() ONCE, after all data is ready
        if (planActive) {
          // Fetch lane tasks in parallel
          var laneNums = [1, 2, 3, 4];
          var lanePromises = laneNums.map(function (n) {
            return sb.from('timelines').select('id')
              .eq('user_id', uid).eq('name', '_plan_lane_' + n).maybeSingle()
              .then(function (r) {
                if (!r.data) return null;
                return Promise.all([
                  sb.from('tasks').select('*').eq('user_id', uid).eq('timeline_id', r.data.id),
                  sb.from('meta').select('value').eq('user_id', uid).eq('key', 'plan_lane_' + n + '_label').maybeSingle(),
                ]).then(function (lr) {
                  return {
                    number: n, label: lr[1].data ? lr[1].data.value : null,
                    taskCount: (lr[0].data || []).length, branchName: '_plan_lane_' + n, readonly: false,
                    tasks: (lr[0].data || []).map(withPos),
                  };
                });
              });
          });
          Promise.all(lanePromises).then(function (lanes) {
            state.plan = {
              active: true, window_start: planWinStart, window_end: planWinEnd,
              lanes: lanes.filter(function (l) { return l !== null; }),
            };
            R.state = state; R.sync();
          });
          // Do NOT call R.sync() here — wait for lane data
        } else {
          R.state = state; R.sync();
        }

        // Fire-and-forget recirculation
        var pastIds = river.filter(function (t) {
          return t.anchor && new Date(t.anchor) < now && !t.fixed && !t.alive;
        }).map(function (t) { return t.id; });
        if (pastIds.length > 0) {
          sb.from('tasks').update({ anchor: null, solidity: 0.0 })
            .eq('user_id', uid).eq('timeline_id', tid).in('id', pastIds)
            .then(function () {});
        }
      });
    });
  };

  // ── Supabase Realtime (replaces polling) ───────────────────────

  R._realtimeChannel = null;

  R.connectSSE = function () {
    var sb = window._riverSB;
    var uid = window._riverUserId;

    if (sb && uid) {
      // Subscribe to task changes via Supabase Realtime
      R._realtimeChannel = sb.channel('river-live')
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'tasks', filter: 'user_id=eq.' + uid },
          function () { R.fetchState(); }
        )
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'meta', filter: 'user_id=eq.' + uid },
          function () { R.fetchState(); }
        )
        .subscribe();
    }

    // Fallback heartbeat — if Realtime disconnects, poll every 30s
    setInterval(function () { R.fetchState(); }, 30000);
  };

  // Initialization is handled by the parent page (app/page.tsx):
  // 1. Parent sets window globals (_riverSB, _riverUserId, _riverTimelineId)
  // 2. Parent applies preloaded state via R.state + R.sync()
  // 3. Parent calls R.connectSSE() to start Realtime
  // No auto-init here — avoids race conditions with the parent.
})();
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
// river-clouds.js — ambient floating clouds in the cloud zone
// Each cloud is a cluster of overlapping ellipses with additive transparency.
// Very faint, slow-drifting, organic. More texture than shape.
(function () {
  'use strict';

  var R = window.River;

  // ── Cloud Puffs ────────────────────────────────────────────────────
  // Each cloud is a cluster of 4-7 ellipses with slight offsets.
  // The overlapping regions get brighter (additive feel via multiple draws).

  var clouds = [];
  var NUM_CLOUDS = 5;

  function randomPuff() {
    return {
      dx: (Math.random() - 0.5) * 40,
      dy: (Math.random() - 0.5) * 18,
      rx: 25 + Math.random() * 50,
      ry: 12 + Math.random() * 22,
      alpha: 0.006 + Math.random() * 0.01,
      rot: (Math.random() - 0.5) * 0.3,
    };
  }

  function createCloud(x, y, speed) {
    var puffCount = 4 + Math.floor(Math.random() * 4); // 4-7 puffs
    var puffs = [];
    for (var i = 0; i < puffCount; i++) {
      puffs.push(randomPuff());
    }
    return {
      x: x,
      y: y,
      speed: speed,
      puffs: puffs,
    };
  }

  R.initClouds = function () {
    clouds = [];
    var zone = getCloudZone();
    for (var i = 0; i < NUM_CLOUDS; i++) {
      var x = Math.random() * R.W * 1.5;
      var y = zone.top + zone.pad + Math.random() * (zone.h - zone.pad * 2);
      var speed = 6 + Math.random() * 12; // px/sec
      clouds.push(createCloud(x, y, speed));
    }
  };

  function getCloudZone() {
    var sY = R.surfaceY();
    if (R.isMobile) {
      // Cloud is below surfaceY
      var top = sY + 10;
      var h = R.H - top - 10;
      return { top: top, h: h, pad: 20 };
    } else {
      // Cloud is above surfaceY
      var top = 30;
      var h = sY - top - 20;
      return { top: top, h: h, pad: 15 };
    }
  }

  R.drawClouds = function (dt) {
    if (!clouds.length) return;
    var ctx = R.ctx;
    var zone = getCloudZone();

    for (var i = 0; i < clouds.length; i++) {
      var c = clouds[i];

      // Drift horizontally
      c.x += c.speed * dt;

      // Wrap around
      var maxW = 0;
      for (var p = 0; p < c.puffs.length; p++) {
        var pw = c.puffs[p].dx + c.puffs[p].rx;
        if (pw > maxW) maxW = pw;
      }
      if (c.x - maxW > R.W + 20) {
        c.x = -maxW - 20;
        c.y = zone.top + zone.pad + Math.random() * (zone.h - zone.pad * 2);
      }

      // Draw puffs — each is a radial gradient ellipse
      for (var j = 0; j < c.puffs.length; j++) {
        var pf = c.puffs[j];
        var px = c.x + pf.dx;
        var py = c.y + pf.dy;

        // Skip if totally off-screen
        if (px + pf.rx < -20 || px - pf.rx > R.W + 20) continue;
        // Clamp to cloud zone
        if (py - pf.ry < zone.top) continue;
        if (py + pf.ry > zone.top + zone.h) continue;

        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(pf.rot);

        var g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(pf.rx, pf.ry));
        g.addColorStop(0, 'rgba(200, 175, 140, ' + (pf.alpha * 1.2) + ')');
        g.addColorStop(0.4, 'rgba(200, 175, 140, ' + (pf.alpha * 0.7) + ')');
        g.addColorStop(0.7, 'rgba(190, 165, 130, ' + (pf.alpha * 0.3) + ')');
        g.addColorStop(1, 'rgba(180, 155, 120, 0)');

        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(0, 0, pf.rx, pf.ry, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      }
    }
  };

  // ── Hook into init ─────────────────────────────────────────────────
  // Initialize clouds when streaks init (called on resize and mode switch)
  var _origInitStreaks = R.initStreaks;
  R.initStreaks = function () {
    _origInitStreaks.call(R);
    R.initClouds();
  };

})();
// viewer/river-input.js — ALL mouse event handlers, hitTest, edgeHit, drag/resize logic, quick-add, resize overlay
(function () {
  'use strict';

  var R = window.River;

  // ── Hit Testing ─────────────────────────────────────────────────────

  R.hitTest = function (mx, my) {
    // Only test visible tasks — in plan mode, main river tasks are hidden
    var sorted = R.visibleTasks().slice().sort(function (a, b) {
      if (a.alive !== b.alive) return a.alive ? 1 : -1;
      if (a.fixed !== b.fixed) return a.fixed ? -1 : 1;
      return 0;
    });
    for (var i = sorted.length - 1; i >= 0; i--) {
      var a = sorted[i];
      var d = R.taskStretch(a);
      var hitHW = Math.max(R.MIN_HIT, d.hw + 5);
      var hitHH = Math.max(R.MIN_HIT, d.hh + 5);
      if (Math.abs(mx - a.x) <= hitHW && Math.abs(my - a.y) <= hitHH) return a;
    }
    return null;
  };

  // Detect if mouse is in the resize handle zone.
  // Handles are OUTSIDE the grab area — they extend beyond the task edges.
  // 4 handles: left/right = duration, top = commitment, bottom = energy
  R.edgeHit = function (mx, my) {
    var visible = R.visibleTasks();
    for (var i = visible.length - 1; i >= 0; i--) {
      var a = visible[i];
      var d = R.taskStretch(a);
      var grabHW = Math.max(R.MIN_HIT, d.hw);
      var grabHH = Math.max(R.MIN_HIT, d.hh);

      // Check vertical handles (top/bottom) — always available
      var tEdge = a.y - grabHH;
      var bEdge = a.y + grabHH;
      if (Math.abs(mx - a.x) <= grabHW) {
        if (my >= tEdge - R.HANDLE_ZONE && my <= tEdge + 2) return { task: a, side: 'top' };
        if (my >= bEdge - 2 && my <= bEdge + R.HANDLE_ZONE) return { task: a, side: 'bottom' };
      }

      // Check horizontal handles (left/right) — only positioned tasks
      if (a.position === null || a.position === undefined) continue;
      var rEdge = a.x + grabHW;
      var lEdge = a.x - grabHW;
      if (Math.abs(my - a.y) <= grabHH + 5) {
        if (mx >= rEdge - 2 && mx <= rEdge + R.HANDLE_ZONE) return { task: a, side: 'right' };
        if (mx >= lEdge - R.HANDLE_ZONE && mx <= lEdge + 2) return { task: a, side: 'left' };
      }
    }
    return null;
  };

  // ── Mouse Down ──────────────────────────────────────────────────────

  R.canvas.addEventListener('mousedown', function (e) {
    // Plan mode: check commit button first
    if (R.planMode) {
      var commitLane = R.planCommitHitTest(e.clientX, e.clientY);
      if (commitLane >= 0) {
        var cl = commitLane;
        R.post('plan_commit', { lane: cl });
        return;
      }
    }

    var edge = R.edgeHit(e.clientX, e.clientY);
    var hit = R.hitTest(e.clientX, e.clientY);

    // If edgeHit found a handle, ALWAYS resize — cursor already promised it
    if (edge) {
      R.resizing = {
        id: edge.task.id,
        side: edge.side,
        startMass: edge.task.mass,
        startPosition: edge.task.position,
        startSolidity: edge.task.solidity,
        startEnergy: edge.task.energy || 0.5,
        startMX: e.clientX,
        startMY: e.clientY,
        startX: edge.task.x,
      };
      if (R.selectedIds.length > 1 && R.isSelected(edge.task.id)) {
        R.resizing.group = R.selectedIds.filter(function(id) { return id !== edge.task.id; }).map(function(id) {
          var t = R.findTask(id);
          return t ? { id: id, startMass: t.mass, startSol: t.solidity, startEnergy: t.energy || 0.5, startPos: t.position } : null;
        }).filter(Boolean);
      }
      R.canvas.style.cursor = (edge.side === 'top' || edge.side === 'bottom') ? 'ns-resize' : 'ew-resize';
      return;
    }

    if (hit) {
      var zone, planLane;
      if (hit.ctx && hit.ctx.type === 'lane') {
        zone = 'plan';
        planLane = hit.ctx.lane;
      } else if (hit.position != null) {
        zone = 'river';
      } else {
        zone = 'cloud';
      }
      R.dragging = {
        id: hit.id,
        sx: hit.x, sy: hit.y,
        mx: e.clientX, my: e.clientY,
        moved: false,
        zone: zone,
        planLane: planLane,
      };
      if (R.selectedIds.length > 1 && R.isSelected(hit.id)) {
        R.dragging.group = R.selectedIds.map(function(id) {
          var t = R.findTask(id);
          return t ? { id: id, ox: t.x - hit.x, oy: t.y - hit.y } : null;
        }).filter(Boolean);
      }
    } else {
      R.hidePanel();
    }
  });

  // ── Mouse Move ──────────────────────────────────────────────────────

  R.canvas.addEventListener('mousemove', function (e) {
    R.mouseX = e.clientX; R.mouseY = e.clientY;

    // Update plan hover lane
    if (R.planMode) {
      R.planHoverLane = R.planLaneAt(e.clientY);
    }

    // Resizing (horizontal or vertical)
    if (R.resizing) {
      var a = R.findTask(R.resizing.id);
      if (!a) return;

      if (R.resizing.side === 'top') {
        // Top = commitment. Drag up = more committed.
        var deltaY = R.resizing.startMY - e.clientY;
        var newSol = Math.max(0, Math.min(1, R.resizing.startSolidity + deltaY / 80));
        a.solidity = newSol;
        var solDelta = newSol - R.resizing.startSolidity;
        if (R.resizing.group) {
          for (var ri = 0; ri < R.resizing.group.length; ri++) {
            var rg = R.resizing.group[ri];
            var rt = R.findTask(rg.id);
            if (rt) rt.solidity = Math.max(0, Math.min(1, rg.startSol + solDelta));
          }
        }
        var panelSolidity = document.getElementById('panel-solidity');
        if (R.selectedId === a.id) panelSolidity.value = Math.round(newSol * 100);
        R.canvas.style.cursor = 'ns-resize';
      } else if (R.resizing.side === 'bottom') {
        // Bottom = energy. Drag up = more energy.
        var deltaY = R.resizing.startMY - e.clientY;
        var newEnergy = Math.max(0, Math.min(1, R.resizing.startEnergy + deltaY / 80));
        a.energy = newEnergy;
        var engDelta = newEnergy - R.resizing.startEnergy;
        if (R.resizing.group) {
          for (var ri = 0; ri < R.resizing.group.length; ri++) {
            var rg = R.resizing.group[ri];
            var rt = R.findTask(rg.id);
            if (rt) rt.energy = Math.max(0, Math.min(1, rg.startEnergy + engDelta));
          }
        }
        var pe = document.getElementById('panel-energy');
        if (pe && R.selectedId === a.id) pe.value = Math.round(newEnergy * 100);
        R.canvas.style.cursor = 'ns-resize';
      } else {
        // Horizontal: snap the dragged edge to grid
        var snappedEdge = R.snapX(e.clientX);

        if (R.resizing.side === 'right') {
          var leftEdgeX = R.resizing.startX - (R.resizing.startMass / 60) * R.PIXELS_PER_HOUR / 2;
          var newWidthPx = Math.max(8, snappedEdge - leftEdgeX);
          a.mass = Math.max(5, Math.round((newWidthPx / R.PIXELS_PER_HOUR) * 60));
          a.x = leftEdgeX + newWidthPx / 2;
          a.tx = a.x;
        } else {
          var rightEdgeX = R.resizing.startX + (R.resizing.startMass / 60) * R.PIXELS_PER_HOUR / 2;
          var newWidthPx = Math.max(8, rightEdgeX - snappedEdge);
          a.mass = Math.max(5, Math.round((newWidthPx / R.PIXELS_PER_HOUR) * 60));
          a.x = rightEdgeX - newWidthPx / 2;
          a.tx = a.x;
        }
        var massDelta = a.mass - R.resizing.startMass;
        if (R.resizing.group) {
          for (var ri = 0; ri < R.resizing.group.length; ri++) {
            var rg = R.resizing.group[ri];
            var rt = R.findTask(rg.id);
            if (rt) rt.mass = Math.max(5, rg.startMass + massDelta);
          }
        }
        // Sync panel
        var panelDurInput = document.getElementById('panel-dur-input');
        if (R.selectedId === a.id) panelDurInput.value = R.formatDuration(a.mass);
        R.canvas.style.cursor = 'ew-resize';
      }
      return;
    }

    if (!R.dragging) {
      // Cursor: resize handles take priority
      var edge = R.edgeHit(e.clientX, e.clientY);
      if (edge) {
        R.canvas.style.cursor = (edge.side === 'top' || edge.side === 'bottom') ? 'ns-resize' : 'ew-resize';
      } else {
        var anyHit = R.hitTest(e.clientX, e.clientY);
        R.canvas.style.cursor = anyHit ? 'grab' : 'default';
      }
      return;
    }
    var dx = e.clientX - R.dragging.mx, dy = e.clientY - R.dragging.my;
    if (!R.dragging.moved && Math.sqrt(dx*dx + dy*dy) < R.DRAG_THRESHOLD) return;
    R.dragging.moved = true;
    R.canvas.style.cursor = 'grabbing';
    var hzBar = document.getElementById('horizon-bar');
    if (hzBar) hzBar.style.pointerEvents = 'none';

    // Plan mode drag: dragging a task from a lane or cloud into lanes
    if (R.planMode && R.dragging.zone === 'plan') {
      var pa = R.findTask(R.dragging.id);
      if (pa) {
        var rawX = R.dragging.sx + dx;
        var dd = R.taskStretch(pa);
        var startEdgeX = rawX - dd.hw;
        var snappedStart = R.snapX(startEdgeX);
        pa.x = snappedStart + dd.hw;
        pa.y = R.dragging.sy + dy;
        pa.tx = pa.x; pa.ty = pa.y;
      }

      return;
    }

    // Normal or cloud drag (including cloud -> lane in plan mode)
    var a = R.findTask(R.dragging.id);
    if (a) {
      var boundary = R.surfaceY();

      // ── Drag Wizard ──
      // Activates whenever the cursor is in the cloud zone during any drag.
      // Works for cloud tasks AND river tasks dragged upward.
      // Wizard activates only when well into the cloud zone (30px above surface)
      var cloudThreshold = R.isMobile ? boundary + 30 : boundary - 30;
      var inCloud = R.isMobile ? (e.clientY > cloudThreshold) : (e.clientY < cloudThreshold);
      if (R.wizardActivate) {
        if (inCloud && !R.dragging.wizardStarted) {
          R.wizardActivate(R.dragging.id);
          R.dragging.wizardStarted = true;
        }
        if (R.wizardIsActive && R.wizardIsActive()) {
          R.wizardMouseMove(e.clientX, e.clientY);
        }
      }
      // Task ALWAYS follows cursor — wizard just transforms properties in-flight

      // ── Drag-to-Horizon Dwell Switcher ──
      // When dragging ANY task near the horizon buttons, check for dwell
      if (R.dwellCheckStart && !R.wizardIsActive()) {
        R.dwellCheckStart(e.clientX, e.clientY);
      }

      if (R.isMobile) {
        // Mobile: X moves freely, snap Y (time axis)
        a.x = R.dragging.sx + dx;
        var rawY = R.dragging.sy + dy;
        a.y = R.snapY ? R.snapY(rawY) : rawY;
      } else {
        var rawX = R.dragging.sx + dx;
        // Snap the START edge (left edge = center - halfWidth) to grid
        var dd = R.taskStretch(a);
        var startEdgeX = rawX - dd.hw;
        var snappedStart = R.snapX(startEdgeX);
        a.x = snappedStart + dd.hw;
        a.y = R.dragging.sy + dy;
      }
      a.tx = a.x; a.ty = a.y;

      if (R.dragging.group) {
        for (var gi = 0; gi < R.dragging.group.length; gi++) {
          var g = R.dragging.group[gi];
          var gt = R.findTask(g.id);
          if (gt && gt.id !== R.dragging.id) {
            gt.x = a.x + g.ox;
            gt.y = a.y + g.oy;
            gt.tx = gt.x; gt.ty = gt.y;
          }
        }
      }

    }
  });

  // ── Mouse Up ────────────────────────────────────────────────────────

  R.canvas.addEventListener('mouseup', function (e) {
    // Finish resize
    if (R.resizing) {
      var a = R.findTask(R.resizing.id);
      if (a) {
        if (R.resizing.side === 'top') {
          R.save(R.resizing.id, { solidity: a.solidity });
        } else if (R.resizing.side === 'bottom') {
          R.save(R.resizing.id, { energy: a.energy });
        } else {
          var newMass = a.mass;
          var massDiffHours = (newMass - R.resizing.startMass) / 60;
          var pos = R.resizing.side === 'right'
            ? R.resizing.startPosition + massDiffHours / 2
            : R.resizing.startPosition - massDiffHours / 2;
          R.save(R.resizing.id, { mass: newMass, position: pos });
        }
        if (R.resizing.group) {
          for (var ri = 0; ri < R.resizing.group.length; ri++) {
            var rg = R.resizing.group[ri];
            var rt = R.findTask(rg.id);
            if (!rt) continue;
            if (R.resizing.side === 'top') {
              R.save(rg.id, { solidity: rt.solidity });
            } else if (R.resizing.side === 'bottom') {
              R.save(rg.id, { energy: rt.energy });
            } else {
              var rgMassDiff = (rt.mass - rg.startMass) / 60;
              var rgPos = R.resizing.side === 'right'
                ? (rg.startPos != null ? rg.startPos + rgMassDiff / 2 : null)
                : (rg.startPos != null ? rg.startPos - rgMassDiff / 2 : null);
              var rgUpdates = { mass: rt.mass };
              if (rgPos != null) rgUpdates.position = rgPos;
              R.save(rg.id, rgUpdates);
            }
          }
        }
      }
      R.resizing = null;
      R.canvas.style.cursor = 'default';
      return;
    }

    if (!R.dragging) return;
    var d = R.dragging; R.dragging = null; R.canvas.style.cursor = 'default';
    var hzBar = document.getElementById('horizon-bar');
    if (hzBar) hzBar.style.pointerEvents = '';

    // Always clean up wizard on any drop
    if (d.wizardStarted && R.wizardDeactivate) R.wizardDeactivate();
    if (R.dwellReset) R.dwellReset();

    // ── Plan mode drop logic ──
    if (R.planMode && d.zone === 'plan') {
      if (!d.moved) {
        // Click on plan task — show panel
        var pa = R.findTask(d.id);
        if (pa) R.showPanel(pa, e.clientX, e.clientY);
        return;
      }

      var dropLane = R.planLaneAt(e.clientY);
      var boundary = R.surfaceY();
      var pa = R.findTask(d.id);
      if (!pa) return;

      var dd2 = R.taskStretch(pa);
      var startEdge = pa.x - dd2.hw;
      var dropHours = R.screenXToHours(startEdge) + pa.mass / 120;

      if (e.clientY < boundary) {
        R.moveToCloud(d.id, d.planLane);
      } else if (dropLane >= 0 && dropLane !== d.planLane) {
        R.moveToLane(d.id, d.planLane, dropLane, dropHours);
      } else {
        // Same lane reposition (or dropped outside lanes — keep in original lane)
        R.savePosition(d.id, dropHours);
      }
      return;
    }

    // Plan mode: cloud task dropped into a lane — copy it
    if (R.planMode && d.zone === 'cloud' && d.moved) {
      var dropLane = R.planLaneAt(e.clientY);
      if (dropLane >= 0) {
        var a = R.findTask(d.id);
        if (a) {
          var dd2 = R.taskStretch(a);
          var startEdge = a.x - dd2.hw;
          var dropHours = R.screenXToHours(startEdge) + a.mass / 120;

          R.copyToLane(d.id, dropLane, dropHours);
        }
        return;
      }
    }

    // Plan mode: river task (outside plan window) dropped into a lane — copy it, snap back
    if (R.planMode && d.zone === 'river' && d.moved) {
      var dropLane = R.planLaneAt(e.clientY);
      if (dropLane >= 0) {
        var a = R.findTask(d.id);
        if (a) {
          var dd2 = R.taskStretch(a);
          var startEdge = a.x - dd2.hw;
          var dropHours = R.screenXToHours(startEdge) + a.mass / 120;

          R.copyToLane(d.id, dropLane, dropHours);

          // Snap the original back to its river position
          var origPos = R.riverPos(a);
          a.tx = origPos.x;
          a.ty = origPos.y;
        }
        return;
      }
    }

    if (!d.moved) {
      if (e.shiftKey) {
        var idx = R.selectedIds.indexOf(d.id);
        if (idx >= 0) R.selectedIds.splice(idx, 1);
        else R.selectedIds.push(d.id);
        R.selectedId = R.selectedIds[0] || null;
      } else {
        R.selectedIds = [d.id];
        R.selectedId = d.id;
      }
      if (R.selectedIds.length > 0) {
        var first = R.findTask(R.selectedIds[0]);
        if (first) R.showPanel(first, e.clientX, e.clientY);
      }
      return;
    }

    var a = R.findTask(d.id);
    if (!a) return;
    var boundary = R.surfaceY();

    var wizardWasActive = d.wizardStarted;

    // Convert drop position to hours-from-now
    var dd2 = R.taskStretch(a);
    var dropHours;
    if (R.isMobile && R.screenYToHours) {
      dropHours = R.screenYToHours(a.y);
    } else {
      var startEdge = a.x - dd2.hw;
      dropHours = R.screenXToHours(startEdge) + a.mass / 120;
    }

    // Build one combined update — wizard properties + position change
    var updates = {};
    if (wizardWasActive) {
      updates.mass = a.mass;
      updates.solidity = a.solidity;
      updates.energy = a.energy;
    }

    if (R.isMobile) {
      // Mobile: river is ABOVE boundary, cloud is BELOW
      var rTop = 20;
      var rBot = boundary - 10;
      var cTop = boundary + 10;
      var cBot = R.H - 20;

      if (d.zone === 'cloud' && a.y < boundary) {
        // Cloud → river (dragged UP into river zone)
        updates.position = dropHours;
        updates.river_y = Math.max(0, Math.min(1, (a.x - 20) / (R.W - 40))); // X = scatter on mobile
      } else if (d.zone === 'river' && a.y > boundary) {
        // River → cloud (dragged DOWN into cloud zone)
        updates.position = null;
        updates.cloud_x = Math.max(0, Math.min(1, (a.x - R.W * 0.1) / (R.W * 0.8)));
        updates.cloud_y = Math.max(0, Math.min(1, (a.y - cTop) / (cBot - cTop)));
      } else if (d.zone === 'river') {
        // River → river (reposition)
        updates.position = dropHours;
        updates.river_y = Math.max(0, Math.min(1, (a.x - 20) / (R.W - 40))); // X = scatter on mobile
      } else if (d.zone === 'cloud') {
        // Cloud → cloud (rearrange)
        updates.cloud_x = Math.max(0, Math.min(1, (a.x - R.W * 0.1) / (R.W * 0.8)));
        updates.cloud_y = Math.max(0, Math.min(1, (a.y - cTop) / (cBot - cTop)));
      }
    } else {
      // Desktop: cloud is ABOVE boundary, river is BELOW
      var rTop = R.surfaceY() + 30;
      var rBot = R.H - 50;
      var cTop = R.cloudTopY();
      var cBot = R.surfaceY() - 50;

      if (d.zone === 'cloud' && a.y > boundary) {
        // Cloud → river
        updates.position = dropHours;
        updates.river_y = Math.max(0, Math.min(1, (a.y - rTop) / (rBot - rTop)));
      } else if (d.zone === 'river' && a.y < boundary) {
        // River → cloud
        updates.position = null;
        updates.cloud_x = Math.max(0, Math.min(1, (a.x - R.W * 0.15) / (R.W * 0.7)));
        updates.cloud_y = Math.max(0, Math.min(1, (a.y - cTop) / (cBot - cTop)));
      } else if (d.zone === 'river' && a.y > boundary) {
        // River → river (reposition)
        var dd3 = R.taskStretch(a);
        var startEdge2 = a.x - dd3.hw;
        updates.position = R.screenXToHours(startEdge2) + a.mass / 120;
        updates.river_y = Math.max(0, Math.min(1, (a.y - rTop) / (rBot - rTop)));
      } else if (d.zone === 'cloud') {
        // Cloud → cloud (rearrange)
        updates.cloud_x = Math.max(0, Math.min(1, (a.x - R.W * 0.15) / (R.W * 0.7)));
        updates.cloud_y = Math.max(0, Math.min(1, (a.y - cTop) / (cBot - cTop)));
      }
    }

    // Send everything in one put
    if (Object.keys(updates).length > 0) {
      R.save(d.id, updates);
    }

    if (d.group) {
      for (var gi = 0; gi < d.group.length; gi++) {
        var g = d.group[gi];
        if (g.id === d.id) continue;
        var gt = R.findTask(g.id);
        if (!gt) continue;
        var gUpdates = {};
        var gBoundary = R.surfaceY();
        var gRTop = gBoundary + 30, gRBot = R.H - 50;
        if (gt.position != null) {
          if (R.isMobile && R.screenYToHours) {
            gUpdates.position = R.screenYToHours(gt.y);
          } else {
            var gdd = R.taskStretch(gt);
            var gStartEdge = gt.x - gdd.hw;
            gUpdates.position = R.screenXToHours(gStartEdge) + gt.mass / 120;
          }
          gUpdates.river_y = Math.max(0, Math.min(1, (gt.y - gRTop) / (gRBot - gRTop)));
        }
        if (Object.keys(gUpdates).length > 0) R.save(g.id, gUpdates);
      }
    }
  });

  R.canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // ── Quick Add (double-click) ────────────────────────────────────────
  // Double-click empty space -> input appears -> type name -> task created
  // In cloud zone: creates a cloud task. In river zone: creates at that time position.

  var quickAddWrap = document.getElementById('quick-add-wrap');
  var quickAdd = document.getElementById('quick-add');
  var quickAddTagsEl = document.getElementById('quick-add-tags');
  var quickAddPos = null; // null = cloud, number = hours from now
  var quickAddClickX = 0; // raw clientX of the double-click
  var quickAddClickY = 0; // raw clientY of the double-click
  var quickAddLane = -1;  // -1 = not in a plan lane
  var quickAddSelectedTag = null;

  function buildQuickAddTags() {
    quickAddTagsEl.innerHTML = '';
    quickAddSelectedTag = null;
    var tags = (R.allTags || []).filter(function (t) { return t !== 'N/A'; });
    for (var i = 0; i < tags.length; i++) {
      (function (tag) {
        var btn = document.createElement('button');
        btn.className = 'quick-add-tag';
        btn.textContent = tag;
        btn.style.color = R.tagColor(tag);
        btn.addEventListener('mousedown', function (e) {
          e.preventDefault(); // don't blur the input
          if (quickAddSelectedTag === tag) {
            quickAddSelectedTag = null;
            btn.classList.remove('selected');
          } else {
            quickAddSelectedTag = tag;
            var all = quickAddTagsEl.querySelectorAll('.quick-add-tag');
            for (var j = 0; j < all.length; j++) all[j].classList.remove('selected');
            btn.classList.add('selected');
          }
        });
        quickAddTagsEl.appendChild(btn);
      })(tags[i]);
    }
  }

  R.canvas.addEventListener('dblclick', function (e) {
    if (R.hitTest(e.clientX, e.clientY)) return;

    var sY = R.surfaceY();
    quickAddClickX = e.clientX;
    quickAddClickY = e.clientY;

    if (R.isMobile) {
      // Mobile: cloud is BELOW surfaceY, river is ABOVE
      quickAddLane = -1;
      if (e.clientY > sY) {
        quickAddPos = null; // cloud task
      } else {
        quickAddPos = R.screenYToHours ? R.screenYToHours(e.clientY) : 0; // river task
      }
    } else if (R.planMode) {
      // Desktop plan mode: only target a lane if click is inside the plan window
      var lane = R.planLaneAt(e.clientY);
      var inPlanX = false;
      if (R.planWindowStart && R.planWindowEnd && R.state) {
        var pNow = new Date(R.state.now);
        var pStartH = (new Date(R.planWindowStart).getTime() - pNow.getTime()) / 3600000;
        var pEndH = (new Date(R.planWindowEnd).getTime() - pNow.getTime()) / 3600000;
        var pLeftX = R.hoursToX(pStartH);
        var pRightX = R.hoursToX(pEndH);
        inPlanX = (e.clientX >= pLeftX && e.clientX <= pRightX);
      }
      if (lane >= 0 && inPlanX) {
        quickAddLane = lane;
        quickAddPos = (e.clientX - R.W * R.NOW_X) / R.PIXELS_PER_HOUR + R.scrollHours;
      } else {
        quickAddLane = -1;
        quickAddPos = (e.clientY > sY)
          ? (e.clientX - R.W * R.NOW_X) / R.PIXELS_PER_HOUR + R.scrollHours
          : null;
      }
    } else {
      quickAddLane = -1;
      quickAddPos = (e.clientY > sY)
        ? (e.clientX - R.W * R.NOW_X) / R.PIXELS_PER_HOUR + R.scrollHours
        : null;
    }

    if (R.isMobile) {
      // Mobile: CSS handles left/right (16px gutters). Just set top smartly.
      quickAddWrap.style.left = '';
      var qTop = e.clientY - 18;
      // Keep it on screen
      if (qTop > R.H - 80) qTop = R.H - 80;
      if (qTop < 10) qTop = 10;
      quickAddWrap.style.top = qTop + 'px';
    } else {
      quickAddWrap.style.left = (e.clientX - 100) + 'px';
      quickAddWrap.style.top = (e.clientY - 18) + 'px';
    }
    quickAddWrap.classList.remove('hidden');
    quickAdd.value = '';
    quickAdd.focus();
    buildQuickAddTags();
  });

  quickAdd.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && quickAdd.value.trim()) {
      if (quickAddLane >= 0) {
        var lanePayload = { lane: quickAddLane, name: quickAdd.value.trim(), position: quickAddPos };
        var laneName = lanePayload.name;
        var lanePos = lanePayload.position;
        var laneNum = quickAddLane;
        R.post('plan_lane_put', lanePayload, function (tasks) {
          var tempId = '_temp_' + Date.now();
          var bounds = R.planLaneBounds ? R.planLaneBounds(laneNum) : { midY: R.H * 0.6 };
          var tx = R.hoursToX ? R.hoursToX(lanePos || 0) : R.W * 0.5;
          tasks.push({
            id: tempId, name: laneName, mass: 30, solidity: 0.3, energy: 0.5,
            fixed: false, alive: false, tags: [], position: lanePos, anchor: null,
            ctx: { type: 'lane', lane: laneNum }, _dirtyUntil: Date.now() + 5000,
            x: tx, y: bounds.midY || R.H * 0.6, tx: tx, ty: bounds.midY || R.H * 0.6, vx: 0, vy: 0
          });
        });
      } else {
        var payload = { name: quickAdd.value.trim() };
        if (quickAddPos !== null) {
          // River task — include position and river_y so it appears at the click location
          payload.position = quickAddPos;
          if (R.isMobile) {
            // Mobile: X is scatter axis, river is 0 to surfaceY
            payload.river_y = Math.max(0, Math.min(1, (quickAddClickX - 20) / (R.W - 40)));
          } else {
            var rTop = R.surfaceY() + 30;
            var rBot = R.H - 50;
            payload.river_y = Math.max(0, Math.min(1, (quickAddClickY - rTop) / (rBot - rTop)));
          }
        } else {
          // Cloud task — include cloud_x and cloud_y so it appears at the click location
          if (R.isMobile) {
            // Mobile: cloud is below surfaceY
            var mcTop = R.cloudTopY();
            var mcBot = R.H - 20;
            payload.cloud_x = Math.max(0, Math.min(1, (quickAddClickX - R.W * 0.1) / (R.W * 0.8)));
            payload.cloud_y = Math.max(0, Math.min(1, (quickAddClickY - mcTop) / (mcBot - mcTop)));
          } else {
            var cTop = R.cloudTopY();
            var cBot = R.surfaceY() - 50;
            payload.cloud_x = Math.max(0, Math.min(1, (quickAddClickX - R.W * 0.15) / (R.W * 0.7)));
            payload.cloud_y = Math.max(0, Math.min(1, (quickAddClickY - cTop) / (cBot - cTop)));
          }
        }
        if (quickAddSelectedTag) payload.tags = [quickAddSelectedTag];
        // Optimistic: insert a temporary task at the click location
        var optName = payload.name;
        var optPos = payload.position || null;
        var optTags = payload.tags || [];
        var optCloudX = payload.cloud_x;
        var optCloudY = payload.cloud_y;
        var optClickX = quickAddClickX;
        var optClickY = quickAddClickY;
        R.post('put', payload, function (tasks) {
          var tempId = '_temp_' + Date.now();
          var tx, ty;
          if (optPos !== null) {
            tx = R.hoursToX ? R.hoursToX(optPos) : R.W * 0.5;
            ty = optClickY;
          } else {
            tx = optClickX;
            ty = optClickY;
          }
          tasks.push({
            id: tempId, name: optName, mass: 30, solidity: 0.3, energy: 0.5,
            fixed: false, alive: false, tags: optTags, position: optPos, anchor: null,
            ctx: { type: 'main' }, _dirtyUntil: Date.now() + 5000,
            x: tx, y: ty, tx: tx, ty: ty, vx: 0, vy: 0
          });
        });
      }
      quickAddWrap.classList.add('hidden');
      quickAdd.value = '';
      quickAddSelectedTag = null;
    } else if (e.key === 'Escape') {
      quickAddWrap.classList.add('hidden');
    }
  });

  // Escape exits plan mode
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && R.planMode && !quickAddWrap.classList.contains('hidden')) return;
    if (e.key === 'Escape' && R.planMode) {
      R.post('plan_end', {});
    }
  });

  quickAdd.addEventListener('blur', function () {
    // Delay so tag clicks register before blur hides the wrapper
    setTimeout(function () {
      if (!quickAddWrap.contains(document.activeElement)) {
        quickAddWrap.classList.add('hidden');
      }
    }, 150);
  });

  // ── Resize Overlay Rendering ────────────────────────────────────────
  // Called from the frame loop to draw indicators during resize/hover/drag

  R.drawResizeOverlay = function (t) {
    var ctx = R.ctx;

    if (R.resizing) {
      var ra = R.findTask(R.resizing.id);
      if (ra) {
        var re = R.taskEdges(ra);
        ctx.font = '600 12px -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';

        if (R.resizing.side === 'top') {
          // Top = commitment
          var pct = Math.round(ra.solidity * 100);
          ctx.fillText(pct + '%', ra.x, re.top - 14);
          ctx.font = '400 9px -apple-system, system-ui, sans-serif';
          ctx.fillStyle = 'rgba(200, 165, 110, 0.5)';
          ctx.fillText('commitment', ra.x, re.top - 26);
        } else if (R.resizing.side === 'bottom') {
          // Bottom = energy
          var pct = Math.round((ra.energy !== undefined ? ra.energy : 0.5) * 100);
          ctx.fillText(pct + '%', ra.x, re.bottom + 16);
          ctx.font = '400 9px -apple-system, system-ui, sans-serif';
          ctx.fillStyle = 'rgba(200, 165, 110, 0.5)';
          ctx.fillText('energy', ra.x, re.bottom + 28);
        } else {
          // Horizontal: show duration + time
          ctx.fillText(R.formatDuration(ra.mass), ra.x, ra.y);

          if (R.state) {
            var now = new Date(R.state.now);
            var edgeHours = R.resizing.side === 'right'
              ? (ra.position || 0) + ra.mass / 60
              : (ra.position || 0);
            if (R.resizing.side === 'left') {
              var massDiff = ra.mass - R.resizing.startMass;
              edgeHours = R.resizing.startPosition - massDiff / 60;
            }
            var edgeTime = new Date(now.getTime() + edgeHours * 3600000);
            var eh = edgeTime.getHours(), em = edgeTime.getMinutes();
            var eLabel = (eh % 12 || 12) + ':' + (em < 10 ? '0' : '') + em + (eh >= 12 ? 'pm' : 'am');

            var labelX = R.resizing.side === 'right' ? re.right + 8 : re.left - 8;
            ctx.font = '500 10px -apple-system, system-ui, sans-serif';
            ctx.textAlign = R.resizing.side === 'right' ? 'left' : 'right';
            ctx.fillStyle = 'rgba(200, 165, 110, 0.7)';
            ctx.fillText(eLabel, labelX, ra.y);
          }
        }
      }
    } else if (!R.dragging) {
      // Hover: show handle dots outside the grab area
      var hoverEdge = R.edgeHit(R.mouseX, R.mouseY);
      if (hoverEdge) {
        var ht = hoverEdge.task;
        var hd = R.taskStretch(ht);
        var grabHW = Math.max(R.MIN_HIT, hd.hw);
        var grabHH = Math.max(R.MIN_HIT, hd.hh);
        var dotX, dotY;

        if (hoverEdge.side === 'right' || hoverEdge.side === 'left') {
          dotX = hoverEdge.side === 'right' ? ht.x + grabHW : ht.x - grabHW;
          dotY = ht.y;
          // Vertical grip line
          ctx.beginPath();
          ctx.moveTo(dotX, dotY - 8);
          ctx.lineTo(dotX, dotY + 8);
          ctx.strokeStyle = 'rgba(200, 165, 110, 0.3)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else {
          dotX = ht.x;
          dotY = hoverEdge.side === 'top' ? ht.y - grabHH : ht.y + grabHH;
          // Horizontal grip line
          ctx.beginPath();
          ctx.moveTo(dotX - 8, dotY);
          ctx.lineTo(dotX + 8, dotY);
          ctx.strokeStyle = 'rgba(200, 165, 110, 0.3)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(200, 165, 110, 0.4)';
        ctx.fill();
      }
    }

    // ── Drag overlay: show start/end times while moving ──
    if (R.dragging && R.dragging.moved) {
      var da = R.findTask(R.dragging.id);
      if (da && da.position !== null && da.position !== undefined && R.state) {
        var dnow = new Date(R.state.now);
        var dd = R.taskStretch(da);
        // position = center. Start = center - half duration. End = center + half.
        var centerHours = (da.x - R.W * R.NOW_X) / R.PIXELS_PER_HOUR + R.scrollHours;
        var halfDurH = da.mass / 120; // half duration in hours
        var startHours = centerHours - halfDurH;
        var endHours = centerHours + halfDurH;

        var startTime = new Date(dnow.getTime() + startHours * 3600000);
        var endTime = new Date(dnow.getTime() + endHours * 3600000);

        ctx.font = '500 11px -apple-system, system-ui, sans-serif';
        ctx.textBaseline = 'middle';

        // Start time to the left
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(200, 165, 110, 0.7)';
        ctx.fillText(R.fmtDragTime(startTime), da.x - dd.hw - 8, da.y);

        // End time to the right
        ctx.textAlign = 'left';
        ctx.fillText(R.fmtDragTime(endTime), da.x + dd.hw + 8, da.y);
      }
    }
  };
})();
// viewer/river-main.js — canvas setup, horizon bar, frame loop, requestAnimationFrame
(function () {
  'use strict';

  var R = window.River;

  // ── Canvas Setup ────────────────────────────────────────────────────

  R.resize = function () {
    R.dpr = window.devicePixelRatio || 1;
    R.W = window.innerWidth;
    R.H = window.innerHeight;
    R.canvas.width = R.W * R.dpr;
    R.canvas.height = R.H * R.dpr;
    R.canvas.style.width = R.W + 'px';
    R.canvas.style.height = R.H + 'px';
    R.ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    R.initStreaks();
  };

  window.addEventListener('resize', function () { R.resize(); R.recalcScale(); R.sync(); });
  R.resize();
  R.recalcScale();

  // ── Horizon Bar ──────────────────────────────────────────────────────

  var hzBtns = document.querySelectorAll('.hz-btn');
  var hzLabel = document.getElementById('hz-label');
  var hzPrev = document.getElementById('hz-prev');
  var hzNext = document.getElementById('hz-next');

  R.setHorizon = function (hours) {
    hzBtns.forEach(function (b) { b.classList.remove('active'); });
    hzBtns.forEach(function (b) { if (Number(b.dataset.hours) === hours) b.classList.add('active'); });
    R.horizonHours = hours;
    R.recalcScale();
    R.sync();
    // Snap all tasks to their new positions immediately — no spring animation
    for (var i = 0; i < R.tasks.length; i++) {
      var a = R.tasks[i];
      // Skip the task being dragged
      if (R.dragging && R.dragging.id === a.id) continue;
      a.x = a.tx;
      a.y = a.ty;
      a.vx = 0;
      a.vy = 0;
    }
    R.updateFrameLabel();
  };

  R.updateFrameLabel = function () {
    if (!R.state) { hzLabel.textContent = R.FRAME_LABELS[R.horizonHours] || ''; return; }
    var now = new Date(R.state.now);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    // For short horizons (6h, day) — show relative offset in hours
    if (R.horizonHours <= 24) {
      if (Math.abs(R.scrollHours) < 1) {
        hzLabel.textContent = R.horizonHours <= 6 ? 'now' : 'today';
      } else {
        var sign = R.scrollHours > 0 ? '+' : '';
        var h = Math.round(R.scrollHours);
        hzLabel.textContent = sign + h + 'h';
      }
      return;
    }

    // For longer horizons — show the center date contextually
    var center = new Date(now.getTime() + (R.scrollHours + R.horizonHours / 2) * 3600000);

    if (Math.abs(R.scrollHours) < R.horizonHours * 0.1) {
      if (R.horizonHours <= 96) hzLabel.textContent = 'next 4 days';
      else if (R.horizonHours <= 168) hzLabel.textContent = 'this week';
      else if (R.horizonHours <= 720) hzLabel.textContent = months[now.getMonth()];
      else if (R.horizonHours <= 2160) hzLabel.textContent = 'Q' + (Math.floor(now.getMonth()/3)+1) + ' \u2019' + (now.getFullYear()%100);
      else hzLabel.textContent = '' + now.getFullYear();
    } else {
      if (R.horizonHours <= 168) {
        var start = new Date(now.getTime() + R.scrollHours * 3600000);
        hzLabel.textContent = months[start.getMonth()] + ' ' + start.getDate() + '\u2009\u2013\u2009' + new Date(start.getTime() + R.horizonHours*3600000).getDate();
      } else if (R.horizonHours <= 720) {
        hzLabel.textContent = months[center.getMonth()] + ' \u2019' + (center.getFullYear()%100);
      } else if (R.horizonHours <= 2160) {
        hzLabel.textContent = 'Q' + (Math.floor(center.getMonth()/3)+1) + ' \u2019' + (center.getFullYear()%100);
      } else {
        hzLabel.textContent = '' + center.getFullYear();
      }
    }
  };

  R.getCalendarHorizon = function (nominal) {
    return nominal; // all frames are fixed durations
  };

  hzBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      R.scrollHours = 0; R.scrollVel = 0;
      var nominal = Number(btn.dataset.hours);
      R.setHorizon(R.getCalendarHorizon(nominal));
      // Store nominal so we know which button is active
      btn._nominal = nominal;
    });
  });

  R.frameStep = function () {
    if (R.horizonHours <= 6) return 6;
    if (R.horizonHours <= 24) return 24;      // 1 day
    if (R.horizonHours <= 96) return 24;      // 4d: iterate 1 day
    if (R.horizonHours <= 168) return 168;    // 1 week
    if (R.horizonHours <= 720) return 720;    // 1 month
    if (R.horizonHours <= 2160) return 2160;  // 1 quarter
    return 8760;
  };

  hzPrev.addEventListener('click', function () {
    R.scrollHours -= R.frameStep();
    R.scrollVel = 0;
    R.sync(); R.updateFrameLabel();
  });

  hzNext.addEventListener('click', function () {
    R.scrollHours += R.frameStep();
    R.scrollVel = 0;
    R.sync(); R.updateFrameLabel();
  });

  // ── Plan Mode Button ──────────────────────────────────────────────
  var planBtn = document.getElementById('plan-btn');
  planBtn.addEventListener('click', function () {
    if (R.isMobile) return; // no plan mode on mobile
    if (R.planMode) {
      R.post('plan_end', {});
    } else {
      // Lock the current visible time range — use actual screen edges
      var now = R.state ? new Date(R.state.now) : new Date();
      var leftHours = (0 - R.W * R.NOW_X) / R.PIXELS_PER_HOUR + R.scrollHours;
      var rightHours = (R.W - R.W * R.NOW_X) / R.PIXELS_PER_HOUR + R.scrollHours;
      var windowStart = new Date(now.getTime() + leftHours * 3600000).toISOString();
      var windowEnd = new Date(now.getTime() + rightHours * 3600000).toISOString();
      R.post('plan_start', { window_start: windowStart, window_end: windowEnd }, function () {
        // Optimistic: show plan mode visuals immediately (server fills lane data)
        R.planMode = true;
        R.planWindowStart = windowStart;
        R.planWindowEnd = windowEnd;
        R.planLanes = [];
        for (var i = 0; i < R.planLaneCount(); i++) R.planLanes.push({ label: '', tasks: [] });
        if (R.initPlanStreaks) R.initPlanStreaks();
        if (R.updatePlanIndicator) R.updatePlanIndicator();
      });
    }
  });

  // ── Scroll / Trackpad ──────────────────────────────────────────────
  // Horizontal scroll (wheel or trackpad) pans the river smoothly.

  R.canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    // deltaX for horizontal trackpad, deltaY for mouse wheel
    var delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    // Convert pixels to hours
    var hoursPerPx = 1 / R.PIXELS_PER_HOUR;
    R.scrollHours += delta * hoursPerPx * 1.2;
    R.scrollVel = 0; // kill momentum on direct input
    R.sync();
    R.updateFrameLabel();
  }, { passive: false });

  // ── The Loop ────────────────────────────────────────────────────────
  // Everything moves like it's underwater.

  function frame(t) {
    requestAnimationFrame(frame);

    var dt = R.lastTime ? (t - R.lastTime) / 1000 : 1/60;
    dt = Math.min(dt, 0.1);
    R.lastTime = t;

    // Spring physics — fluid, damped, organic (all tasks)
    for (var i = 0; i < R.tasks.length; i++) {
      var a = R.tasks[i];
      if (R.dragging && R.dragging.id === a.id && R.dragging.moved) continue;
      a.vx += (a.tx - a.x) * R.SPRING_K;
      a.vy += (a.ty - a.y) * R.SPRING_K;
      a.vx *= R.DAMPING;
      a.vy *= R.DAMPING;
      a.x += a.vx;
      a.y += a.vy;

      // Mobile: hard boundary — river tasks stay above surfaceY, cloud tasks stay below
      if (R.isMobile) {
        var sY = R.surfaceY();
        if (a.position !== null && a.position !== undefined) {
          if (a.y > sY - 5) { a.y = sY - 5; a.vy = 0; }
        } else {
          if (a.y < sY + 5) { a.y = sY + 5; a.vy = 0; }
        }
      }
    }

    // Draw the world
    R.drawWorld(t);

    // Ambient floating clouds in the cloud zone
    if (R.drawClouds) R.drawClouds(dt);

    // Always draw streaks, now line, time markers
    R.drawStreaks(dt);
    R.drawNowLine(t);
    R.drawTimeMarkers();

    // River task rendering
    var riverSorted = R.riverTasks().sort(function (a, b) {
      if (a.alive !== b.alive) return a.alive ? 1 : -1;
      if (a.fixed !== b.fixed) return a.fixed ? -1 : 1;
      return 0;
    });

    if (R.planMode && !R.isMobile) {
      // Plan mode: only draw river tasks OUTSIDE the plan window
      var now = R.state ? new Date(R.state.now) : new Date();
      var pwStartH = R.planWindowStart ? (new Date(R.planWindowStart).getTime() - now.getTime()) / 3600000 : -Infinity;
      var pwEndH = R.planWindowEnd ? (new Date(R.planWindowEnd).getTime() - now.getTime()) / 3600000 : Infinity;

      for (var j = 0; j < riverSorted.length; j++) {
        var task = riverSorted[j];
        var screenX = R.hoursToX(task.position);
        var cullHW = R.taskStretch(task).hw + 50;
        if (screenX + cullHW < 0 || screenX - cullHW > R.W) continue;
        if (task.position >= pwStartH && task.position <= pwEndH) continue;
        R.drawBlob(task, t);
      }

      R.drawPlanMode(t, dt);
      if (R.drawPlanWindowOutline) R.drawPlanWindowOutline(t);
    } else {
      // Normal mode (or mobile): draw all river tasks with culling
      for (var j = 0; j < riverSorted.length; j++) {
        var task = riverSorted[j];
        if (R.isMobile) {
          // Vertical culling: cull by Y position
          var screenY = R.hoursToY ? R.hoursToY(task.position) : task.y;
          var cullHH = R.taskStretch(task).hh + 50;
          if (screenY + cullHH < 0 || screenY - cullHH > R.H) continue;
        } else {
          var screenX = R.hoursToX(task.position);
          var cullHW = R.taskStretch(task).hw + 50;
          if (screenX + cullHW < 0 || screenX - cullHW > R.W) continue;
        }
        R.drawBlob(task, t);
      }
    }

    // Cloud tasks render in both modes
    var cloudSorted = R.cloudTasks().sort(function (a, b) {
      if (a.alive !== b.alive) return a.alive ? 1 : -1;
      return 0;
    });

    for (var ci = 0; ci < cloudSorted.length; ci++) {
      R.drawBlob(cloudSorted[ci], t);
    }

    // ── Wizard glowing field ──
    if (R.drawWizardField) R.drawWizardField(t);
    // ── Dwell timeframe indicator ──
    if (R.drawDwellIndicator) R.drawDwellIndicator(t);

    R.drawPastFade();

    // ── Keep panel attached to selected task ──
    if (R.selectedId && !document.getElementById('panel').classList.contains('hidden')) {
      var selTask = R.findTask(R.selectedId);
      if (selTask) R.positionPanel(selTask);
    }

    // ── Resize / hover / drag overlays ──
    R.drawResizeOverlay(t);

    // ── Plan commit buttons — drawn last so they're never covered ──
    if (R.planMode && !R.isMobile && R.drawPlanCommitButtons) R.drawPlanCommitButtons(t);
  }

  requestAnimationFrame(frame);
})();
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
    var y = mNowY();
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

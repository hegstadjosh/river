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
            .then(function (res) { if (res.error) console.error('River:', res.error); });
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
          }).then(function (res) { if (res.error) console.error('River:', res.error); });
        }
        break;
      case 'move':
        var moveAnchor = data.position === null ? null : R.positionToAnchor(data.position);
        sb.from('tasks').update({ anchor: moveAnchor })
          .eq('id', data.id).eq('user_id', uid).eq('timeline_id', tid)
          .then(function (res) { if (res.error) console.error('River:', res.error); });
        break;
      case 'delete':
        sb.from('tasks').delete()
          .eq('id', data.id).eq('user_id', uid).eq('timeline_id', tid)
          .then(function (res) { if (res.error) console.error('River:', res.error); });
        break;
      case 'tag_create':
        sb.from('meta').select('value').eq('user_id', uid).eq('key', 'known_tags').single()
          .then(function (r) {
            var tags = r.data ? JSON.parse(r.data.value) : [];
            if (tags.indexOf(data.name) < 0) {
              tags.push(data.name);
              sb.from('meta').upsert({ user_id: uid, key: 'known_tags', value: JSON.stringify(tags) })
                .then(function (res) { if (res.error) console.error('River:', res.error); });
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
            .then(function (res) { if (res.error) console.error('River:', res.error); });
        });
        break;
      case 'plan_reposition':
        var rpBranch = sb.from('timelines').select('id')
          .eq('user_id', uid).eq('name', '_plan_lane_' + (data.lane + 1)).single();
        rpBranch.then(function (r) {
          if (!r.data) return;
          sb.from('tasks').update({ anchor: R.positionToAnchor(data.position) })
            .eq('id', data.task_id).eq('user_id', uid).eq('timeline_id', r.data.id)
            .then(function (res) { if (res.error) console.error('River:', res.error); });
        });
        break;
      case 'plan_remove':
        var rmBranch = sb.from('timelines').select('id')
          .eq('user_id', uid).eq('name', '_plan_lane_' + (data.lane + 1)).single();
        rmBranch.then(function (r) {
          if (!r.data) return;
          sb.from('tasks').delete()
            .eq('id', data.task_id).eq('user_id', uid).eq('timeline_id', r.data.id)
            .then(function (res) { if (res.error) console.error('River:', res.error); });
        });
        break;
    }
  };

})();

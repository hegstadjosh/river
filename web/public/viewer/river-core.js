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
  R.AMBER        = [200, 165, 110]; // the color of the now-light

  // ── State ───────────────────────────────────────────────────────────

  R.state = null;
  // R.tasks is owned by river-store.js — initialized there
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

  R.positionToAnchor = function (pos) {
    return new Date(Date.now() + pos * 3600000).toISOString();
  };

  R.anchorToPosition = function (anchor) {
    return (new Date(anchor).getTime() - Date.now()) / 3600000;
  };

  // ── Server operations ──────────────────────────────────────────
  // Every mutation goes through /api/state (cookie-authenticated).
  // The response is the full fresh state — applied immediately so the
  // viewer reconciles without waiting for the next poll.

  R.post = function (action, data, optimisticFn) {
    if (optimisticFn) {
      try { optimisticFn(R.tasks); } catch (e) { console.error('optimistic', e); }
    }

    fetch('/api/state', {
      method: 'POST', headers: R.authHeaders(),
      body: JSON.stringify(Object.assign({ action: action }, data))
    }).then(function (r) { return r.json(); })
      .then(function (d) { R.applyState(d); })
      .catch(function () {});
  };

})();

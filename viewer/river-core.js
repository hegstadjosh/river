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

  // Tag hues (unused but preserved)
  R.TAG_HUES = {};
  R.DEFAULT_HUE = 30;

  // ── Palette ─────────────────────────────────────────────────────────
  R.SKY_COLOR    = '#17161a';  // cool dark — a night sky
  R.WATER_TOP    = '#231e19';  // warm dark — shallow water
  R.WATER_DEEP   = '#1e1a15';  // slightly deeper
  R.SURFACE_GLOW = 'rgba(200, 165, 110, 0.06)'; // where light hits water
  R.AMBER        = [200, 165, 110]; // the color of the now-light

  // ── State ───────────────────────────────────────────────────────────

  R.state = null;
  R.animTasks = [];
  R.selectedId = null;
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

  R.findTask = function (id) {
    for (var i = 0; i < R.animTasks.length; i++)
      if (R.animTasks[i].id === id) return R.animTasks[i];
    return null;
  };

  R.post = function (action, data) {
    fetch('/state', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ action: action }, data))
    }).catch(function () {});
  };

  // Energy -> color (HSL). 0 = cool blue, 1 = rich red
  R.energyColor = function (energy, sol, alpha) {
    var e = Math.max(0, Math.min(1, energy || 0));
    var hue, sat, lit;
    if (e < 0.33) {
      var t = e / 0.33;
      hue = 220 - t * 10;
      sat = 30 + t * 20;
      lit = 25 + t * 25;
    } else if (e < 0.66) {
      var t = (e - 0.33) / 0.33;
      hue = 210 - t * 180;
      sat = 50 + t * 15;
      lit = 50 + t * 5;
    } else {
      var t = (e - 0.66) / 0.34;
      hue = 30 - t * 25;
      sat = 65 + t * 15;
      lit = 55 - t * 15;
    }
    sat *= (0.4 + sol * 0.6);
    return 'hsla(' + hue + ',' + sat + '%,' + lit + '%,' + alpha + ')';
  };

  // Tag hue lookup (unused but preserved)
  R.tagHue = function (tags) {
    if (!tags || !tags.length) return R.DEFAULT_HUE;
    for (var i = 0; i < tags.length; i++) {
      var h = R.TAG_HUES[tags[i].toLowerCase()];
      if (h !== undefined) return h;
    }
    return R.DEFAULT_HUE;
  };
})();

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
      alpha: 0.012 + Math.random() * 0.018,
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
      var speed = 1.5 + Math.random() * 3.5; // px/sec, very slow
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

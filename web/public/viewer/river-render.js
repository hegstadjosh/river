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

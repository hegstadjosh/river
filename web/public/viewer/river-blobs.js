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

    // ── Dimensions ──
    // Width = exact duration in pixels for river tasks.
    // During wizard drag: show duration-based size even though still a cloud task.
    var hw, hh;
    var isRiverOrWizard = (a.position !== null && a.position !== undefined) ||
      (R.wizardState && R.wizardState.active && R.wizardState.taskId === a.id);
    if (isRiverOrWizard) {
      var durationPx = (a.mass / 60) * R.PIXELS_PER_HOUR;
      hw = Math.max(8, durationPx / 2);
      hh = Math.min(hw, Math.max(14, hw * 0.6));
      hh = Math.min(hh, 60);
      // Clamp to lane height (small margin for separator lines)
      if (a.ctx && a.ctx.type === 'lane' && R.planLaneHeight) {
        hh = Math.min(hh, (R.planLaneHeight() - 4) / 2);
      }
    } else {
      hw = 18; hh = 18;
    }

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

  };
})();

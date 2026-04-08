(function () {
  'use strict';

  // ── Constants ───────────────────────────────────────────────────────
  const PIXELS_PER_HOUR = 200;
  const CLOUD_ZONE_RATIO = 0.33;
  const NOW_X_RATIO = 0.25;
  const SPRING_K = 0.08;
  const DRAG_THRESHOLD = 5;
  const BLOB_SCALE = 3.5;

  // Tag → hue mapping (warm palette)
  const TAG_HUES = {
    work: 25,
    personal: 210,
    health: 140,
    creative: 270,
  };
  const DEFAULT_HUE = 30;

  // ── State ───────────────────────────────────────────────────────────
  let state = null; // latest LookResult from SSE
  let animationTasks = []; // { ...task, rx, ry, targetX, targetY }
  let selectedId = null;
  let dragging = null; // { id, startX, startY, startMouseX, startMouseY, moved, fromZone }
  let lastFrameTime = 0;

  // ── Canvas Setup ────────────────────────────────────────────────────
  const canvas = document.getElementById('river-canvas');
  const ctx = canvas.getContext('2d');
  let width, height, dpr;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  window.addEventListener('resize', resize);
  resize();

  // ── Layout Helpers ──────────────────────────────────────────────────
  function nowX() {
    return width * NOW_X_RATIO;
  }

  function cloudBoundary() {
    return height * CLOUD_ZONE_RATIO;
  }

  function riverCenterY() {
    return cloudBoundary() + (height - cloudBoundary()) * 0.5;
  }

  // Deterministic hash for cloud task placement
  function hashId(id) {
    var h = 0;
    for (var i = 0; i < id.length; i++) {
      h = ((h << 5) - h + id.charCodeAt(i)) | 0;
    }
    return h;
  }

  function cloudPosition(task) {
    var h = hashId(task.id);
    var cx = width * 0.3 + ((h & 0xffff) / 0xffff) * width * 0.4;
    var cy = 40 + (((h >>> 16) & 0x7fff) / 0x7fff) * (cloudBoundary() - 80);
    return { x: cx, y: cy };
  }

  function riverPosition(task) {
    var x = nowX() + (task.position || 0) * PIXELS_PER_HOUR;
    // Spread tasks vertically by hash to avoid exact overlap
    var h = hashId(task.id);
    var yOff = ((h & 0xff) / 0xff - 0.5) * (height - cloudBoundary()) * 0.4;
    var y = riverCenterY() + yOff;
    return { x: x, y: y };
  }

  function blobRadius(mass) {
    return Math.sqrt(mass) * BLOB_SCALE;
  }

  function tagHue(tags) {
    if (!tags || tags.length === 0) return DEFAULT_HUE;
    for (var i = 0; i < tags.length; i++) {
      var h = TAG_HUES[tags[i].toLowerCase()];
      if (h !== undefined) return h;
    }
    return DEFAULT_HUE;
  }

  // ── Flow Streaks ────────────────────────────────────────────────────
  var streaks = [];
  function initStreaks() {
    streaks = [];
    for (var i = 0; i < 12; i++) {
      streaks.push({
        y: cloudBoundary() + Math.random() * (height - cloudBoundary()),
        x: Math.random() * width,
        length: 80 + Math.random() * 200,
        speed: 15 + Math.random() * 30,
        opacity: 0.03 + Math.random() * 0.025,
      });
    }
  }
  initStreaks();

  // ── Animation Task Management ───────────────────────────────────────
  function syncAnimationTasks() {
    if (!state) return;

    var allTasks = (state.river || []).concat(state.cloud || []);
    var taskMap = {};
    for (var i = 0; i < allTasks.length; i++) {
      taskMap[allTasks[i].id] = allTasks[i];
    }

    // Remove tasks no longer present
    animationTasks = animationTasks.filter(function (at) {
      return taskMap[at.id];
    });

    var existingIds = {};
    for (var j = 0; j < animationTasks.length; j++) {
      existingIds[animationTasks[j].id] = j;
    }

    // Update or add
    for (var k = 0; k < allTasks.length; k++) {
      var task = allTasks[k];
      var target =
        task.position !== null && task.position !== undefined
          ? riverPosition(task)
          : cloudPosition(task);

      if (existingIds[task.id] !== undefined) {
        var at = animationTasks[existingIds[task.id]];
        // Update task data but keep render positions for spring interp
        at.name = task.name;
        at.mass = task.mass;
        at.solidity = task.solidity;
        at.fixed = task.fixed;
        at.alive = task.alive;
        at.tags = task.tags;
        at.position = task.position;
        at.anchor = task.anchor;
        at.targetX = target.x;
        at.targetY = target.y;
      } else {
        // New task — snap to target
        animationTasks.push({
          id: task.id,
          name: task.name,
          mass: task.mass,
          solidity: task.solidity,
          fixed: task.fixed,
          alive: task.alive,
          tags: task.tags,
          position: task.position,
          anchor: task.anchor,
          rx: target.x,
          ry: target.y,
          targetX: target.x,
          targetY: target.y,
          vx: 0,
          vy: 0,
        });
      }
    }
  }

  // ── SSE Connection ──────────────────────────────────────────────────
  function connectSSE() {
    var es = new EventSource('/events');

    es.onmessage = function (e) {
      try {
        state = JSON.parse(e.data);
        syncAnimationTasks();
      } catch (err) {
        // ignore parse errors
      }
    };

    es.onerror = function () {
      // EventSource auto-reconnects
    };
  }

  // Initial state fetch
  fetch('/state')
    .then(function (r) {
      return r.json();
    })
    .then(function (data) {
      state = data;
      syncAnimationTasks();
    })
    .catch(function () {
      // viewer may be opened before server is ready
    });

  connectSSE();

  // ── API Helpers ─────────────────────────────────────────────────────
  function sendUpdate(action, payload) {
    fetch('/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ action: action }, payload)),
    }).catch(function () {
      // graceful — viewer may be read-only
    });
  }

  function sendDelete(id) {
    sendUpdate('delete', { id: id });
  }

  // ── Drawing ─────────────────────────────────────────────────────────
  function drawBackground() {
    // Dark warm base
    ctx.fillStyle = '#1a1614';
    ctx.fillRect(0, 0, width, height);

    // River zone — slightly warmer
    var riverGrad = ctx.createLinearGradient(0, cloudBoundary() - 30, 0, cloudBoundary() + 30);
    riverGrad.addColorStop(0, 'rgba(26, 22, 20, 0)');
    riverGrad.addColorStop(1, 'rgba(35, 28, 22, 1)');
    ctx.fillStyle = riverGrad;
    ctx.fillRect(0, cloudBoundary() - 30, width, 60);

    ctx.fillStyle = 'rgba(35, 28, 22, 1)';
    ctx.fillRect(0, cloudBoundary() + 30, width, height - cloudBoundary() - 30);

    // Cloud zone — slightly cooler
    ctx.fillStyle = 'rgba(22, 20, 26, 0.3)';
    ctx.fillRect(0, 0, width, cloudBoundary() - 30);

    // Soft gradient boundary
    var boundaryGrad = ctx.createLinearGradient(0, cloudBoundary() - 50, 0, cloudBoundary() + 50);
    boundaryGrad.addColorStop(0, 'rgba(212, 170, 110, 0)');
    boundaryGrad.addColorStop(0.5, 'rgba(212, 170, 110, 0.03)');
    boundaryGrad.addColorStop(1, 'rgba(212, 170, 110, 0)');
    ctx.fillStyle = boundaryGrad;
    ctx.fillRect(0, cloudBoundary() - 50, width, 100);
  }

  function drawFlowStreaks(dt) {
    for (var i = 0; i < streaks.length; i++) {
      var s = streaks[i];
      s.x -= s.speed * dt;
      if (s.x + s.length < 0) {
        s.x = width + Math.random() * 100;
        s.y = cloudBoundary() + Math.random() * (height - cloudBoundary());
      }

      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + s.length, s.y);
      ctx.strokeStyle = 'rgba(212, 170, 110, ' + s.opacity + ')';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function drawNowLine(time) {
    var nx = nowX();
    // Breathing glow — sinusoidal ~4s
    var breath = Math.sin(time / 4000 * Math.PI * 2) * 0.5 + 0.5; // 0-1
    var glowRadius = 8 + breath * 12;
    var glowAlpha = 0.06 + breath * 0.06;

    // Glow
    var grad = ctx.createLinearGradient(nx - glowRadius, 0, nx + glowRadius, 0);
    grad.addColorStop(0, 'rgba(212, 170, 110, 0)');
    grad.addColorStop(0.5, 'rgba(212, 170, 110, ' + glowAlpha + ')');
    grad.addColorStop(1, 'rgba(212, 170, 110, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(nx - glowRadius, cloudBoundary(), glowRadius * 2, height - cloudBoundary());

    // Line
    ctx.beginPath();
    ctx.moveTo(nx, cloudBoundary());
    ctx.lineTo(nx, height);
    ctx.strokeStyle = 'rgba(212, 170, 110, ' + (0.35 + breath * 0.15) + ')';
    ctx.lineWidth = 2;
    ctx.stroke();

    // "now" label
    ctx.fillStyle = 'rgba(212, 170, 110, 0.4)';
    ctx.font = '10px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('now', nx, cloudBoundary() + 16);
  }

  function drawTimeMarkers() {
    if (!state) return;
    var nowDate = new Date(state.now);
    // Find the next hour boundary
    var nextHour = new Date(nowDate);
    nextHour.setMinutes(0, 0, 0);
    if (nextHour <= nowDate) nextHour.setHours(nextHour.getHours() + 1);

    // Draw markers from -2 hours to +12 hours
    var startHour = new Date(nowDate);
    startHour.setMinutes(0, 0, 0);
    startHour.setHours(startHour.getHours() - 1);

    for (var i = 0; i < 14; i++) {
      var markerTime = new Date(startHour.getTime() + i * 3600000);
      var hoursFromNow = (markerTime.getTime() - nowDate.getTime()) / 3600000;
      var x = nowX() + hoursFromNow * PIXELS_PER_HOUR;

      if (x < -50 || x > width + 50) continue;

      var h = markerTime.getHours();
      var ampm = h >= 12 ? 'pm' : 'am';
      var displayH = h % 12 || 12;
      var label = displayH + ampm;

      // Tick
      ctx.beginPath();
      ctx.moveTo(x, height - 8);
      ctx.lineTo(x, height);
      ctx.strokeStyle = 'rgba(212, 170, 110, 0.12)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Label
      ctx.fillStyle = 'rgba(212, 170, 110, 0.2)';
      ctx.font = '10px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, x, height - 12);
    }
  }

  function drawBlob(at, time) {
    var r = blobRadius(at.mass);
    var hue = tagHue(at.tags);
    var sol = at.solidity;
    var x = at.rx;
    var y = at.ry;

    // Alive state: grow, glow
    var isAlive = at.alive;
    var aliveScale = isAlive ? 1.35 : 1.0;
    var dimFactor = 1.0;
    // If any task is alive and this one isn't, dim it
    var anyAlive = false;
    for (var a = 0; a < animationTasks.length; a++) {
      if (animationTasks[a].alive) { anyAlive = true; break; }
    }
    if (anyAlive && !isAlive) dimFactor = 0.65;

    r *= aliveScale;

    // Fixed tasks → rock rendering
    if (at.fixed) {
      drawRock(x, y, r, at, dimFactor);
      return;
    }

    // Solidity → visual parameters
    // 0.9+ = sharp/vivid, 0.5 = moderate, 0.1 = wispy/transparent
    var baseAlpha = 0.15 + sol * 0.75; // 0.15 – 0.90
    var blur = (1 - sol) * 12; // 0–12px
    var saturation = 25 + sol * 50; // 25–75%
    var lightness = 45 + (1 - sol) * 20; // 45–65%

    baseAlpha *= dimFactor;

    ctx.save();

    // Alive glow
    if (isAlive) {
      var breath = Math.sin(time / 4000 * Math.PI * 2) * 0.5 + 0.5;
      var glowR = r * 1.8 + breath * r * 0.3;
      var glowGrad = ctx.createRadialGradient(x, y, r * 0.3, x, y, glowR);
      glowGrad.addColorStop(0, 'hsla(' + hue + ', ' + saturation + '%, ' + lightness + '%, 0.2)');
      glowGrad.addColorStop(1, 'hsla(' + hue + ', ' + saturation + '%, ' + lightness + '%, 0)');
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.ellipse(x, y, glowR, glowR * 0.9, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Apply blur for low-solidity blobs
    if (blur > 1) {
      ctx.filter = 'blur(' + blur.toFixed(1) + 'px)';
    }

    // 2-3 offset ellipses for organic shape
    var offsets = [
      { dx: 0, dy: 0, rx: r, ry: r * 0.88, alpha: baseAlpha },
      { dx: r * 0.12, dy: -r * 0.08, rx: r * 0.92, ry: r * 0.95, alpha: baseAlpha * 0.7 },
      { dx: -r * 0.08, dy: r * 0.1, rx: r * 0.85, ry: r * 0.82, alpha: baseAlpha * 0.5 },
    ];

    for (var i = 0; i < offsets.length; i++) {
      var o = offsets[i];
      var grad = ctx.createRadialGradient(
        x + o.dx, y + o.dy, 0,
        x + o.dx, y + o.dy, o.rx
      );
      grad.addColorStop(0, 'hsla(' + hue + ', ' + saturation + '%, ' + lightness + '%, ' + o.alpha + ')');
      grad.addColorStop(0.7, 'hsla(' + hue + ', ' + (saturation * 0.7) + '%, ' + (lightness * 0.8) + '%, ' + (o.alpha * 0.5) + ')');
      grad.addColorStop(1, 'hsla(' + hue + ', ' + saturation + '%, ' + lightness + '%, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(x + o.dx, y + o.dy, o.rx, o.ry, 0.1 * (i - 1), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.filter = 'none';

    // Selection ring
    if (selectedId === at.id) {
      ctx.beginPath();
      ctx.ellipse(x, y, r + 4, r * 0.88 + 4, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(212, 170, 110, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();

    // Label
    var labelAlpha = Math.min(baseAlpha + 0.15, 0.9) * dimFactor;
    ctx.fillStyle = 'rgba(212, 196, 176, ' + labelAlpha + ')';
    ctx.font = (sol > 0.6 ? 'bold ' : '') + '12px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(at.name, x, y);
  }

  function drawRock(x, y, r, at, dimFactor) {
    // Fixed tasks: rounded rectangles with stone gradient
    var w = r * 1.6;
    var h = r * 1.2;
    var cornerR = 6;
    var alpha = 0.85 * dimFactor;

    ctx.save();

    // Stone gradient
    var grad = ctx.createLinearGradient(x - w / 2, y - h / 2, x + w / 2, y + h / 2);
    grad.addColorStop(0, 'rgba(140, 130, 115, ' + alpha + ')');
    grad.addColorStop(0.5, 'rgba(120, 112, 100, ' + alpha + ')');
    grad.addColorStop(1, 'rgba(100, 92, 80, ' + alpha + ')');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, cornerR);
    ctx.fill();

    // Subtle bevel highlight
    var bevelGrad = ctx.createLinearGradient(x, y - h / 2, x, y - h / 2 + 6);
    bevelGrad.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
    bevelGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = bevelGrad;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, 6, [cornerR, cornerR, 0, 0]);
    ctx.fill();

    // Selection ring
    if (selectedId === at.id) {
      ctx.beginPath();
      ctx.roundRect(x - w / 2 - 3, y - h / 2 - 3, w + 6, h + 6, cornerR + 3);
      ctx.strokeStyle = 'rgba(212, 170, 110, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();

    // Label
    ctx.fillStyle = 'rgba(235, 225, 210, ' + (0.85 * dimFactor) + ')';
    ctx.font = 'bold 12px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(at.name, x, y);
  }

  // ── Hit Testing ─────────────────────────────────────────────────────
  function hitTest(mx, my) {
    // Check in reverse order (topmost first)
    for (var i = animationTasks.length - 1; i >= 0; i--) {
      var at = animationTasks[i];
      var r = blobRadius(at.mass) * (at.alive ? 1.35 : 1.0);

      if (at.fixed) {
        // Rectangular hit test for rocks
        var w = r * 1.6;
        var h = r * 1.2;
        if (
          mx >= at.rx - w / 2 &&
          mx <= at.rx + w / 2 &&
          my >= at.ry - h / 2 &&
          my <= at.ry + h / 2
        ) {
          return at;
        }
      } else {
        // Circular hit test for blobs
        var dx = mx - at.rx;
        var dy = my - at.ry;
        if (dx * dx + dy * dy <= r * r) {
          return at;
        }
      }
    }
    return null;
  }

  // ── Panel ───────────────────────────────────────────────────────────
  var panel = document.getElementById('panel');
  var panelName = document.getElementById('panel-name');
  var panelMass = document.getElementById('panel-mass');
  var panelSolidity = document.getElementById('panel-solidity');
  var panelFixed = document.getElementById('panel-fixed');
  var panelDissolve = document.getElementById('panel-dissolve');

  function showPanel(at, screenX, screenY) {
    selectedId = at.id;

    panelName.value = at.name;
    panelMass.value = at.mass;
    panelSolidity.value = Math.round(at.solidity * 100);
    panelFixed.checked = at.fixed;

    // Position near click, keep on screen
    var pw = 220;
    var ph = 230;
    var px = screenX + 20;
    var py = screenY - ph / 2;

    if (px + pw > width - 10) px = screenX - pw - 20;
    if (py < 10) py = 10;
    if (py + ph > height - 10) py = height - ph - 10;

    panel.style.left = px + 'px';
    panel.style.top = py + 'px';
    panel.classList.remove('hidden');
  }

  function hidePanel() {
    panel.classList.add('hidden');
    selectedId = null;
  }

  // Panel events — live updates
  var nameTimeout = null;
  panelName.addEventListener('input', function () {
    if (!selectedId) return;
    clearTimeout(nameTimeout);
    nameTimeout = setTimeout(function () {
      sendUpdate('put', { id: selectedId, name: panelName.value });
    }, 300);
  });

  panelMass.addEventListener('input', function () {
    if (!selectedId) return;
    sendUpdate('put', { id: selectedId, mass: Number(panelMass.value) });
  });

  panelSolidity.addEventListener('input', function () {
    if (!selectedId) return;
    sendUpdate('put', { id: selectedId, solidity: Number(panelSolidity.value) / 100 });
  });

  panelFixed.addEventListener('change', function () {
    if (!selectedId) return;
    sendUpdate('put', { id: selectedId, fixed: panelFixed.checked });
  });

  panelDissolve.addEventListener('click', function () {
    if (!selectedId) return;
    sendDelete(selectedId);
    hidePanel();
  });

  // ── Mouse Interaction ───────────────────────────────────────────────
  canvas.addEventListener('mousedown', function (e) {
    var mx = e.clientX;
    var my = e.clientY;
    var hit = hitTest(mx, my);

    if (hit) {
      var zone = hit.position !== null && hit.position !== undefined ? 'river' : 'cloud';
      dragging = {
        id: hit.id,
        startX: hit.rx,
        startY: hit.ry,
        startMouseX: mx,
        startMouseY: my,
        moved: false,
        fromZone: zone,
      };
    } else {
      // Clicked empty space — hide panel
      hidePanel();
    }
  });

  canvas.addEventListener('mousemove', function (e) {
    if (!dragging) {
      // Cursor change on hover
      var hit = hitTest(e.clientX, e.clientY);
      canvas.style.cursor = hit ? 'grab' : 'default';
      return;
    }

    var dx = e.clientX - dragging.startMouseX;
    var dy = e.clientY - dragging.startMouseY;

    if (!dragging.moved && Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) {
      return;
    }

    dragging.moved = true;
    canvas.style.cursor = 'grabbing';

    // Directly move the render position while dragging
    var at = findAnimTask(dragging.id);
    if (at) {
      at.rx = dragging.startX + dx;
      at.ry = dragging.startY + dy;
      at.targetX = at.rx;
      at.targetY = at.ry;
    }
  });

  canvas.addEventListener('mouseup', function (e) {
    if (!dragging) return;

    var drag = dragging;
    dragging = null;
    canvas.style.cursor = 'default';

    if (!drag.moved) {
      // Click — select task and show panel
      var at = findAnimTask(drag.id);
      if (at) showPanel(at, e.clientX, e.clientY);
      return;
    }

    // Drag completed — determine zone transition
    var at = findAnimTask(drag.id);
    if (!at) return;

    var dropY = at.ry;
    var boundary = cloudBoundary();

    if (drag.fromZone === 'cloud' && dropY > boundary) {
      // Cloud → River: give position based on x
      var hoursFromNow = (at.rx - nowX()) / PIXELS_PER_HOUR;
      sendUpdate('move', { id: drag.id, position: hoursFromNow });
    } else if (drag.fromZone === 'river' && dropY < boundary) {
      // River → Cloud: remove position
      sendUpdate('move', { id: drag.id, position: null });
    } else if (drag.fromZone === 'river' && dropY >= boundary) {
      // River → River: change position
      var hoursFromNow = (at.rx - nowX()) / PIXELS_PER_HOUR;
      sendUpdate('move', { id: drag.id, position: hoursFromNow });
    }
    // Cloud → Cloud: no-op (just repositioning visually, no persistence)
  });

  // Prevent context menu on canvas
  canvas.addEventListener('contextmenu', function (e) {
    e.preventDefault();
  });

  function findAnimTask(id) {
    for (var i = 0; i < animationTasks.length; i++) {
      if (animationTasks[i].id === id) return animationTasks[i];
    }
    return null;
  }

  // ── Animation Loop ──────────────────────────────────────────────────
  function frame(timestamp) {
    requestAnimationFrame(frame);

    var dt = lastFrameTime ? (timestamp - lastFrameTime) / 1000 : 1 / 60;
    dt = Math.min(dt, 0.1); // clamp to avoid huge jumps
    lastFrameTime = timestamp;

    // Spring interpolation for positions
    for (var i = 0; i < animationTasks.length; i++) {
      var at = animationTasks[i];

      // Skip if being dragged
      if (dragging && dragging.id === at.id && dragging.moved) continue;

      // Spring toward target
      var dx = at.targetX - at.rx;
      var dy = at.targetY - at.ry;
      at.vx += dx * SPRING_K;
      at.vy += dy * SPRING_K;
      at.vx *= 0.82; // damping
      at.vy *= 0.82;
      at.rx += at.vx;
      at.ry += at.vy;
    }

    // Draw
    drawBackground();
    drawFlowStreaks(dt);
    drawNowLine(timestamp);
    drawTimeMarkers();

    // Draw blobs (sorted: river first, then cloud; alive last so it renders on top)
    var sortedTasks = animationTasks.slice().sort(function (a, b) {
      if (a.alive !== b.alive) return a.alive ? 1 : -1;
      if (a.fixed !== b.fixed) return a.fixed ? -1 : 1;
      return 0;
    });

    for (var j = 0; j < sortedTasks.length; j++) {
      drawBlob(sortedTasks[j], timestamp);
    }

    // Cloud zone label (very faint)
    ctx.fillStyle = 'rgba(212, 170, 110, 0.08)';
    ctx.font = '11px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('cloud', 14, 22);
  }

  requestAnimationFrame(frame);
})();

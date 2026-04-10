// viewer/river-input.js — ALL mouse event handlers, hitTest, edgeHit, drag/resize logic, quick-add, resize overlay
(function () {
  'use strict';

  var R = window.River;

  // ── Hit Testing ─────────────────────────────────────────────────────

  R.hitTest = function (mx, my) {
    for (var i = R.animTasks.length - 1; i >= 0; i--) {
      var a = R.animTasks[i];
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
    for (var i = R.animTasks.length - 1; i >= 0; i--) {
      var a = R.animTasks[i];
      var d = R.taskStretch(a);
      var grabHW = Math.max(R.MIN_HIT, d.hw);
      var grabHH = Math.max(R.MIN_HIT, d.hh);

      // Check vertical handles (top/bottom) — always available, even cloud tasks
      var tEdge = a.y - grabHH;
      var bEdge = a.y + grabHH;
      if (Math.abs(mx - a.x) <= grabHW) {
        if (my >= tEdge - R.HANDLE_ZONE && my <= tEdge + 2) return { task: a, side: 'top' };
        if (my >= bEdge - 2 && my <= bEdge + R.HANDLE_ZONE) return { task: a, side: 'bottom' };
      }

      // Check horizontal handles (left/right) — only river tasks
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
        startX: edge.task.x
      };
      R.canvas.style.cursor = (edge.side === 'top' || edge.side === 'bottom') ? 'ns-resize' : 'ew-resize';
      return;
    }

    if (hit) {
      R.dragging = {
        id: hit.id,
        sx: hit.x, sy: hit.y,
        mx: e.clientX, my: e.clientY,
        moved: false,
        zone: (hit.position !== null && hit.position !== undefined) ? 'river' : 'cloud'
      };
    } else {
      R.hidePanel();
    }
  });

  // ── Mouse Move ──────────────────────────────────────────────────────

  R.canvas.addEventListener('mousemove', function (e) {
    R.mouseX = e.clientX; R.mouseY = e.clientY;

    // Resizing (horizontal or vertical)
    if (R.resizing) {
      var a = R.findTask(R.resizing.id);
      if (!a) return;

      if (R.resizing.side === 'top') {
        // Top = commitment. Drag up = more committed.
        var deltaY = R.resizing.startMY - e.clientY;
        var newSol = Math.max(0, Math.min(1, R.resizing.startSolidity + deltaY / 80));
        a.solidity = newSol;
        var panelSolidity = document.getElementById('panel-solidity');
        if (R.selectedId === a.id) panelSolidity.value = Math.round(newSol * 100);
        R.canvas.style.cursor = 'ns-resize';
      } else if (R.resizing.side === 'bottom') {
        // Bottom = energy. Drag up = more energy.
        var deltaY = R.resizing.startMY - e.clientY;
        var newEnergy = Math.max(0, Math.min(1, R.resizing.startEnergy + deltaY / 80));
        a.energy = newEnergy;
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
        R.canvas.style.cursor = R.hitTest(e.clientX, e.clientY) ? 'grab' : 'default';
      }
      return;
    }
    var dx = e.clientX - R.dragging.mx, dy = e.clientY - R.dragging.my;
    if (!R.dragging.moved && Math.sqrt(dx*dx + dy*dy) < R.DRAG_THRESHOLD) return;
    R.dragging.moved = true;
    R.canvas.style.cursor = 'grabbing';
    var a = R.findTask(R.dragging.id);
    if (a) {
      var rawX = R.dragging.sx + dx;
      // Snap the START edge (left edge = center - halfWidth) to grid
      var dd = R.taskStretch(a);
      var startEdgeX = rawX - dd.hw;
      var snappedStart = R.snapX(startEdgeX);
      a.x = snappedStart + dd.hw; // shift center so start edge aligns
      a.y = R.dragging.sy + dy;
      a.tx = a.x; a.ty = a.y;
    }
  });

  // ── Mouse Up ────────────────────────────────────────────────────────

  R.canvas.addEventListener('mouseup', function (e) {
    // Finish resize
    if (R.resizing) {
      var a = R.findTask(R.resizing.id);
      if (a) {
        if (R.resizing.side === 'top') {
          R.post('put', { id: R.resizing.id, solidity: a.solidity });
        } else if (R.resizing.side === 'bottom') {
          R.post('put', { id: R.resizing.id, energy: a.energy });
        } else {
          var newMass = a.mass;
          var massDiffHours = (newMass - R.resizing.startMass) / 60;
          var updates = { id: R.resizing.id, mass: newMass };
          if (R.resizing.side === 'right') {
            updates.position = R.resizing.startPosition + massDiffHours / 2;
          } else {
            updates.position = R.resizing.startPosition - massDiffHours / 2;
          }
          R.post('put', updates);
        }
      }
      R.resizing = null;
      R.canvas.style.cursor = 'default';
      return;
    }

    if (!R.dragging) return;
    var d = R.dragging; R.dragging = null; R.canvas.style.cursor = 'default';

    if (!d.moved) {
      var a = R.findTask(d.id);
      if (a) R.showPanel(a, e.clientX, e.clientY);
      return;
    }

    var a = R.findTask(d.id);
    if (!a) return;
    var boundary = R.surfaceY();

    // Convert snapped start edge to hours-from-now
    var dd2 = R.taskStretch(a);
    var startEdge = a.x - dd2.hw;
    var dropHours = R.screenXToHours(startEdge) + a.mass / 120; // center = start + halfDur
    if (d.zone === 'cloud' && a.y > boundary) {
      a.customY = a.y;
      R.post('move', { id: d.id, position: dropHours });
    } else if (d.zone === 'river' && a.y < boundary) {
      a.customY = a.y;
      R.post('move', { id: d.id, position: null });
    } else if (d.zone === 'river') {
      a.customY = a.y;
      var dd3 = R.taskStretch(a);
      var startEdge2 = a.x - dd3.hw;
      var dropHours2 = R.screenXToHours(startEdge2) + a.mass / 120;
      R.post('move', { id: d.id, position: dropHours2 });
    } else {
      a.customY = a.y;
    }
    a.ty = a.y;
  });

  R.canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // ── Quick Add (double-click) ────────────────────────────────────────
  // Double-click empty space -> input appears -> type name -> task created
  // In cloud zone: creates a cloud task. In river zone: creates at that time position.

  var quickAdd = document.getElementById('quick-add');
  var quickAddPos = null; // null = cloud, number = hours from now

  R.canvas.addEventListener('dblclick', function (e) {
    if (R.hitTest(e.clientX, e.clientY)) return; // double-clicked a task, ignore

    var sY = R.surfaceY();
    quickAddPos = (e.clientY > sY)
      ? (e.clientX - R.W * R.NOW_X) / R.PIXELS_PER_HOUR + R.scrollHours
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
      R.post('put', payload);
      quickAdd.classList.add('hidden');
      quickAdd.value = '';
    } else if (e.key === 'Escape') {
      quickAdd.classList.add('hidden');
    }
  });

  quickAdd.addEventListener('blur', function () {
    quickAdd.classList.add('hidden');
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

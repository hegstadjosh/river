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
        R.post('plan_commit', { lane: commitLane });
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
      var cloudThreshold = boundary - 30;
      var inCloud = e.clientY < cloudThreshold;
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

      var rawX = R.dragging.sx + dx;
      // Snap the START edge (left edge = center - halfWidth) to grid
      var dd = R.taskStretch(a);
      var startEdgeX = rawX - dd.hw;
      var snappedStart = R.snapX(startEdgeX);
      a.x = snappedStart + dd.hw; // shift center so start edge aligns
      a.y = R.dragging.sy + dy;
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
      } else if (dropLane >= 0) {
        R.savePosition(d.id, dropHours);
      }
      return;
    }

    // Plan mode: cloud task dropped into a lane
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

    // Reset dwell on any mouseup
    if (R.dwellReset) R.dwellReset();

    if (!d.moved) {
      // Deactivate wizard if click (no drag)
      if (R.wizardIsActive && (R.wizardIsActive() || R.wizardIsCompleted())) {
        R.wizardDeactivate();
      }
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

    // ── Wizard cleanup on mouseup ──
    // Wizard already transformed the task's properties directly.
    // Just persist them with the move.
    var wizardWasActive = d.wizardStarted && R.wizardDeactivate;
    if (wizardWasActive) R.wizardDeactivate();

    // Convert snapped start edge to hours-from-now
    var dd2 = R.taskStretch(a);
    var startEdge = a.x - dd2.hw;
    var dropHours = R.screenXToHours(startEdge) + a.mass / 120;
    // Build one combined update — wizard properties + position change
    var updates = {};
    if (wizardWasActive) {
      updates.mass = a.mass;
      updates.solidity = a.solidity;
      updates.energy = a.energy;
    }

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
          var gdd = R.taskStretch(gt);
          var gStartEdge = gt.x - gdd.hw;
          gUpdates.position = R.screenXToHours(gStartEdge) + gt.mass / 120;
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

  var quickAdd = document.getElementById('quick-add');
  var quickAddPos = null; // null = cloud, number = hours from now
  var quickAddLane = -1;  // -1 = not in a plan lane

  R.canvas.addEventListener('dblclick', function (e) {
    if (R.hitTest(e.clientX, e.clientY)) return;

    var sY = R.surfaceY();

    // Plan mode: double-click in a lane creates a task there
    if (R.planMode) {
      var lane = R.planLaneAt(e.clientY);
      if (lane >= 0) {
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

    quickAdd.style.left = (e.clientX - 100) + 'px';
    quickAdd.style.top = (e.clientY - 18) + 'px';
    quickAdd.classList.remove('hidden');
    quickAdd.value = '';
    quickAdd.focus();
  });

  quickAdd.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && quickAdd.value.trim()) {
      if (quickAddLane >= 0) {
        // Create task directly in plan lane
        R.post('plan_lane_put', { lane: quickAddLane, name: quickAdd.value.trim(), position: quickAddPos });
      } else {
        var payload = { name: quickAdd.value.trim() };
        if (quickAddPos !== null) payload.position = quickAddPos;
        R.post('put', payload);
      }
      quickAdd.classList.add('hidden');
      quickAdd.value = '';
    } else if (e.key === 'Escape') {
      quickAdd.classList.add('hidden');
    }
  });

  // Escape exits plan mode
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && R.planMode && !quickAdd.classList.contains('hidden')) return;
    if (e.key === 'Escape' && R.planMode) {
      R.post('plan_end', {});
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

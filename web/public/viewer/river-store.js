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
    // 15s window handles slow mobile networks; cleared early on fetchState success
    t._dirtyUntil = Date.now() + 15000;

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
    t._dirtyUntil = Date.now() + 15000;

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

    // ── Scroll-lock: shift actual positions to match scroll delta ──
    // Without this, tasks lag behind scroll via spring physics (~100-400px at speed).
    // By shifting actual positions by the same pixel delta as targets, tasks stay
    // locked to the viewport during scroll instead of trailing.
    var prevScroll = R._prevSyncScroll;
    R._prevSyncScroll = R.scrollHours;
    if (prevScroll !== undefined && prevScroll !== R.scrollHours) {
      var pxShift = (R.scrollHours - prevScroll) * R.PIXELS_PER_HOUR;
      for (var si = 0; si < R.tasks.length; si++) {
        var sa = R.tasks[si];
        if (R.dragging && R.dragging.id === sa.id) continue;
        if (sa.position === null || sa.position === undefined) continue;
        if (R.isMobile) {
          sa.y += pxShift;
        } else {
          sa.x -= pxShift;
        }
      }
    }

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
          // Use LOCAL (optimistic) state for target, not stale server data.
          // src still has the pre-save position until the server round-trips.
          var localTgt = computeTarget(a);
          a.tx = localTgt.x;
          a.ty = localTgt.y;
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
    // Only rebuild tag bar when server state changes — not during scroll-only syncs.
    // rebuildTagBar does full DOM teardown/rebuild which causes jank at 60fps scroll rate.
    if (R._lastSyncState !== R.state) {
      R._lastSyncState = R.state;
      R.rebuildTagBar();
    }
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

        var swatchWrap = document.createElement('div');
        swatchWrap.className = 'tag-swatch-wrap';

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

        swatchWrap.appendChild(swatch);

        // Triple-dot menu button (not on N/A)
        if (tag !== 'N/A') {
          var menuBtn = document.createElement('button');
          menuBtn.className = 'tag-menu-btn';
          menuBtn.textContent = '\u22EE';
          menuBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            // Dismiss any existing tag dropdown
            var old = document.querySelector('.tag-dropdown');
            if (old) { old.remove(); }

            var dropdown = document.createElement('div');
            dropdown.className = 'tag-dropdown';
            var btnRect = menuBtn.getBoundingClientRect();
            dropdown.style.left = btnRect.left + 'px';
            dropdown.style.top = (btnRect.bottom + 4) + 'px';

            // Rename option
            var renameItem = document.createElement('div');
            renameItem.className = 'tag-dropdown-item';
            renameItem.textContent = 'Rename';
            renameItem.addEventListener('click', function (re) {
              re.stopPropagation();
              dropdown.remove();
              startRename(item, label, tag);
            });
            dropdown.appendChild(renameItem);

            // Delete option
            var deleteItem = document.createElement('div');
            deleteItem.className = 'tag-dropdown-item tag-dropdown-delete';
            deleteItem.textContent = 'Delete';
            deleteItem.addEventListener('click', function (de) {
              de.stopPropagation();
              dropdown.remove();
              // Remove tag from all tasks that have it
              for (var ti = 0; ti < R.tasks.length; ti++) {
                var t = R.tasks[ti];
                if (t.tags && t.tags.indexOf(tag) >= 0) {
                  var newTags = t.tags.filter(function (x) { return x !== tag; });
                  R.save(t.id, { tags: newTags });
                }
              }
              // Remove from hidden tags if present
              if (R.hiddenTags[tag]) { delete R.hiddenTags[tag]; }
              // Remove from known_tags on server, then refresh
              R.post('tag_delete', { name: tag });
              // Immediate local update — remove from allTags so tag bar shows change now
              R.allTags = R.allTags.filter(function (t) { return t !== tag; });
              if (R.state && R.state.known_tags) {
                R.state.known_tags = R.state.known_tags.filter(function (t) { return t !== tag; });
              }
              R.rebuildTagBar();
            });
            dropdown.appendChild(deleteItem);

            document.body.appendChild(dropdown);

            // Click outside to dismiss
            function dismissDropdown(ev) {
              if (!dropdown.contains(ev.target)) {
                dropdown.remove();
                document.removeEventListener('pointerdown', dismissDropdown, true);
              }
            }
            setTimeout(function () {
              document.addEventListener('pointerdown', dismissDropdown, true);
            }, 0);
          });
          swatchWrap.appendChild(menuBtn);
        }

        // Double-click label to rename (keep existing behavior)
        label.addEventListener('dblclick', function (e) {
          e.stopPropagation();
          if (tag === 'N/A') return;
          startRename(item, label, tag);
        });

        function startRename(item, label, tag) {
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
              // Atomic rename — single server call, no race condition
              R.post('tag_rename', { oldName: tag, newName: newName });
              // Immediate local update
              if (R.state && R.state.known_tags) {
                R.state.known_tags = R.state.known_tags.map(function (t) { return t === tag ? newName : t; });
              }
            }
            R.rebuildTagBar();
          }
          input.addEventListener('blur', commit);
          input.addEventListener('keydown', function (ke) {
            if (ke.key === 'Enter') { ke.preventDefault(); input.blur(); }
            if (ke.key === 'Escape') { item.replaceChild(label, input); }
          });
        }

        item.appendChild(swatchWrap);
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
          // Immediate local update
          if (R.state && R.state.known_tags && R.state.known_tags.indexOf(name) < 0) {
            R.state.known_tags.push(name);
          }
          R.rebuildTagBar();
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

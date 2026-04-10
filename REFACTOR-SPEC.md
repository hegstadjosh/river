# River Viewer Refactor — Unified Task Store

## Problem

Every function in the viewer asks "is this a normal task or a plan task?" and branches. Two parallel arrays (`R.animTasks`, `R.planAnimTasks`), two hit-test functions, two find functions, two save paths. Adding any feature requires surgery on every file. This is the root cause of every bug in plan mode.

## Goal

One task array. One findTask. One edgeHit. One save path. Functions operate on tasks generically — they never ask what kind of task it is.

## Design

### 1. Unified Task Store (`river-store.js`)

Replace `R.animTasks` + `R.planAnimTasks` with a single `R.tasks` array.

Each task object gets a `ctx` field:
```js
ctx: { type: 'main' }           // normal river or cloud task
ctx: { type: 'lane', lane: 2 }  // plan mode lane task
```

Selector functions (all in this file):
```js
R.findTask(id)           // search one array
R.visibleTasks()         // all tasks appropriate for current mode
R.tasksInLane(n)         // filter by ctx
R.mainTasks()            // ctx.type === 'main'
R.riverTasks()           // main tasks with position
R.cloudTasks()           // main tasks without position
```

### 2. Single Save Path (`river-store.js`)

```js
R.save(taskId, changes)
// Internally resolves:
//   ctx.type === 'main'  → R.post('put', {id, ...changes})
//   ctx.type === 'lane'  → R.post('plan_update_task', {lane, task_id, ...changes})
```

Also:
```js
R.savePosition(taskId, position)
// main → R.post('move', {id, position})
// lane → R.post('plan_reposition', {lane, task_id, position})
```

The input handler calls `R.save()` and never thinks about context.

### 3. Unified Hit Testing

`R.hitTest(mx, my)` and `R.edgeHit(mx, my)` search `R.tasks` — one loop, no branching on plan mode. They already do this after the recent fix, but the store makes it clean.

### 4. Unified Physics

One physics loop in `river-main.js` iterates `R.tasks`. No separate `planPhysicsStep`. The spring math is identical — it was always identical.

### 5. Sync Merges Into One Path

`R.sync()` in `river-sse.js` currently has two branches — one for normal tasks, one for plan tasks. Refactor: it builds one array from server state, tagging each task with the right `ctx`.

```js
R.sync = function() {
  var all = [];
  // Main tasks
  (R.state.river || []).concat(R.state.cloud || []).forEach(function(t) {
    t.ctx = { type: 'main' };
    all.push(t);
  });
  // Plan lane tasks
  if (R.state.plan && R.state.plan.lanes) {
    R.state.plan.lanes.forEach(function(lane, i) {
      (lane.tasks || []).forEach(function(t) {
        t.ctx = { type: 'lane', lane: i };
        all.push(t);
      });
    });
  }
  // Merge into R.tasks with spring animation state preserved
  mergeIntoStore(all);
};
```

### 6. Input Handler Cleanup

The `river-input.js` mousedown/mousemove/mouseup handlers should NOT branch on plan mode for:
- Drag initiation (just grab a task from R.tasks)
- Resize (edgeHit already unified)
- Drop logic (R.save handles the context)

Plan-specific logic that DOES remain:
- Lane detection on drop (which lane did you drop into?)
- Commit button hit testing
- Cloud-to-lane copy gesture

These are genuinely plan-specific behaviors, not duplicated generic behaviors.

## Files Changed

| File | Change |
|------|--------|
| `river-store.js` | **NEW** — task array, selectors, save path |
| `river-core.js` | Remove `R.animTasks`, `R.findTask`. Add `R.tasks = []` |
| `river-sse.js` | Unified sync — one merge path |
| `river-input.js` | Remove plan/normal branching from drag, resize, hit test |
| `river-plan.js` | Remove `R.planAnimTasks`, `syncPlanTasks`, `planPhysicsStep`, `planHitTest`. Keep lane rendering, commit buttons |
| `river-main.js` | One physics loop, one render loop. Remove plan-mode fork |
| `river-blobs.js` | No change (already generic) |
| `river-render.js` | No change |
| `river-grid.js` | No change |
| `river-layout.js` | No change |
| `river-panel.js` | Use `R.save()` instead of `R.post('put', ...)` |
| `river-drag-wizard.js` | Remove plan-mode guards (already mostly done) |
| `index.html` | Add `river-store.js` script tag (before river-sse.js) |

## What NOT to Change

- Canvas rendering (drawBlob, drawWorld, drawStreaks) — already generic
- The backend (http.ts, state.ts, db/) — already works, just has many endpoints
- The MCP tools — no change needed
- The visual design — nothing changes visually

## Success Criteria

1. `grep -c 'planAnimTasks' viewer/*.js` returns 0
2. `grep -c 'R\.planMode' viewer/river-input.js` returns 0 or 1 (only for lane drop detection)
3. Plan mode works identically: create tasks, drag between lanes, resize handles, wizard bar, commit
4. Normal mode works identically: drag, resize, wizard, dwell switcher, panel
5. No visual changes — the app looks exactly the same

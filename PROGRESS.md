# River Overhaul — Build Progress

## Status: COMPLETE

## Deployment URL
**https://river-silk.vercel.app**

## Architecture Overview
- **Production path**: `/app` → `app/page.tsx` → loads `river-bundle.js` (contains ALL viewer code including mobile + clouds)
- **Standalone viewer**: `/viewer/index.html` → loads individual JS files
- **MCP transport**: Streamable HTTP (SSE was broken, switched in commit a777771)
- **Backend**: Supabase (tasks, timelines, meta, api_keys tables with RLS)
- **Local MCP server**: SQLite-backed, separate codebase in `src/`

## What Was Done

### Full Code Review (2026-04-13)
Comprehensive audit of all ~7,000 LOC across server, viewer, web app, MCP, and tests. Found and fixed issues at every severity level.

### P0 — Show-Stoppers (previously fixed)
- MCP SSE endpoint dead → switched to Streamable HTTP (a777771)
- Mobile touch handlers couldn't drag → series of mobile fixes (fee8030 and prior)

### P1 — Production Bugs (all fixed)
1. `river-bundle.js` stale → regenerated from individual files (dd9e8fd)
2. `index.html` missing script tags → added `river-clouds.js` and `river-mobile.js` (dd9e8fd)
3. MCP `look` tool ignoring input params → callback now takes `args` and passes them through (3de06cd)
4. `energy` field dropped in local MCP `put` tool → added to single-mode object (f86ab4a)
5. Tags not synced via MCP `put` → added `ensureTaskTags()` call (f86ab4a)
6. No Supabase error checking → added error throws on all critical mutations (3de06cd)
7. `JSON.parse(knownTagsResult)` crashing on corruption → wrapped in try/catch (3de06cd)
8. `cleanupPlan` losing branch context → saves/restores `pre_plan_timeline_id` (3de06cd)
9. Race conditions in lane operations → made sequential (insert first, then delete) (3de06cd)
10. Panel position drift → removed double scroll-offset subtraction (dd9e8fd)

### P2 — Dead Code (all removed)
- Unused schemas: MoveSchema, LookSchema, BranchSchema, SweepSchema removed (f86ab4a)
- `timeline_tasks` table: CREATE TABLE and DELETE FROM statements removed (f86ab4a)
- Unused viewer functions/constants: R.blobR, R.riverMidY, R.CLOUD_RATIO, R.SURFACE_GLOW, R.wizardGetSelections, R.wizardIsCompleted, R.getCalendarHorizon removed (dd9e8fd)
- Dead import: HTTP_PORT removed from http.ts (f86ab4a)

### P3 — Architecture Fixes (all fixed)
- Side-effectful reads: `look()` now only calls `recirculate()` on full look, not single-task or cloud-only queries (220f38e)
- Lane 1 read-only: programmatic enforcement via `fillLane` guard, `readonly: true` in plan state (220f38e)
- CORS `*` on localhost: restricted to `localhost:7433/7434` and `127.0.0.1:7433/7434` (f86ab4a)
- Missing column copies: `createBranch`, `addToLane`, `laneToCloud`, `moveBetweenLanes`, `copyBetweenLanes` now preserve `cloud_x`/`cloud_y`/`river_y` (220f38e)
- Lane count mismatch: aligned local server to 4 lanes matching web viewer (220f38e)
- Falsy-zero defaults: `||` → `??` for solidity/energy/mass in viewer task creation (220f38e)
- `.single()` → `.maybeSingle()` for tag_create meta lookup to avoid errors on first use (220f38e)

### Tests
- 124 tests passing (29 plan tests including new lane 1 read-only test)
- Web build passing (Next.js 16.2.3 with Turbopack)
- Local MCP server build passing (tsup)

## Architectural Decisions
- Kept 4-lane plan model (lane 1 = snapshot, lanes 2-4 = alternatives) aligned between local and web
- Service role key in MCP path is a deliberate design choice — all queries manually filter by `user_id`
- Supabase operations made sequential (not parallel) for lane manipulation to prevent data loss at the cost of slightly higher latency

## Known Limitations (not bugs)
- Service role key bypasses RLS in MCP path — mitigated by manual `user_id` filtering in every query
- No Supabase transactions — lane operations are sequential but not atomic; a server crash mid-operation could leave partial state
- `river-bundle.js` is manually concatenated — no build step to auto-generate it

## Git Log (overhaul commits)
- 220f38e: fix: P3 architecture fixes — side-effectful reads, lane enforcement, data integrity
- 3de06cd: fix: harden state layer — error checking, race safety, plan context restore
- f86ab4a: fix: MCP server cleanup — energy field, tag sync, dead code, CORS
- dd9e8fd: fix: viewer — missing scripts, panel drift, dead code, stale bundle
- a2e1d07: fix: error logging in viewer post(), look() options, getPlanState off-by-one

# River Overhaul — Build Progress

## Status: IN PROGRESS

## Deployment URL
**https://river-silk.vercel.app**

## Architecture Overview
- **Production path**: `/app` → `app/page.tsx` → loads `river-bundle.js` (contains ALL viewer code including mobile + clouds)
- **Standalone viewer**: `/viewer/index.html` → loads individual JS files (missing clouds + mobile script tags)
- **MCP transport**: Streamable HTTP (SSE was broken, switched in commit a777771)
- **Backend**: Supabase (tasks, timelines, meta, api_keys tables with RLS)
- **Local MCP server**: SQLite-backed, separate codebase in `src/`

## Audit Findings (2026-04-13)

### P0 — Show-Stoppers (previously fixed)
- MCP SSE dead → switched to Streamable HTTP (a777771)
- Mobile touch broken → series of mobile fixes (fee8030 and prior)

### P1 — Production Bugs
1. **`river-bundle.js` is stale** — missing error-logging changes to river-core.js and look() options in state.ts
2. **`index.html` missing script tags** for `river-clouds.js` and `river-mobile.js`
3. **MCP `look` tool ignores input params** in [transport]/route.ts — callback takes no args
4. **`energy` field dropped** in local MCP `put` tool (src/tools/put.ts)
5. **Tags not synced to `known_tags`** when tasks created via MCP put
6. **No error checking on Supabase operations** throughout state.ts — every mutation can fail silently
7. **`JSON.parse(knownTagsResult)` without try/catch** — corrupted meta crashes look()
8. **`cleanupPlan` resets to main timeline** instead of restoring previous branch
9. **Race conditions** in laneToCloud, addToLane, moveBetweenLanes (parallel non-transactional ops)
10. **Panel position drift** — double scroll-offset subtraction in river-panel.js

### P2 — Dead Code
- Unused schemas: MoveSchema, LookSchema, BranchSchema, SweepSchema in src/schema.ts
- `timeline_tasks` table created but never inserted into
- Unused viewer functions: R.blobR(), R.riverMidY(), R.formatTime(), R.planLaneHeight(), R.wizardGetSelections(), R.wizardIsCompleted(), R.getCalendarHorizon()
- Unused constants: R.CLOUD_RATIO, R.SURFACE_GLOW
- Dead import: HTTP_PORT in src/http.ts

### P3 — Architecture Concerns (not blocking, noted for future)
- `look()` calls `recirculate()` on every read (side-effectful reads)
- Lane 1 "read-only" not enforced programmatically
- CORS `*` on localhost HTTP server
- Service role key bypasses RLS in MCP path (manually filters by user_id)
- `createBranch` doesn't copy cloud_x/cloud_y/river_y columns

## What's Done
- [x] Full code review of all ~7,000 LOC (server, viewer, web app, MCP, tests)
- [x] Audit documented and plan written
- [x] Existing uncommitted fixes committed (error logging, look() options, getPlanState off-by-one)

## What's Next
- [ ] Regenerate river-bundle.js + fix index.html script tags
- [ ] Fix MCP tool bugs (look handler, energy field, tag sync, lane 1 enforcement)
- [ ] Harden web state layer (error checking, JSON.parse, cleanupPlan, race conditions)
- [ ] Clean up dead code across codebase
- [ ] Build verification and final review

## Git Log (recent)
- a777771: fix: MCP transport — switch from broken SSE to Streamable HTTP
- fee8030: feat: mobile handle swap + vertical drag time labels
- 27d32cd: fix: boundary clamp uses blob edges not center — no overflow

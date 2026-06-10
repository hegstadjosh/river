# River — Build Progress

## Status: MIGRATED TO NEON (June 9, 2026)

## Deployment URL
**https://river-silk.vercel.app** (also https://www.taskriver.dev)

## Architecture Overview (post-Neon migration)
- **Web app**: Next.js 16 App Router in `web/`, deployed on Vercel (team joshs-projects, project `river`)
- **Database**: Neon Postgres (`river-db` resource, Vercel Marketplace native integration, **Free plan**). All data access is server-side SQL via `pg` Pool (`web/src/lib/db.ts`, pooled `DATABASE_URL`, `attachDatabasePool` for fluid compute)
- **Auth**: Neon Auth (Better-Auth-based, beta) — email/password. Server: `web/src/lib/auth/server.ts` (`createNeonAuth`), catch-all handler at `/api/auth/[...path]`, `auth.middleware` protects `/app` and `/mcp`. Users live in `neon_auth."user"` (uuid ids) in the same Neon database. Trusted origins are stored in `neon_auth.project_config` (the three app domains)
- **Schema** (`web/migrations/001_init.sql`): `tasks` (lane smallint — NULL = main, 1-4 = plan lanes), `known_tags`, `plan_state` (row exists = plan active), `api_keys`. No timelines table, no meta key-value table — those were Supabase-era indirection
- **Viewer**: vanilla canvas JS in `web/public/viewer/`. ALL data flows through `/api/state` (cookie auth). `river-bundle.js` is a plain concatenation of the 13 `river-*.js` files in order: core, layout, render, grid, blobs, plan, store, panel, drag-wizard, input, clouds, mobile, main — regenerate with `cat` after editing any source file
- **Sync**: mutations POST `/api/state` and apply the returned full state; a 10s poll picks up out-of-band changes (MCP agents, other devices). No realtime subscription
- **MCP**: Streamable HTTP at `/api/mcp/mcp`, bearer `river_*` API keys (sha-256 hashes in `api_keys`). 13 tools. Keys survived the migration verbatim
- **Local MCP server**: separate SQLite-backed codebase in `src/` — NOT migrated, unrelated to the web app

## Supabase → Neon Migration (2026-06-09)
Full first-principles rework, not a port (7-agent analysis + adversarial review):
- Killed all browser-direct DB access (PostgREST + anon key + RLS) and the Supabase Realtime subscription — the viewer's `/api/state` fallback became the only path. The same `look()` logic previously existed in 3 drifting copies (server, page preload, viewer store)
- Plan lanes: fake `_plan_lane_N` timeline rows → a `lane` column. Plan lifecycle (start/commit/end) is now transactional — the old `commitLane` could destroy the user's main window if it crashed between its delete and move calls
- `known_tags`: JSON string in a `meta` text row (with real read-modify-write races) → a real table with `ON CONFLICT DO NOTHING`. Tag delete/rename: N+1 JS loops → single UPDATE with array ops
- `anchor`/`created`: ISO strings in text columns → timestamptz (wire format unchanged — `rowToTask` serializes Dates back to ISO)
- Recirculation: fire-and-forget client+server race → one awaited conditional UPDATE on the DB clock inside `look()`
- Auth: Supabase Auth → Neon Auth. **Password hashes could not be migrated** (different algorithms) — all 4 users were recreated with temp passwords; data remapped to new user ids. API keys carried over (hash lookup unchanged)
- Data migrated: 7 real tasks (4 jhegstad12, 3 jlh2288), 3 known tags, 9 API keys (7 active), 4 users. 41 orphaned tasks on deleted plan-lane timelines (junk from the old non-atomic cleanup) were intentionally dropped
- Migration script: `web/scripts/migrate-from-supabase.mjs` (idempotent; reads the Supabase export JSON)
- The old Supabase project was left untouched as a rollback fallback

## Wire Contract (unchanged — the viewer depends on it)
- `GET /api/state` → LookResult; `POST /api/state {action, ...}` → full LookResult after the mutation
- Lane numbers are 0-indexed on the wire, 1-indexed in the server (`route.ts` does the +1)
- `PlanLaneInfo.label` is now always null (nothing ever wrote labels in the web app); `branchName` is synthesized as `_plan_lane_N`

## Verification done (2026-06-09, local + production)
- Login (Neon Auth email/password), viewer renders migrated tasks/tags
- put/delete via `R.post`, plan start → lane put → commit lifecycle
- MCP initialize + look with a real migrated API key; 401 on bad keys
- Multi-agent adversarial review of the full diff before deploy

## Known limitations / loose ends
- Neon Auth is beta (SDK 0.4.2-beta); GA expected Q2 2026
- Neon free plan: compute scales to zero after 5 idle minutes → first request after idle adds ~0.5s
- A legacy `viewer` Vercel project (prj_lUZsRtid1rOo5MNIXrn0HXmbnqGv) still serves the old standalone viewer with hardcoded Supabase creds — should be deleted
- Supabase env vars still exist on the Vercel project (rollback safety); remove once the migration has soaked
- `river-bundle.js` still has no build step — keep the `cat` concatenation order above

## Older history (pre-migration)
See git history for the April 2026 overhaul (P0-P3 fixes, mobile touch rewrite, viewer deep dive). The Supabase-era architecture notes that used to live here describe a design that no longer exists.

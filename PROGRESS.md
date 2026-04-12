# River — Build Progress

## Status: IN PROGRESS (v0.5.0 — Web Deployment)

## Deployment URL
**https://river-silk.vercel.app**

## What's Built

### Web Application (web/)
- **Next.js 16** app on Vercel with Tailwind CSS
- **Supabase project**: "River" (jgbcahwfompeeihxjszb) in us-east-1
- **Postgres schema**: tasks, timelines, timeline_tasks, meta — all with RLS
- **Auth**: Email/password via Supabase Auth (`@supabase/ssr`)
- **State layer**: Full port of SQLite backend to Supabase (WebState class)
- **API route**: `/api/state` handles all 16 viewer actions (put, move, delete, plan_*, tag_create)
- **Viewer**: Copied to `public/viewer/` with polling (replaces SSE) and auth token passing

### Remote MCP Server
- **Route**: `/api/mcp/[transport]` via `mcp-handler` library
- **API key auth**: `river_` prefix + 56-char hex, stored in `api_keys` table
- **6 tools**: look, put, move, sweep, plan, branch — all operate on per-user data
- **Context resource**: `river://context` gives agents full situational awareness
- **Setup page**: `/mcp` with key generation and copy-paste configs for Claude Code/Desktop

### Landing Page
- Dark warm palette matching viewer (`#17161a`, amber `rgb(200, 165, 110)`)
- Instrument Serif + IBM Plex Sans typography
- Sections: hero, problem, three dimensions, cloud/river, Claude integration, CTA
- Real viewer screenshot embedded

### Pages
| Route | Status | Description |
|-------|--------|-------------|
| `/` | Live | Landing page |
| `/login` | Live | Email/password auth |
| `/app` | Live | Canvas viewer (iframe, auth-gated) |
| `/mcp` | Live | MCP setup with API key management |
| `/auth/callback` | Live | OAuth/email confirmation callback |
| `/api/state` | Live | Task CRUD endpoint |
| `/api/mcp/[transport]` | Live | Remote MCP server |
| `/api/keys` | Live | API key CRUD |

## What's Next
- [ ] Confirm email for test account and verify full auth flow
- [ ] Add `SUPABASE_SERVICE_ROLE_KEY` to Vercel env for MCP auth
- [ ] Test canvas viewer end-to-end (create tasks, drag, plan mode)
- [ ] Test MCP connection from Claude Code
- [ ] Set up email confirmation (or disable for dev)

## Architectural Decisions
- **Static viewer in iframe** over React wrapper — avoids SSR issues with `window` globals
- **Polling (1s)** over SSE — Vercel serverless can't hold long connections
- **Email/password** over Google OAuth — simpler setup per user preference
- **mcp-handler** for MCP transport — same pattern as AlignEd project
- **Service role client** for MCP auth — API key lookup bypasses RLS

## Known Issues
- Email confirmation required for new accounts (Supabase default) — need to either disable or users confirm via email
- `SUPABASE_SERVICE_ROLE_KEY` not yet on Vercel — MCP auth won't work until added
- Middleware deprecation warning from Next.js 16 (wants "proxy" convention instead)

## Local MCP Server (unchanged)
v0.4.0 COMPLETE — see previous PROGRESS.md entries. The local SQLite-based MCP server at `/Users/josh/river` is independent of the web deployment.

## Git Log (recent)
- fcd539a: feat: add landing page, MCP setup page, and viewer screenshot
- a88a0fd: feat: add remote MCP server with API key auth
- 7edd4d3: feat: scaffold Next.js web app with Supabase auth and state layer
- 8ba3c8c: docs: add web deployment spec and viewer screenshots

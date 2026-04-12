# River — Build Progress

## Status: IN PROGRESS (v0.5.0 — Web Deployment)

## Deployment URL
**https://river-silk.vercel.app**

## What's Built

### Web Application (web/)
- **Next.js 16** on Vercel, auto-deploys from `feature/web-deployment` branch
- **Supabase project**: "River" (jgbcahwfompeeihxjszb) in us-east-1
- **Postgres schema**: tasks, timelines, timeline_tasks, meta, api_keys — all with RLS
- **Auth**: Email/password via Supabase Auth (`@supabase/ssr`), no email confirmation
- **State layer**: Full port of SQLite backend to Supabase (WebState class)
- **API route**: `/api/state` — POST returns full state for instant viewer updates
- **Viewer**: iframe embed with auth token via postMessage, 5s background poll

### Remote MCP Server
- **Route**: `/api/mcp/[transport]` via `mcp-handler`
- **API key auth**: `river_` prefix + 56-char hex, stored in `api_keys` table
- **6 tools**: look, put, move, sweep, plan, branch — per-user data
- **Context resource**: `river://context`
- **Setup page**: `/mcp` with key generation and copy-paste configs

### Viewer UI
- Hamburger menu (☰) in top-left with slide-out sidebar
- MCP Setup link with "set up" badge (disappears after key generation)
- Sign out option (communicates with parent via postMessage)
- Tag bar offset to accommodate the menu button

### Landing Page
- Dark warm palette, Instrument Serif + IBM Plex Sans
- Hero, problem, three dimensions, cloud/river, Claude integration, CTA
- Centered layout with proper Tailwind spacing

## What's Next
- [ ] Test task creation, dragging, plan mode end-to-end in production
- [ ] Test MCP connection from Claude Code
- [ ] Polish landing page (mobile responsiveness, animations)
- [ ] Consider Supabase Realtime upgrade for multi-device sync

## Known Issues
- Git auto-deploy goes to preview (not production) — production deploys via `vercel --prod`
- Vercel production branch setting not sticking via API — may need dashboard config

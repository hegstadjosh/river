# River Web Deployment — Implementation Spec

## Overview

Deploy River as a multi-user web app on Vercel with Supabase (Postgres, Auth, Realtime) and a marketing landing page. The local MCP server is unchanged — this spec covers the web-only deployment.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Vercel                                         │
│                                                 │
│  app/                                           │
│    page.tsx          → Landing page (SSR)        │
│    login/page.tsx    → Login/signup (client)     │
│    app/page.tsx      → Canvas shell (auth gate)  │
│    auth/callback/    → OAuth code exchange       │
│    api/state/        → Task CRUD (route handler) │
│                                                 │
│  public/viewer/      → Static vanilla JS viewer  │
│    index.html, *.js, style.css                  │
│                                                 │
│  lib/supabase/       → Client factories          │
│    client.ts, server.ts, middleware.ts           │
│  lib/river/          → Ported state layer        │
│    state.ts          → WebState (async, Supabase) │
│    plan.ts, look.ts  → Business logic modules    │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────┐
│  Supabase                                       │
│                                                 │
│  Postgres   → tasks, timelines, meta (with RLS) │
│  Auth       → Google OAuth, user sessions       │
│  Realtime   → Broadcast channels (future)       │
└─────────────────────────────────────────────────┘
```

### Key Decisions

1. **Canvas integration: static files in `public/viewer/`**. The vanilla JS viewer uses `window` globals, `requestAnimationFrame`, and DOM manipulation — all hostile to React SSR. Wrapping in React provides zero benefit and requires fighting hydration at every turn. The viewer files go into `public/viewer/` and are served from Vercel's Edge CDN.

2. **API routes as the state layer**. The viewer calls Next.js API routes (`/api/state`) for all mutations, exactly like it calls the current HTTP server. Business logic (plan mode, branching, sweep) lives in TypeScript route handlers using the Supabase server client.

3. **Polling for realtime (walking skeleton)**. Replace SSE with a 1-second poll of `/api/state`. Upgrade to Supabase Realtime Broadcast later if needed. Polling is simpler, works on Vercel serverless with no timeout issues, and is fast enough for a personal task app.

4. **`@supabase/ssr` for auth**. The `auth-helpers-nextjs` package is deprecated. Use `@supabase/ssr` with `createBrowserClient` and `createServerClient`.

---

## Route Structure

| Path | Type | Auth | Purpose |
|------|------|------|---------|
| `/` | Server Component | No | Landing page |
| `/login` | Client Component | No | Google OAuth trigger |
| `/app` | Client Component | Yes | Canvas viewer shell |
| `/auth/callback` | Route Handler | No | PKCE code exchange |
| `/api/state` | Route Handler | Yes | GET state, POST mutations |

### `/app` — Canvas Viewer Shell

The `/app` page is a React component that:
1. Checks auth — redirects to `/login` if not authenticated
2. Renders a minimal chrome (just a logout button, positioned unobtrusively)
3. Embeds the canvas viewer via an iframe pointing to `/viewer/index.html`
4. Passes the Supabase auth token to the viewer via `postMessage`

The iframe approach is cleanest because:
- The viewer is a full-viewport canvas app — there's no React UI to wrap around it
- Auth token passing via postMessage is secure and simple
- No SSR conflicts whatsoever
- The viewer can be developed and tested independently

### `/api/state` — State CRUD

Replicates the current HTTP server's behavior:

**GET** — Returns the same JSON shape as the current `/state` endpoint:
```json
{
  "river": [TaskWithPosition],
  "cloud": [TaskWithPosition],
  "breathing_room": { "next_4h": number, "rest_of_day": number },
  "now": "ISO string",
  "timeline": "main",
  "known_tags": ["tag1", "tag2"],
  "plan": { ... }
}
```

**POST** — Accepts the same `{ action, ...data }` body. Supported actions:
`put`, `move`, `delete`, `tag_create`, `plan_start`, `plan_end`, `plan_commit`,
`plan_lane_put`, `plan_update_task`, `plan_to_cloud`, `plan_add`, `plan_remove`,
`plan_reposition`, `plan_move`, `plan_copy`

Each action reads/writes Supabase Postgres with the authenticated user's ID.

---

## Data Model (Postgres)

### Schema

```sql
-- Tasks — the core entity
create table public.tasks (
  id          text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  timeline_id text not null,
  name        text not null,
  mass        real not null default 30,
  anchor      text,                    -- ISO timestamp or null (cloud)
  solidity    real not null default 0.1,
  energy      real not null default 0.5,
  fixed       boolean not null default false,
  alive       boolean not null default false,
  tags        jsonb not null default '[]'::jsonb,
  created     timestamptz not null default now(),
  cloud_x     real,
  cloud_y     real,
  river_y     real
);
create index idx_tasks_user on tasks(user_id);
create index idx_tasks_timeline on tasks(user_id, timeline_id);

-- Timelines (branching)
create table public.timelines (
  id           text primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  parent_id    text references timelines(id),
  created      timestamptz not null default now(),
  committed_at timestamptz,
  unique(user_id, name)
);
create index idx_timelines_user on timelines(user_id);

-- Timeline task snapshots (branch diffs)
create table public.timeline_tasks (
  timeline_id text not null references timelines(id) on delete cascade,
  task_id     text not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  mass        real not null,
  anchor      text,
  solidity    real not null,
  fixed       boolean not null,
  alive       boolean not null,
  tags        jsonb not null,
  created     timestamptz not null,
  primary key (timeline_id, task_id)
);
create index idx_tltasks_user on timeline_tasks(user_id);

-- Key-value store (plan state, known tags, current timeline)
create table public.meta (
  user_id uuid not null references auth.users(id) on delete cascade,
  key     text not null,
  value   text not null,
  primary key (user_id, key)
);
```

### Row Level Security

```sql
alter table tasks enable row level security;
alter table timelines enable row level security;
alter table timeline_tasks enable row level security;
alter table meta enable row level security;

-- Same pattern for all tables: user sees only their data
create policy "user_owns_tasks" on tasks
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "user_owns_timelines" on timelines
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "user_owns_timeline_tasks" on timeline_tasks
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "user_owns_meta" on meta
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
```

Note: `(select auth.uid())` wraps the function in a subquery to prevent re-evaluation per row — a significant performance optimization.

### Initial Data Setup

When a new user signs in for the first time, the API creates:
- A "main" timeline in the `timelines` table
- A `current_timeline_id` entry in `meta` pointing to it

This happens in the `/auth/callback` route handler or on first GET to `/api/state`.

---

## Viewer Integration

### Changes to Viewer Files

The viewer files are copied to `public/viewer/` with these modifications:

**`river-core.js`** — Change `R.post` to use the API route:
```js
R.post = function (action, data) {
  fetch('/api/state', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + R.authToken
    },
    body: JSON.stringify(Object.assign({ action: action }, data))
  }).catch(function () {});
};
```

**`river-store.js`** — Replace SSE with polling:
```js
R.connectSSE = function () {
  // Poll every 1 second instead of SSE
  setInterval(function () {
    fetch('/api/state', {
      headers: { 'Authorization': 'Bearer ' + R.authToken }
    })
    .then(function (r) { return r.json(); })
    .then(function (d) { R.state = d; R.sync(); })
    .catch(function () {});
  }, 1000);
};

// Initial fetch also uses the API route
fetch('/api/state', {
  headers: { 'Authorization': 'Bearer ' + R.authToken }
})
.then(function (r) { return r.json(); })
.then(function (d) { R.state = d; R.sync(); })
.catch(function () {});
```

**`index.html`** — Add auth token listener:
```html
<script>
  // Receive auth token from parent React page
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'auth-token') {
      window.River.authToken = e.data.token;
    }
  });
</script>
```

### Auth Token Flow

1. `/app` page authenticates via Supabase, gets the session token
2. Renders iframe: `<iframe src="/viewer/index.html" />`
3. On iframe load, sends token via `postMessage`:
   ```ts
   iframeRef.current.contentWindow.postMessage(
     { type: 'auth-token', token: session.access_token },
     window.location.origin
   )
   ```
4. Viewer stores token in `R.authToken`, uses it for all API calls
5. API route validates token via Supabase server client

---

## State Layer (lib/river/)

Port the business logic from `src/state.ts` and `src/db/` to work with Supabase instead of SQLite. The core difference: all queries are async (Supabase client returns Promises).

### Module Structure

```
lib/river/
  state.ts        — WebState class (async methods, Supabase client)
  tasks.ts        — CRUD: insert, update, delete, list
  move.ts         — Reposition tasks
  look.ts         — Query: river window, cloud contents
  plan.ts         — Plan mode: lanes, commit, task arrangement
  recirculate.ts  — Move drifted tasks back to cloud
  sweep.ts        — Bulk operations
  branches.ts     — Timeline branching
  schema.ts       — Shared types (reuse from src/schema.ts)
```

Each module receives a `SupabaseClient` and `userId` and implements the same logic as the SQLite version, using Supabase's query builder instead of raw SQL.

Example — `tasks.ts`:
```ts
export async function putTask(
  supabase: SupabaseClient,
  userId: string,
  timelineId: string,
  input: PutSingleInput
): Promise<Task> {
  const id = input.id ?? randomUUID();
  const anchor = input.position != null
    ? new Date(Date.now() + input.position * 3_600_000).toISOString()
    : null;

  const { data, error } = await supabase
    .from('tasks')
    .upsert({
      id,
      user_id: userId,
      timeline_id: timelineId,
      name: input.name ?? 'untitled',
      mass: input.mass ?? DEFAULT_MASS,
      anchor,
      solidity: input.solidity ?? DEFAULT_SOLIDITY,
      energy: input.energy ?? 0.5,
      fixed: input.fixed ?? false,
      alive: input.alive ?? false,
      tags: input.tags ?? [],
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}
```

---

## Landing Page

### Design Principles

- **No generic SaaS template.** The page should feel like River itself — warm, dark, organic.
- **Emotional design constraints apply:** no red, no "overdue", no productivity language.
- **Warm palette:** backgrounds in River's `#17161a` to `#231e19` range, accents in amber `rgb(200, 165, 110)`.
- **Typography:** clean, modern, slightly warm. Inter or similar.
- **Reference points:** Linear (dark, confident), Arc (playful but sophisticated), Raycast (power users).

### Section Breakdown

1. **Hero** — "Time is a river, not a grid."
   - Full-width screenshot of River with tasks flowing
   - Brief tagline explaining the concept
   - "Get started" CTA → `/login`

2. **The Problem** — "Calendars lie to you."
   - Why grid-based scheduling doesn't match human time experience
   - Todo lists have no time dimension; Gantt charts are too rigid
   - River lives in the space between

3. **How It Works** — Three dimensions of a task
   - Duration → size (small wisp vs. large block)
   - Commitment → shape/opacity (ghost at 0.1, solid at 0.9)
   - Energy → color temperature (cool blue → warm amber)
   - Annotated screenshot showing these dimensions

4. **The Cloud and The River**
   - Unscheduled thoughts float above as wisps
   - Scheduled tasks drift in the current below
   - Nothing is overdue — tasks that drift past "now" recirculate silently

5. **Plan Mode** — "Try on a different day"
   - Screenshot of plan mode with swim lanes
   - Lock a time window, explore alternatives, commit the one you want

6. **Claude Integration** — "Your AI sees your day"
   - River is an MCP server — Claude can read, propose, and rearrange
   - Show a terminal snippet of Claude using River tools
   - "The first task scheduler that speaks AI natively"

7. **CTA** — "Start flowing"
   - Sign in with Google
   - Free, open source (link to GitHub)

### Copy Tone

Calm, honest, slightly literary. Not cute, not corporate. Examples:
- "Tasks are shapes, not checkboxes."
- "Commitment is a gradient, not a promise you'll break."
- "Nothing judges you. Things simply drift."

---

## Auth Implementation

### Files

```
lib/supabase/
  client.ts      — createBrowserClient (for client components)
  server.ts      — createServerClient (for API routes, server components)
  middleware.ts   — Session refresh on every request
middleware.ts     — Root middleware, delegates to lib/supabase/middleware.ts
```

### Flow

1. User clicks "Sign in with Google" on `/login`
2. `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: '/auth/callback' } })`
3. Google OAuth flow → redirects to Supabase → redirects to `/auth/callback`
4. `/auth/callback` route exchanges code for session, redirects to `/app`
5. `/app` checks session, shows canvas viewer

### Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

### Middleware

The root `middleware.ts` refreshes the Supabase session on every request and protects `/app` routes:

```ts
export async function middleware(request: NextRequest) {
  const response = await updateSession(request)
  // Protect /app — redirect to /login if no session
  if (request.nextUrl.pathname.startsWith('/app')) {
    const supabase = /* create from request cookies */
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
  }
  return response
}
```

---

## Deployment Checklist

### Supabase Setup
- [ ] Create "River" project in existing org
- [ ] Run schema migration (create tables, indexes, RLS)
- [ ] Enable Google OAuth provider (need Google Cloud OAuth credentials)
- [ ] Add redirect URLs for Vercel (production + preview)

### Google Cloud
- [ ] Create OAuth 2.0 client (Web application type)
- [ ] Set authorized redirect URI to `https://<ref>.supabase.co/auth/v1/callback`
- [ ] Copy client ID + secret to Supabase

### Next.js Project
- [ ] Initialize Next.js app in `web/` directory (separate from MCP server)
- [ ] Install dependencies: `@supabase/ssr`, `@supabase/supabase-js`
- [ ] Copy viewer files to `public/viewer/` with modifications
- [ ] Implement API routes (port state layer to Supabase)
- [ ] Build auth flow (login, callback, middleware)
- [ ] Build landing page

### Vercel
- [ ] Create Vercel project linked to GitHub
- [ ] Set environment variables (Supabase URL, keys)
- [ ] Deploy and verify
- [ ] Test Google OAuth in production

---

## Build Parallelization

The work naturally splits into four streams:

| Stream | Files Owned | Dependencies |
|--------|-------------|--------------|
| **DB/API** | `lib/river/*`, `app/api/*` | Supabase project must exist |
| **Canvas** | `public/viewer/*` | API routes must be callable |
| **Landing** | `app/page.tsx`, components | None (pure UI) |
| **Auth/Deploy** | `lib/supabase/*`, `middleware.ts`, `app/login/*`, `app/auth/*`, `app/app/*` | Supabase project must exist |

**Sequence:**
1. Create Supabase project + Next.js scaffolding (sequential, ~5 min)
2. DB/API + Auth + Landing in parallel (the bulk of the work)
3. Canvas integration (once API routes exist)
4. Integration testing + polish

---

## File Tree (Final)

```
web/                          ← New Next.js app (separate from MCP server root)
  app/
    layout.tsx                ← Root layout, Inter font, dark theme
    page.tsx                  ← Landing page
    login/page.tsx            ← Login page
    app/page.tsx              ← Canvas viewer shell
    auth/callback/route.ts    ← OAuth callback
    api/state/route.ts        ← State CRUD endpoint
    globals.css               ← Tailwind + custom properties
  lib/
    supabase/
      client.ts               ← Browser Supabase client
      server.ts               ← Server Supabase client
      middleware.ts            ← Session refresh
    river/
      state.ts                ← WebState class
      tasks.ts, move.ts, look.ts, plan.ts, etc.
      schema.ts               ← Shared types (from src/schema.ts)
  public/
    viewer/
      index.html              ← Modified viewer HTML
      style.css               ← Unchanged
      river-*.js              ← Modified core/store, rest unchanged
  middleware.ts               ← Root middleware
  next.config.ts
  tailwind.config.ts
  tsconfig.json
  package.json
```

// One-time Supabase → Neon migration (June 2026).
// Reads the Supabase export JSON, creates each user in Neon Auth with a fresh
// temp password (Supabase bcrypt hashes cannot be imported into Neon Auth),
// then imports each user's CURRENT-timeline tasks, known tags, and API keys
// with user_id remapped to the new Neon Auth id.
//
// Orphaned tasks pointing at deleted plan-lane timelines are intentionally
// dropped — they were junk left behind by the old non-atomic plan cleanup.
//
// Usage: node --env-file=.env.local scripts/migrate-from-supabase.mjs <export.json>
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { neon } from '@neondatabase/serverless'

const exportPath = process.argv[2]
if (!exportPath) { console.error('usage: ... <export.json>'); process.exit(1) }
const data = JSON.parse(readFileSync(exportPath, 'utf8'))

const AUTH_BASE = process.env.NEON_AUTH_BASE_URL
const sql = neon(process.env.DATABASE_URL_UNPOOLED)

async function createUser(email, name, password) {
  // Idempotent: if the user already exists (re-run), reuse their id
  const existing = await sql.query('SELECT id FROM neon_auth."user" WHERE email = $1', [email])
  if (existing[0]) return { id: existing[0].id, existed: true }

  const res = await fetch(`${AUTH_BASE}/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://river-silk.vercel.app' },
    body: JSON.stringify({ email, password, name }),
  })
  const body = await res.json()
  if (!res.ok || !body.user?.id) throw new Error(`sign-up failed for ${email}: ${JSON.stringify(body)}`)
  return { id: body.user.id, existed: false }
}

const idMap = {}      // old supabase user id → new neon auth user id
const passwords = {}  // email → temp password

for (const u of data.users) {
  const password = `river-tmp-${randomBytes(6).toString('hex')}`
  const name = u.email.split('@')[0]
  const { id: newId, existed } = await createUser(u.email, name, password)
  idMap[u.id] = newId
  if (!existed) passwords[u.email] = password
  console.log(`${existed ? 'exists' : 'created'} ${u.email} → ${newId}`)
}

// Tasks: only rows on each user's CURRENT timeline (meta.current_timeline_id)
const currentTimeline = {}
for (const m of data.meta) {
  if (m.key === 'current_timeline_id') currentTimeline[m.user_id] = m.value
}

let taskCount = 0
for (const t of data.tasks) {
  if (t.timeline_id !== currentTimeline[t.user_id]) continue
  const newUserId = idMap[t.user_id]
  if (!newUserId) continue
  await sql.query(
    `INSERT INTO tasks (id, user_id, lane, name, mass, anchor, solidity, energy, fixed, alive, tags, created, cloud_x, cloud_y, river_y)
     VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (id) DO NOTHING`,
    [t.id, newUserId, t.name, t.mass, t.anchor, t.solidity, t.energy, t.fixed, t.alive,
     t.tags ?? [], t.created, t.cloud_x, t.cloud_y, t.river_y],
  )
  taskCount++
}

// Known tags: meta.known_tags JSON arrays → known_tags rows
let tagCount = 0
for (const m of data.meta) {
  if (m.key !== 'known_tags') continue
  const newUserId = idMap[m.user_id]
  if (!newUserId) continue
  let tags = []
  try { tags = JSON.parse(m.value) } catch { /* corrupt — skip */ }
  for (const tag of tags) {
    await sql.query(
      'INSERT INTO known_tags (user_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [newUserId, tag],
    )
    tagCount++
  }
}

// API keys: hashes carry over verbatim, so existing river_ keys keep working.
// Oldest rows stored the raw key in `key` with no hash — hash it; if a row has
// neither, it can never authenticate, so it is dropped.
import('node:crypto').then(() => {})
const { createHash } = await import('node:crypto')
let keyCount = 0
for (const k of data.api_keys) {
  const newUserId = idMap[k.user_id]
  if (!newUserId) continue
  const keyHash = k.key_hash ?? (k.key ? createHash('sha256').update(k.key).digest('hex') : null)
  if (!keyHash) { console.log(`skipping api_key ${k.id} (no hash, no raw key)`); continue }
  await sql.query(
    `INSERT INTO api_keys (id, user_id, name, key_hash, key_hint, created_at, last_used_at, revoked_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO NOTHING`,
    [k.id, newUserId, k.name ?? 'Default', keyHash, k.key_hint, k.created_at, k.last_used_at, k.revoked_at],
  )
  keyCount++
}

console.log(`\nimported: ${taskCount} tasks, ${tagCount} known tags, ${keyCount} api keys`)

// Verify
const [tasks, tags, keys, users] = await Promise.all([
  sql`SELECT user_id, count(*)::int AS n FROM tasks GROUP BY user_id`,
  sql`SELECT count(*)::int AS n FROM known_tags`,
  sql`SELECT count(*)::int AS n FROM api_keys WHERE revoked_at IS NULL`,
  sql`SELECT id, email FROM neon_auth."user" ORDER BY email`,
])
console.log('\nverification:')
console.log('users:', users.map(u => u.email).join(', '))
console.log('tasks per user:', JSON.stringify(tasks))
console.log('known_tags:', tags[0].n, '| active api_keys:', keys[0].n)

console.log('\nTEMP PASSWORDS (share securely, change after first login):')
for (const [email, pw] of Object.entries(passwords)) console.log(`  ${email}  ${pw}`)

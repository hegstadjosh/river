import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth/server'
import { pool } from '@/lib/db'
import { generateApiKey, hashApiKey } from '@/lib/mcp/auth'

export const dynamic = 'force-dynamic'

async function getUserId(): Promise<string | null> {
  const { data: session } = await auth.getSession()
  return session?.user?.id ?? null
}

// GET — list user's API keys (masked)
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows } = await pool.query(
    `SELECT id, name, key_hint, created_at, last_used_at, revoked_at
     FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  )
  return NextResponse.json(rows)
}

// POST — create a new API key. Returns the raw key (only shown once).
export async function POST() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const key = generateApiKey()
  const { rows } = await pool.query(
    `INSERT INTO api_keys (user_id, key_hash, key_hint, name)
     VALUES ($1, $2, $3, 'Default')
     RETURNING id, name, created_at`,
    [userId, hashApiKey(key), key.slice(-4)],
  )

  // Return with the river_ prefix — this is the only time the full key is shown
  return NextResponse.json({
    ...rows[0],
    key: `river_${key}`,
  })
}

// DELETE — revoke an API key
export async function DELETE(request: Request) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let keyId: unknown
  try {
    ({ keyId } = await request.json())
  } catch {
    return NextResponse.json({ error: 'invalid request body' }, { status: 400 })
  }
  if (typeof keyId !== 'string' || !/^[0-9a-f-]{36}$/i.test(keyId)) {
    return NextResponse.json({ error: 'invalid key id' }, { status: 400 })
  }
  await pool.query(
    'UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND user_id = $2',
    [keyId, userId],
  )
  return NextResponse.json({ ok: true })
}

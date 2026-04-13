import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { generateApiKey, hashApiKey } from '@/lib/mcp/auth'

export const dynamic = 'force-dynamic'

// GET — list user's API keys (masked)
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: keys } = await supabase
    .from('api_keys')
    .select('id, name, key_hint, created_at, last_used_at, revoked_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  return NextResponse.json(keys ?? [])
}

// POST — create a new API key. Returns the raw key (only shown once).
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const key = generateApiKey()
  const { data, error } = await supabase.from('api_keys').insert({
    user_id: user.id,
    key_hash: hashApiKey(key),
    key_hint: key.slice(-4),
    name: 'Default',
  }).select('id, name, created_at').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Return with the river_ prefix — this is the only time the full key is shown
  return NextResponse.json({
    ...data,
    key: `river_${key}`,
  })
}

// DELETE — revoke an API key
export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { keyId } = await request.json()
  await supabase
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('user_id', user.id)

  return NextResponse.json({ ok: true })
}

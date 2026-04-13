import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'

export interface McpUser {
  id: string
  email: string
}

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

// Resolve a bearer token to a user.
// Strips `river_` prefix, hashes key, looks up hash in api_keys table.
export async function resolveUser(bearerToken: string): Promise<McpUser | null> {
  const rawKey = bearerToken.startsWith('river_')
    ? bearerToken.slice(6)
    : bearerToken

  const keyHash = hashApiKey(rawKey)
  const supabase = getServiceClient()

  const { data: apiKey } = await supabase
    .from('api_keys')
    .select('id, user_id')
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .single()

  if (!apiKey) return null

  const { data: { user } } = await supabase.auth.admin.getUserById(apiKey.user_id)
  if (!user) return null

  void supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', apiKey.id)

  return {
    id: apiKey.user_id,
    email: user.email ?? '',
  }
}

export function generateApiKey(): string {
  const bytes = new Uint8Array(28)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

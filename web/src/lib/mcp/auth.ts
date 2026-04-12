import { createClient } from '@supabase/supabase-js'

export interface McpUser {
  id: string
  email: string
}

// Use service-level client for API key lookup (bypasses RLS)
function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// Resolve a bearer token to a user.
// Strips `river_` prefix, looks up key in api_keys table.
export async function resolveUser(bearerToken: string): Promise<McpUser | null> {
  const rawKey = bearerToken.startsWith('river_')
    ? bearerToken.slice(6)
    : bearerToken

  const supabase = getServiceClient()

  const { data: apiKey } = await supabase
    .from('api_keys')
    .select('id, user_id')
    .eq('key', rawKey)
    .is('revoked_at', null)
    .single()

  if (!apiKey) return null

  // Get user email
  const { data: { user } } = await supabase.auth.admin.getUserById(apiKey.user_id)
  if (!user) return null

  // Update last_used_at (fire-and-forget)
  void supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', apiKey.id)

  return {
    id: apiKey.user_id,
    email: user.email ?? '',
  }
}

// Generate a random API key (56-char hex = 28 bytes)
export function generateApiKey(): string {
  const bytes = new Uint8Array(28)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

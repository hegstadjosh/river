import { createHash } from 'node:crypto'
import { pool } from '@/lib/db'

export interface McpUser {
  id: string
  email: string
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
  const { rows } = await pool.query(
    `SELECT k.id, k.user_id, u.email
     FROM api_keys k
     JOIN neon_auth."user" u ON u.id = k.user_id::uuid
     WHERE k.key_hash = $1 AND k.revoked_at IS NULL`,
    [keyHash],
  )
  const apiKey = rows[0]
  if (!apiKey) return null

  void pool
    .query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [apiKey.id])
    .catch(() => {})

  return {
    id: apiKey.user_id,
    email: apiKey.email ?? '',
  }
}

export function generateApiKey(): string {
  const bytes = new Uint8Array(28)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

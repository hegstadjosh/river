import { auth } from '@/lib/auth/server'

// Protects /app and /mcp behind a session; refreshes the session cookie.
// API routes authenticate themselves (cookie session or bearer API key).
export default auth.middleware({ loginUrl: '/login' })

export const config = {
  matcher: ['/app/:path*', '/mcp/:path*'],
}

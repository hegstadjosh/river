// Single Postgres pool for all server-side queries (Neon via pooled DATABASE_URL).
// Module-scoped + attachDatabasePool so Vercel fluid compute releases idle
// connections before suspending the instance.
import { Pool } from 'pg'
import { attachDatabasePool } from '@vercel/functions'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
attachDatabasePool(pool)

export { pool }

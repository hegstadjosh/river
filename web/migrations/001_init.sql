-- River schema on Neon — replaces the Supabase tables (tasks/timelines/meta/api_keys).
-- Design notes:
--   * user_id is text: Neon Auth (Better Auth) user ids are opaque strings, not uuids.
--   * No timelines table — the web app only ever used 'main' + 4 fake '_plan_lane_N'
--     branches. Plan lanes are now a lane column (NULL = main, 1-4 = plan lanes).
--   * No meta key-value table — plan state and known tags get real tables.
--   * anchor/created are timestamptz (Supabase stored ISO strings in text).
--   * No FK to neon_auth."user" — auth tables are service-managed; join when needed.

CREATE TABLE IF NOT EXISTS tasks (
  id        text PRIMARY KEY,
  user_id   text NOT NULL,
  lane      smallint CHECK (lane BETWEEN 1 AND 4),
  name      text NOT NULL DEFAULT 'untitled',
  mass      real NOT NULL DEFAULT 30,
  anchor    timestamptz,
  solidity  real NOT NULL DEFAULT 0.1,
  energy    real NOT NULL DEFAULT 0.5,
  fixed     boolean NOT NULL DEFAULT false,
  alive     boolean NOT NULL DEFAULT false,
  tags      text[] NOT NULL DEFAULT '{}',
  created   timestamptz NOT NULL DEFAULT now(),
  cloud_x   real,
  cloud_y   real,
  river_y   real
);

CREATE INDEX IF NOT EXISTS tasks_user_lane_anchor ON tasks (user_id, lane, anchor);

CREATE TABLE IF NOT EXISTS known_tags (
  user_id text NOT NULL,
  name    text NOT NULL,
  PRIMARY KEY (user_id, name)
);

-- Row exists = plan mode active. Lane labels were never written by the web app
-- (always null in responses), so they are not stored.
CREATE TABLE IF NOT EXISTS plan_state (
  user_id      text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  window_end   timestamptz NOT NULL,
  created      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      text NOT NULL,
  name         text NOT NULL DEFAULT 'Default',
  key_hash     text NOT NULL,
  key_hint     text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

CREATE INDEX IF NOT EXISTS api_keys_key_hash ON api_keys (key_hash);
CREATE INDEX IF NOT EXISTS api_keys_user ON api_keys (user_id);

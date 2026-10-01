-- Migration 0011: bot_admins (Telegram chat_id whitelist for the goldpos-bot Worker)
--
-- OWNER OF THIS SCHEMA: this admin project. The `goldpos-bot` Worker binds the
-- SAME D1 database (`admin-db`) but has NO migrations directory and never runs
-- `wrangler d1 migrations apply`. Cloudflare records applied migrations in one
-- shared `d1_migrations` table keyed by file name, so if both Workers ran their
-- own runner they would race over it. Everything ships from here.
--
-- RULES (see migrations/README.md): from 0009 onward migrations are ADDITIVE
-- ONLY. This file therefore contains NO DROP of any kind - it is purely
-- additive and safe to apply on a live database.
--
-- WHY A SEPARATE TABLE AND NOT `admin_users`
--   `admin_users` carries a username/password_hash/must_change_password
--   credential model that a Telegram chat has no use for, and the bot must
--   NEVER insert into or authenticate against it. Authorization here is a
--   simple chat_id whitelist: Telegram has already authenticated the sender
--   (the chat_id arrives over a webhook validated by a secret token), so the
--   only question is "is this chat_id on the list, and is it active?".
--
-- WHY chat_id IS A 64-BIT INTEGER PRIMARY KEY
--   Telegram chat ids exceed 2^31 (supergroup/channel ids are large negative
--   numbers and group ids are large positive numbers). SQLite's INTEGER is
--   already 64-bit, so no widening is needed. Kept signed as-is so the value
--   round-trips through D1/JSON without a bigint codec; handlers bind it as a
--   number, and the tests cover a > 2^31 id.

CREATE TABLE IF NOT EXISTS bot_admins (
    chat_id INTEGER PRIMARY KEY,
    -- @handle WITHOUT the leading '@'. Nullable because a Telegram account may
    -- have no username at all; authorization never depends on it.
    telegram_username TEXT,
    full_name TEXT,
    -- 'read_only' may run /start /stats /find /pending but is refused on
    -- /revoke, /extend and license generation.
    role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('super_admin', 'admin', 'read_only')),
    -- is_active = 0 is a silent, non-enumerating kill switch: the webhook
    -- answers 200 with an empty body and sends nothing back.
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_command_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Trigger idiom copied from 0001 (users), 0002 (plans) and 0007 (admin_users) so
-- every table in this database stamps updated_at the same way: AFTER UPDATE,
-- re-UPDATE the same row to CURRENT_TIMESTAMP.
--
-- ONE DELIBERATE DEVIATION: 0001/0002/0007 all end with `WHERE id = NEW.id`
-- because those tables are keyed by an `id` column. bot_admins is keyed by
-- `chat_id`, so this uses `WHERE chat_id = NEW.chat_id` - the same idiom, with
-- the same WHERE clause bound to this table's actual primary key. Copying
-- `id = NEW.id` verbatim here would make the trigger fail at runtime on every
-- single update.
CREATE TRIGGER IF NOT EXISTS update_bot_admins_updated_at
    AFTER UPDATE ON bot_admins
    BEGIN
        UPDATE bot_admins SET updated_at = CURRENT_TIMESTAMP WHERE chat_id = NEW.chat_id;
    END;

-- ---------------------------------------------------------------------------
-- bot_sessions: scratch state for multi-step inline flows (/license, /pending).
--
-- The bot is stateless between HTTP requests (Workers have no session store and
-- this project must not add a KV binding), so the in-progress answer to "which
-- user? which plan? how many?" is parked in D1 between callback presses. Rows
-- are short-lived and self-cleaning via expires_at; nothing here is durable
-- business data.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bot_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- The chat that owns the flow. Scoping by chat means one admin can never
    -- resume or complete another admin's half-finished flow.
    chat_id INTEGER NOT NULL,
    flow TEXT NOT NULL CHECK(flow IN ('license_new', 'license_qty', 'license_confirm')),
    -- JSON payload of the current step; opaque to the schema by design.
    state TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL
);

-- The read path is "latest live session for this chat and flow".
CREATE INDEX IF NOT EXISTS idx_bot_sessions_lookup ON bot_sessions(chat_id, flow, expires_at);

CREATE INDEX IF NOT EXISTS idx_bot_admins_is_active ON bot_admins(is_active);
CREATE INDEX IF NOT EXISTS idx_bot_admins_telegram_username ON bot_admins(telegram_username);
CREATE INDEX IF NOT EXISTS idx_bot_admins_role ON bot_admins(role);

-- ---------------------------------------------------------------------------
-- SEEDS: intentionally COMMENTED OUT.
--
-- The real chat_ids are supplied by the operator as runtime config (wrangler
-- vars/secrets), never hardcoded in a migration: a chat_id is environment
-- data, it differs per deployment, and this migration file is PUBLIC. Once
-- applied, D1 ignores edits to it anyway (matching is by file name), so an
-- INSERT here could never be updated later.
--
-- Grant access at runtime instead. Either insert directly:
--
--   npx wrangler d1 execute admin-db --remote \
--     --command "INSERT INTO bot_admins (chat_id, telegram_username, full_name, role, is_active)
--                VALUES (123456789, 'your_handle', 'Your Name', 'super_admin', TRUE);"
--
-- or from inside the bot, once some other super_admin already exists.
--
-- Example rows (DO NOT UNCOMMENT - replace the chat_id first, and never
-- commit a real chat_id):
--
-- INSERT INTO bot_admins (chat_id, telegram_username, full_name, role, is_active)
-- VALUES (000000000, 'alice', 'Alice (super admin)', 'super_admin', TRUE);
--
-- INSERT INTO bot_admins (chat_id, telegram_username, full_name, role, is_active)
-- VALUES (000000000, 'bob', 'Bob (staff, read only)', 'read_only', TRUE);
--
-- INSERT INTO bot_admins (chat_id, telegram_username, full_name, role, is_active)
-- VALUES (000000000, 'carol', 'Carol (disabled)', 'admin', FALSE);
-- ---------------------------------------------------------------------------

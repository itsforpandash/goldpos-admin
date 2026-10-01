-- 0012: panel-managed settings (bot connection + operator preferences).
--
-- WHY THIS TABLE EXISTS
-- The operator wants to connect the Telegram bot from inside the panel — paste
-- a token, paste a chat id, done — instead of running `wrangler secret put`
-- from a terminal. That means the values have to live somewhere both Workers
-- can read, and D1 is the one thing they already share.
--
-- The bot Worker reads these rows at request time and falls back to its own
-- env secrets when a row is empty, so a Worker deployed before this migration
-- keeps working and a panel that has never saved anything changes nothing.
--
-- WHAT IS ACCEPTED HERE
-- Secrets sit in the same database as everything else this panel can already
-- read and write, so this trades a little blast-radius for the one-click setup.
-- The compensating rules, enforced by the panel UI and by the bot:
--   * no endpoint ever returns bot_token or bot_webhook_secret to a client;
--     the panel shows a masked prefix and nothing else
--   * values are only written by an authenticated admin action
--   * empty string means "not configured" — never a usable default

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by  INTEGER
);

CREATE TRIGGER IF NOT EXISTS settings_touch_updated_at
AFTER UPDATE ON settings
FOR EACH ROW
BEGIN
  UPDATE settings SET updated_at = datetime('now') WHERE key = NEW.key;
END;

-- Empty on purpose: the operator pastes the real values from the panel.
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('bot_token', ''),
  ('bot_webhook_secret', '');

/**
 * Panel settings: the `settings` key/value table (migration 0012) plus the
 * account edits that only the settings page performs (username).
 *
 * Write-only rule for secrets: bot_token, bot_webhook_secret and
 * bot_setup_token are read here only to (a) know whether they are set and
 * (b) derive a masked hint. Nothing in this module returns a stored secret to
 * a caller that could render it — use `getMasked()`/`maskSettingValue()` for
 * display and `get()`/`getMany()` only inside an action that writes or
 * compares, never in a view. BOT_WORKER_URL is the one non-secret here: it is
 * an address, shown in full so the operator can check where the panel points.
 */

export const SETTING_KEYS = {
  BOT_TOKEN: "bot_token",
  BOT_WEBHOOK_SECRET: "bot_webhook_secret",
  // How the panel FINDS and AUTHENTICATES against the bot Worker. The row keys
  // deliberately carry the same names as the env vars of the same name on the
  // panel Worker: env is read first, these rows are the fallback (bot-client's
  // resolveBotConnection), so an empty row never overrides a configured env.
  BOT_WORKER_URL: "BOT_WORKER_URL",
  BOT_SETUP_TOKEN: "BOT_SETUP_TOKEN",
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

/**
 * The two connection settings, in the order bot-client falls back to them.
 * Read ONCE per page operation and passed to the client so no render issues
 * one D1 query per fetch.
 */
export const BOT_CONNECTION_KEYS = [
  SETTING_KEYS.BOT_WORKER_URL,
  SETTING_KEYS.BOT_SETUP_TOKEN,
] as const;

/** Typed, Persian-worded failure. The action route maps `code` to a flash key. */
export class SettingsError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SettingsError";
    this.code = code;
  }
}

export const SETTINGS_QUERIES = {
  SELECT_VALUE: `SELECT value FROM settings WHERE key = ?`,
  // updated_at is also maintained by the settings_touch_updated_at trigger;
  // naming it here keeps the row correct even on a database without triggers.
  UPSERT: `INSERT INTO settings (key, value, updated_by) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET
             value = excluded.value,
             updated_by = excluded.updated_by,
             updated_at = datetime('now')`,
  // id must be selected: without it a self-rename reads clash.id as undefined
  // and is (wrongly) reported as a collision with somebody else.
  SELECT_USERNAME: `SELECT id, username FROM admin_users WHERE username = ?`,
  UPDATE_USERNAME: `UPDATE admin_users SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
};

/** Username bounds from the settings page spec (admin_users.username is UNIQUE). */
export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 64;
/** Minimum length of a *new* password chosen on the settings page. */
export const MIN_PASSWORD_LENGTH = 8;
/**
 * Minimum length of the panel ↔ bot Worker setup key. It is a RANDOM key
 * (like a session secret), not a password, so there is no charset policy —
 * only a length floor that rules out a pasted word or a chat id.
 */
export const MIN_SETUP_TOKEN_LENGTH = 32;

/** Length of the generated webhook secret in hex characters (32 bytes). */
export const WEBHOOK_SECRET_LENGTH = 64;

/**
 * Mask for a write-only setting. NEVER returns the stored value.
 *
 *   * empty / not configured        -> `—`
 *   * longer than 12 chars          -> `تنظیم شده …` + its LAST 4 characters
 *   * configured but <= 12 chars    -> `—` (too short to leak 4 chars of)
 *
 * So a viewer learns at most the final 4 characters of a long value, and
 * nothing at all about a short one.
 */
export function maskSettingValue(value: string | null | undefined): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "—";
  if (raw.length > 12) return `تنظیم شده …${raw.slice(-4)}`;
  return "—";
}

/** True when a setting holds a non-empty value. Never expose the value itself. */
export function isConfigured(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * 64-char lowercase hex webhook secret, drawn server-side from
 * crypto.getRandomValues (32 bytes = 256 bits). Never derived from a
 * timestamp or any other predictable input.
 */
export function generateWebhookSecret(): string {
  const bytes = new Uint8Array(WEBHOOK_SECRET_LENGTH / 2);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

export class SettingsService {
  private DB: D1Database;

  constructor(DB: D1Database) {
    this.DB = DB;
  }

  /** Raw value of one setting; `""` when unset. Only for write/compare paths. */
  async get(key: SettingKey): Promise<string> {
    const row = await this.DB.prepare(SETTINGS_QUERIES.SELECT_VALUE)
      .bind(key)
      .first<{ value: string }>();
    return row?.value ?? "";
  }

  /** Raw values for several settings; `""` per missing key. Never render these. */
  async getMany(keys: readonly string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const key of keys) out[key] = await this.get(key as SettingKey);
    return out;
  }

  /** Write (insert or update) one setting for the given admin. */
  async set(key: SettingKey, value: string, updatedBy: number | null): Promise<void> {
    await this.DB.prepare(SETTINGS_QUERIES.UPSERT)
      .bind(key, value, updatedBy)
      .run();
  }

  /** Display-safe hint for a stored setting: masked, never the value. */
  async getMasked(key: SettingKey): Promise<string> {
    return maskSettingValue(await this.get(key));
  }

  /**
   * Change the caller's own username. Uniqueness is enforced twice: by this
   * explicit check (so the caller gets a Persian message instead of a SQLite
   * constraint error) and by the UNIQUE index on admin_users.username.
   */
  async updateUsername(adminId: number, username: string): Promise<string> {
    const trimmed = (username ?? "").trim();

    if (trimmed.length < MIN_USERNAME_LENGTH || trimmed.length > MAX_USERNAME_LENGTH) {
      throw new SettingsError(
        "username_length",
        `نام کاربری باید بین ${MIN_USERNAME_LENGTH} تا ${MAX_USERNAME_LENGTH} کاراکتر باشد.`,
      );
    }
    if (/\s/.test(trimmed)) {
      throw new SettingsError("username_charset", "نام کاربری نباید شامل فاصله باشد.");
    }

    const clash = await this.DB.prepare(SETTINGS_QUERIES.SELECT_USERNAME)
      .bind(trimmed)
      .first<{ id: number }>();
    if (clash && clash.id !== adminId) {
      throw new SettingsError("username_taken", "این نام کاربری قبلاً استفاده شده است.");
    }

    const result = await this.DB.prepare(SETTINGS_QUERIES.UPDATE_USERNAME)
      .bind(trimmed, adminId)
      .run();

    if (!result.meta.changes) {
      throw new SettingsError("not_found", "حساب کاربری پیدا نشد.");
    }
    return trimmed;
  }
}

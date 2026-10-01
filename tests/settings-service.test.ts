// @ts-nocheck -- test harness: needs node:sqlite/node:test (no @types/node
// installed) and a structurally-typed D1 shim. Excluded from the project type
// gate on purpose, same as tests/signup-service.test.ts.
//
// End-to-end exercise of the REAL SettingsService against a fresh copy of the
// project's migration files, plus the write-only masking rules the settings
// page depends on.
//
// Run: node --test --import ./tests/alias-hook.mjs tests/settings-service.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import {
  SETTING_KEYS,
  SettingsError,
  SettingsService,
  generateWebhookSecret,
  isConfigured,
  maskSettingValue,
} from "../src/lib/services/settings.ts";
import { verifyPassword } from "../src/lib/auth.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const MIGRATIONS = path.join(ROOT, "migrations");
const DST = path.join(
  process.env.TMPDIR || "/home/bozorg/.hermes/cache/scratch",
  "settings-service-test.sqlite",
);
for (const suffix of ["", "-wal", "-shm"]) rmSync(DST + suffix, { force: true });

const db = new DatabaseSync(DST);
db.exec("PRAGMA foreign_keys = ON;");
for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
  db.exec(readFileSync(path.join(MIGRATIONS, file), "utf8"));
}

/** Minimal D1 shim: every method is available directly or after .bind(). */
function makeStmt(sql) {
  const stmt = db.prepare(sql);
  let args = [];
  const api = {
    bind(...a) {
      args = a.map((x) => (x === undefined ? null : x));
      return api;
    },
    async run() {
      const info = stmt.run(...args);
      return {
        success: true,
        results: [],
        meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) },
      };
    },
    async all() {
      return { success: true, results: stmt.all(...args) };
    },
    async first() {
      return stmt.get(...args) ?? null;
    },
  };
  return api;
}

const DB = { prepare: makeStmt };
const svc = new SettingsService(DB);
const q = (sql, ...args) => db.prepare(sql).all(...args);

test("fresh DB: settings rows exist and start empty", async () => {
  assert.equal(await svc.get(SETTING_KEYS.BOT_TOKEN), "");
  assert.equal(await svc.get(SETTING_KEYS.BOT_WEBHOOK_SECRET), "");
  assert.equal(isConfigured(await svc.get(SETTING_KEYS.BOT_TOKEN)), false);
});

test("set() writes, get() reads back, updated_by is recorded", async () => {
  const token = "7123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw";
  await svc.set(SETTING_KEYS.BOT_TOKEN, token, 1);
  assert.equal(await svc.get(SETTING_KEYS.BOT_TOKEN), token);
  const row = q("SELECT value, updated_by FROM settings WHERE key = ?", SETTING_KEYS.BOT_TOKEN)[0];
  assert.equal(row.value, token);
  assert.equal(Number(row.updated_by), 1);
});

test("set() is an upsert (second write updates in place, one row only)", async () => {
  await svc.set(SETTING_KEYS.BOT_TOKEN, "111:second-value-aaaaaaaaaaaaaaaaaaaa", 1);
  await svc.set(SETTING_KEYS.BOT_TOKEN, "111:third-value-bbbbbbbbbbbbbbbbbbbbb", 1);
  const rows = q("SELECT value FROM settings WHERE key = ?", SETTING_KEYS.BOT_TOKEN);
  assert.equal(rows.length, 1, "no duplicate rows");
  assert.equal(rows[0].value, "111:third-value-bbbbbbbbbbbbbbbbbbbbb");
  const meta = q("SELECT updated_at FROM settings WHERE key = ?", SETTING_KEYS.BOT_TOKEN)[0];
  assert.ok(meta.updated_at, "updated_at maintained by the 0012 trigger");
});

test("mask: never returns the stored value", async () => {
  const token = "1234567890:AASecretValueThatIsLong_enough_ABCDEFGH";
  await svc.set(SETTING_KEYS.BOT_TOKEN, token, 1);
  const masked = await svc.getMasked(SETTING_KEYS.BOT_TOKEN);
  assert.notEqual(masked, token);
  assert.ok(!masked.includes(token), "full value must never be rendered");
  assert.ok(!masked.includes(token.slice(0, 12)), "no prefix of the value either");
  assert.ok(masked.endsWith(token.slice(-4)), "at most the LAST 4 characters");
  assert.ok(masked.includes("تنظیم شده"));
});

test("mask rules: empty -> —, short configured -> —, long -> last 4 only", () => {
  assert.equal(maskSettingValue(""), "—");
  assert.equal(maskSettingValue(null), "—");
  assert.equal(maskSettingValue(undefined), "—");
  assert.equal(maskSettingValue("   "), "—");
  // 12 chars or fewer: too short to reveal 4 of them.
  assert.equal(maskSettingValue("short-secret"), "—");
  assert.equal(maskSettingValue("123456789012"), "—");
  // 13+ chars: label + exactly the last 4.
  assert.equal(maskSettingValue("1234567890123"), "تنظیم شده …0123");
  assert.equal(maskSettingValue("abcdefghijklm"), "تنظیم شده …jklm");
  // isConfigured is the only place a boolean view of a short value comes from.
  assert.equal(isConfigured("short-secret"), true);
  assert.equal(isConfigured(""), false);
});

test("generateWebhookSecret: 64 lowercase hex chars, fresh each call", () => {
  const a = generateWebhookSecret();
  const b = generateWebhookSecret();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.match(b, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b, "secrets must be drawn fresh, not derived from a clock");
});

test("updateUsername: length bounds are enforced", async () => {
  for (const bad of ["ab", "a".repeat(65), "   "]) {
    await assert.rejects(
      () => svc.updateUsername(1, bad),
      (err) => err instanceof SettingsError && err.code === "username_length",
      `expected username_length for ${JSON.stringify(bad)}`,
    );
  }
});

test("updateUsername: no whitespace, uniqueness respected", async () => {
  await assert.rejects(
    () => svc.updateUsername(1, "two words"),
    (err) => err instanceof SettingsError && err.code === "username_charset",
  );

  // Seed a second admin so "taken by somebody else" is a real collision.
  db.exec(`INSERT INTO admin_users (username, full_name, password_hash, role)
           VALUES ('other_admin', 'ادمین دوم', 'pbkdf2$1$X==$Y==', 'admin')`);
  const otherId = q("SELECT id FROM admin_users WHERE username = 'other_admin'")[0].id;

  await assert.rejects(
    () => svc.updateUsername(1, "other_admin"),
    (err) => err instanceof SettingsError && err.code === "username_taken",
  );
  // Colliding with yourself (unchanged value) is not an error.
  assert.equal(await svc.updateUsername(otherId, "other_admin"), "other_admin");
  await assert.rejects(
    () => svc.updateUsername(1, "other_admin"),
    (err) => err instanceof SettingsError && err.code === "username_taken",
  );
});

test("updateUsername: trims and persists a valid new username", async () => {
  const next = await svc.updateUsername(1, "  gold-admin  ");
  assert.equal(next, "gold-admin");
  const row = q("SELECT username FROM admin_users WHERE id = 1")[0];
  assert.equal(row.username, "gold-admin");
  // Back to the seeded name so later assertions keep their fixture.
  await svc.updateUsername(1, "admin");
  assert.equal(q("SELECT username FROM admin_users WHERE id = 1")[0].username, "admin");
});

test("migration 0013 landed: admin id 1 verifies the initial password", async () => {
  const row = q("SELECT password_hash, must_change_password FROM admin_users WHERE id = 1")[0];
  assert.ok(row, "admin id 1 exists");
  assert.equal(await verifyPassword("123456", row.password_hash), true);
  assert.equal(await verifyPassword("GoldPosAdmin123!", row.password_hash), false);
  assert.ok(Number(row.must_change_password) === 1, "forced change on first login must survive");
});

test("settings service never returns secrets from a mask-shaped API", async () => {
  const secret = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
  await svc.set(SETTING_KEYS.BOT_WEBHOOK_SECRET, secret, 1);
  const masked = await svc.getMasked(SETTING_KEYS.BOT_WEBHOOK_SECRET);
  assert.equal(masked, `تنظیم شده …${secret.slice(-4)}`);
  assert.ok(!masked.includes(secret));
  assert.equal(isConfigured(await svc.get(SETTING_KEYS.BOT_WEBHOOK_SECRET)), true);
});

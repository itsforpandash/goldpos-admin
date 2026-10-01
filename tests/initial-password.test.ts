// @ts-nocheck -- test harness: node:test/node:fs/node:buffer need @types/node
// (not installed) and are excluded from the project type gate on purpose.
//
// Proves migration 0013 actually resets the initial admin password: the hash
// literal is PARSED OUT OF THE .sql FILE, so the migration and the test can
// never drift apart, and it is verified by the very function the login path
// uses (src/lib/auth.ts verifyPassword).
//
// Run: node --test --import ./tests/alias-hook.mjs tests/initial-password.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { hashPassword, verifyPassword } from "../src/lib/auth.ts";

const MIGRATION = path.join(
  import.meta.dirname,
  "..",
  "migrations",
  "0013_set_default_initial_password.sql",
);
const sql = readFileSync(MIGRATION, "utf8");

/** The PBKDF2 literal inside the migration's UPDATE, exactly as stored. */
const HASH_RE = /password_hash\s*=\s*'(pbkdf2\$\d+\$[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2})'/;
const match = sql.match(HASH_RE);

function b64ByteLength(b64) {
  return Buffer.from(b64, "base64").length;
}

test("migration 0013 contains a parseable PBKDF2 literal", () => {
  assert.ok(match, "no password_hash = 'pbkdf2$…' literal found in the migration");
  assert.match(match[1], /^pbkdf2\$/);
});

test("literal uses the exact parameters of src/lib/auth.ts hashPassword", () => {
  const [algorithm, iterations, saltB64, hashB64] = match[1].split("$");
  assert.equal(algorithm, "pbkdf2");
  // auth.ts: const PBKDF2_ITERATIONS = 100_000
  assert.equal(Number(iterations), 100_000, "iterations must match auth.ts");
  // auth.ts: crypto.getRandomValues(new Uint8Array(16)) -> 16-byte salt
  assert.equal(b64ByteLength(saltB64), 16, "salt must be 16 bytes");
  // auth.ts: deriveBits(..., 256) -> 32-byte derived key
  assert.equal(b64ByteLength(hashB64), 32, "derived key must be 256 bits / 32 bytes");
});

test("verifyPassword(initial password, literal from the .sql) === true", async () => {
  const stored = match[1];
  assert.equal(await verifyPassword("123456", stored), true);
});

test("a different password does NOT verify against the literal", async () => {
  const stored = match[1];
  assert.equal(await verifyPassword("1234567", stored), false);
  assert.equal(await verifyPassword("GoldPosAdmin123!", stored), false);
  assert.equal(await verifyPassword("", stored), false);
});

test("the literal was produced by hashPassword itself (round trip)", async () => {
  // Freshly hashing the same password with the module under test must verify,
  // and the migration's literal must verify against that same code path.
  const fresh = await hashPassword("123456");
  assert.notEqual(fresh, match[1], "each hash uses a new random salt");
  assert.equal(await verifyPassword("123456", fresh), true);
  assert.equal(await verifyPassword("123456", match[1]), true);
});

test("migration keeps must_change_password = TRUE for admin id 1", () => {
  // The initial password is public (it ships in this file), so the first login
  // MUST still force a real password. Assert the flag survives the reset.
  assert.match(
    sql,
    /UPDATE\s+admin_users[\s\S]*?must_change_password\s*=\s*TRUE\s+WHERE\s+id\s*=\s*1\s*;/i,
    "migration must set must_change_password = TRUE for id = 1",
  );
});

test("migration is additive (no destructive statements)", () => {
  // Strip `--` comments first: the file *documents* that it drops nothing.
  const statements = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  assert.doesNotMatch(statements, /\bDROP\b/i, "migration 0013 must never DROP anything");
  assert.doesNotMatch(statements, /\bDELETE\b/i, "migration 0013 must never DELETE rows");
  assert.match(statements, /^\s*UPDATE\s+admin_users\b/i, "the only statement is an UPDATE");
});

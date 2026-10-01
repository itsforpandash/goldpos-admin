-- Migration 0013: reset the super admin's login to the panel's initial password.
--
-- WHY
--   Migration 0007 seeded a hardcoded bootstrap credential and migration 0009
--   forced every admin to change it on first login. That worked, but the
--   operator asked for one known starting point that survives a fresh deploy or
--   a forgotten-password reset: the initial password is 123456.
--
--   PBKDF2 cannot be computed inside SQLite, so the hash below was produced by
--   the very code the app verifies with — src/lib/auth.ts hashPassword()
--   (PBKDF2-SHA256, 100_000 iterations, 16-byte random salt, 256-bit derived
--   key, both encoded base64, stored as
--   `pbkdf2$<iterations>$<salt_b64>$<hash_b64>`).
--   tests/initial-password.test.ts parses THIS literal out of this file and
--   asserts verifyPassword('123456', <literal>) === true, so the SQL and the
--   verifier can never drift apart.
--
--   must_change_password STAYS TRUE, and that is the whole safety property:
--   123456 is public by construction (it ships in this file, in git), so it
--   must never become a permanent credential. The flag forces the first login
--   through the change-password flow; only after the holder proves possession
--   of this value and sets a real one does the flag clear (src/pages/admin/
--   change-password/submit.ts and src/pages/admin/settings/action.ts both
--   write must_change_password = 0 together with the new hash).
--
-- RULES (see migrations/README.md)
--   * Additive only: this file is an UPDATE, no DROP, safe to apply live.
--   * Only the initial password's plaintext is written down here — that is the
--     point of the reset. Never write a real (post-reset) password anywhere.

UPDATE admin_users
SET password_hash = 'pbkdf2$100000$QLvOpzzoYpCKt3L055egbQ==$1B6EmAUHSkXpgdmpI9ze1QwM6BDnABXxIg55ASmbttE=',
    must_change_password = TRUE
WHERE id = 1;

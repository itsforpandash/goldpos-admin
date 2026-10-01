-- Migration 0009: force a password change for every admin account (NON-DESTRUCTIVE)
--
-- WHY THIS EXISTS
--   Migration 0007 seeds the super_admin row with a well-known bootstrap password
--   ("GoldPosAdmin123!") and a hardcoded PBKDF2 hash. That password literal lives in
--   the PUBLIC git history of this repository, so the credential is burned and can
--   never be considered secret again. Deleting the line from 0007 would not help:
--   the hash would still be in git history, and it would destroy the audit trail of
--   what actually shipped.
--
--   The real fix is at the data level: mark every existing admin row as
--   "must change this password". A row flagged this way is only usable for admin
--   actions after the holder proves possession of the current password AND sets a
--   new one (see /admin/change-password).
--
--   PBKDF2 cannot be computed inside SQLite, so a migration cannot re-hash or
--   replace the stored password. The flag is therefore the neutralizing mechanism.
--
-- RULES FOR THIS FILE (see migrations/README.md)
--   * Additive only: ALTER TABLE ADD COLUMN / UPDATE / CREATE ... IF NOT EXISTS.
--   * NEVER add DROP TABLE / DROP INDEX / DROP TRIGGER here. Migrations 0001-0008
--     start with `DROP TABLE IF EXISTS` and are destructive — they must never be
--     re-run or edited. This one must stay safe to apply on a live database.
--   * D1 records applied migrations by name: editing an applied file is silently
--     ignored, so editing 0007 would NOT have changed any database anyway.

-- 1) Add the flag. DEFAULT TRUE means a future INSERT that omits
--    must_change_password (i.e. every new admin created without an explicit value)
--    is forced into the change-password flow, so a bootstrap password can never
--    silently become a permanent credential.
--    SQLite cannot add a CHECK constraint to an existing table without a
--    destructive table rebuild (which would require rewriting 0007's table), so
--    the column DEFAULT is the enforcement mechanism here, backed by the
--    application check in src/pages/admin/change-password/submit.ts.
ALTER TABLE admin_users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT TRUE;

-- 2) Force the flag on every pre-existing admin, including the seeded super_admin
--    whose password is public. Until each of them sets a new password through
--    /admin/change-password, the burned default credential grants nothing.
UPDATE admin_users SET must_change_password = TRUE;

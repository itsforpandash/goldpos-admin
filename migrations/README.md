# ⚠️ MIGRATION RULES — READ BEFORE WRITING OR RUNNING ANY SQL HERE

**Translations**

> **مهاجرت‌های ۰۰۰۱ تا ۰۰۰۸ مخرب (DESTRUCTIVE) هستند و هرگز نباید دوباره اجرا یا ویرایش شوند.**
> اجرای مجدد آن‌ها **تمام داده‌های دیتابیس را پاک می‌کند**.

---

## 1. Migrations `0001`–`0008` are destructive. Never re-run or edit them.

Every one of those files begins with `DROP TABLE IF EXISTS <table>;`. That means:

- **Re-running any of them destroys all production data.** There is no undo.
  Running `wrangler d1 migrations apply` against a database whose `d1_migrations`
  table was cleared, or against a hand-made database, wipes everything.
- **Editing them does nothing at all.** D1 records applied migrations **by file
  name** in the `d1_migrations` table. If `0007_create_admin_users.sql` is already
  applied, changing its contents is *silently ignored* — the file is never executed
  again. An "edit" that appears to work locally only worked because the local
  database was recreated from scratch.
- They are also **historical record**: they describe what actually shipped.

## 2. The burned default password must stay in `0007`.

`0007_create_admin_users.sql` seeds a `super_admin` (`admin` / `GoldPosAdmin123!`)
with a hardcoded PBKDF2 hash and a comment saying to change it after first login.
**That comment was never honoured, and the repository is public, so the credential
is burned** — it exists permanently in git history.

Deleting the line would be actively harmful:

- It would not remove the credential from git history, so it would buy no security.
- It would hide the incident from anyone auditing this repository later.
- It would break a byte-for-byte audit of what shipped, and would break fresh
  database bootstrapping that has to reproduce the original schema.

The credential is neutralised at the **data** level instead: migration `0009` sets
`must_change_password = TRUE` on every admin, and the login flow refuses to treat a
flagged account as usable until it sets a new password at `/admin/change-password`.

## 3. From `0009` onward: additive only.

New migrations **must** use, and may only use:

| Allowed                                        | Forbidden                                      |
| ---------------------------------------------- | ---------------------------------------------- |
| `CREATE TABLE IF NOT EXISTS`                   | `DROP TABLE`                                   |
| `CREATE INDEX IF NOT EXISTS`                   | `DROP INDEX`                                   |
| `CREATE TRIGGER IF NOT EXISTS`                 | `DROP TRIGGER`                                 |
| `ALTER TABLE ... ADD COLUMN`                   | `ALTER TABLE ... DROP COLUMN`                  |
| `UPDATE` (only with a `WHERE` that matches rows you intend) | table rebuilds that recreate an existing table |
| `INSERT` (settings / lookup seed data only)    | anything destructive "for convenience"         |

Checklist for a new migration `N+1`:

1. New file name, never reuse an existing number — `d1_migrations` matches on name.
2. No `DROP` of any kind. If a change genuinely needs a table rebuild, get sign-off
   first; it must be a separate, explicitly reviewed migration, not a drive-by edit.
3. Additive `ALTER TABLE ... ADD COLUMN` must be safe to run twice in a scratch DB.
4. Never hash or generate secrets inside SQL — PBKDF2 is not available in SQLite.
   Use a flag column (like `must_change_password`) and enforce it in application code.

## 4. Where the enforcement lives

| Concern                                             | File                                                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Flag column, forces every existing admin to rotate  | `migrations/0009_first_login_password.sql`                                               |
| Login response signals the forced-change state       | `src/pages/api/auth/login.ts`                                                             |
| Rotation UI + current-password verification           | `src/pages/admin/change-password.astro`, `src/pages/admin/change-password/submit.ts`      |
| Persistence of hash + clearing the flag              | `src/lib/services/admin.ts` (`changePassword`)                                            |

Remember: `0009` only sets the flag. Nothing redirects a flagged admin away from
`/admin` yet — that gate belongs in `src/middleware.ts`, which treats
`must_change_password` like `is_active` (redirect to `/admin/change-password`,
excluding the change-password page itself and `/api/auth/logout`).

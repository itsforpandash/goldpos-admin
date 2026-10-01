import { verifyPassword, hashPassword } from "@/lib/auth";
import { AdminUserService } from "@/lib/services/admin";
import { ActivityService } from "@/lib/services/activity";
import { RateLimiter } from "@/lib/security";

// Same 303 + ?ok= / ?err= convention as src/pages/admin/*/action.ts.
const redirect = (to: string) =>
  new Response(null, { status: 303, headers: { Location: to } });

// Brute-force guard on the current-password check (per IP + admin, in-memory
// per isolate — same model as loginLimiter in src/lib/security.ts).
const changePasswordLimiter = new RateLimiter(5 * 60 * 1000, 20);

/** The bootstrap credential shipped in migration 0007 — public, therefore burned. */
const BURNED_DEFAULT_PASSWORD = "GoldPosAdmin123!";
const BURNED_SUBSTRING = "GoldPosAdmin";

const MIN_PASSWORD_LENGTH = 12;

export async function POST({ locals, request }: { locals: App.Locals; request: Request }) {
  const { DB } = locals.runtime.env;
  const admin = locals.SESSION;

  // Middleware already guards /admin/*, but never mutate without a session.
  if (!admin?.id) return redirect("/admin/login");

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (!changePasswordLimiter.allow(`chpw_${ip}_${admin.id}`)) {
    return redirect("/admin/change-password?err=rate_limit");
  }

  const form = await request.formData();
  const currentPassword = String(form.get("current_password") ?? "");
  const newPassword = String(form.get("new_password") ?? "");
  const confirmPassword = String(form.get("confirm_password") ?? "");

  if (!currentPassword || !newPassword || !confirmPassword) {
    return redirect("/admin/change-password?err=fields");
  }

  const adminService = new AdminUserService(DB);
  const activityService = new ActivityService(DB);

  const logFailure = async (code: string) => {
    // Codes only — the passwords are never written to the audit log or the URL.
    await activityService.log({
      actorId: admin.id,
      action: "admin_password_change_failed",
      targetType: "admin",
      targetId: admin.id,
      metadata: { reason: code },
      result: "fail",
      ipAddress: ip,
    });
    return redirect(`/admin/change-password?err=${code}`);
  };

  try {
    const row = await adminService.getWithHash(admin.id);
    if (!row) return redirect("/admin/login");

    // 1. The current password must be proven before anything changes.
    const currentOk = await verifyPassword(currentPassword, row.password_hash);
    if (!currentOk) return await logFailure("current");

    // 2. New password must not be the burned default nor derived from it.
    const normalized = newPassword.toLowerCase();
    if (newPassword === BURNED_DEFAULT_PASSWORD || normalized.includes(BURNED_SUBSTRING.toLowerCase())) {
      return await logFailure("burned");
    }

    // 3. Minimum strength.
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return await logFailure("weak");
    }

    // 4. Confirmation must match.
    if (newPassword !== confirmPassword) {
      return await logFailure("confirm");
    }

    const newHash = await hashPassword(newPassword);
    await adminService.changePassword(admin.id, newHash, false);

    await activityService.log({
      actorId: admin.id,
      action: "admin_password_changed",
      targetType: "admin",
      targetId: admin.id,
      metadata: { username: row.username },
      result: "success",
      ipAddress: ip,
    });

    return redirect("/admin/change-password?ok=changed");
  } catch {
    return redirect("/admin/change-password?err=action");
  }
}

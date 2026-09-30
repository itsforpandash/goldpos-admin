import { hashPassword, verifyPassword, createSessionToken, verifySessionToken, parseCookie, SESSION_COOKIE } from "@/lib/auth";
import { AdminUserService } from "@/lib/services/admin";
import { loginLimiter } from "@/lib/security";
import { ActivityService } from "@/lib/services/activity";
import { getEnvSecret } from "@/lib/session-helpers";

export async function POST({ locals, request }) {
  const { DB } = locals.runtime.env;

  try {
    const { username, password } = await request.json();
    if (!username || !password) {
      return Response.json({ message: "نام کاربری و رمز عبور الزامی است", success: false }, { status: 400 });
    }

    // Rate limiting
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    const rateKey = `login_${ip}_${username}`;
    if (!loginLimiter.allow(rateKey)) {
      return Response.json({ message: "تعداد تلاش بیش از حد مجاز. لطفاً بعداً دوباره امتحان کنید.", success: false }, { status: 429 });
    }

    const adminService = new AdminUserService(DB);
    const activityService = new ActivityService(DB);

    const admin = await adminService.getByUsername(username);
    if (!admin || !admin.is_active) {
      await activityService.log({ action: "login_failed", targetType: "admin", targetId: 0, metadata: { username }, result: "fail", ipAddress: ip });
      return Response.json({ message: "نام کاربری یا رمز عبور اشتباه است", success: false }, { status: 401 });
    }

    const valid = await verifyPassword(password, admin.password_hash);
    if (!valid) {
      await activityService.log({ action: "login_failed", targetType: "admin", targetId: admin.id, metadata: { username }, result: "fail", ipAddress: ip });
      return Response.json({ message: "نام کاربری یا رمز عبور اشتباه است", success: false }, { status: 401 });
    }

    // Create session — MUST use the same secret resolution as the middleware
    // (getEnvSecret), otherwise signing and verification use different keys.
    const tokenInfo = await createSessionToken(admin.id, getEnvSecret(locals.runtime.env));

    await activityService.log({
      actorId: admin.id,
      action: "login",
      targetType: "admin",
      targetId: admin.id,
      result: "success",
      ipAddress: ip,
    });

    await adminService.touchLogin(admin.id);

    const response = Response.json({
      success: true,
      admin: {
        id: admin.id,
        username: admin.username,
        full_name: admin.full_name,
        role: admin.role,
      },
    });

    response.headers.set("Set-Cookie", `${SESSION_COOKIE}=${tokenInfo.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 8}`);
    return response;

  } catch (error) {
    console.error("Login error:", error);
    return Response.json({ message: "خطای سرور", success: false }, { status: 500 });
  }
}

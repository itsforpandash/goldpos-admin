import { SESSION_COOKIE } from "@/lib/auth";
import { parseCookie, verifySessionToken } from "@/lib/auth";
import { AdminUserService } from "@/lib/services/admin";
import { getEnvSecret } from "@/lib/session-helpers";

export async function GET({ locals, request }) {
  const env = locals.runtime.env;
  const secret = getEnvSecret(env);
  const cookies = parseCookie(request.headers.get("cookie"));
  const raw = cookies[SESSION_COOKIE];

  if (!raw) {
    return Response.json({ success: false, authenticated: false });
  }

  const result = await verifySessionToken(raw, secret);
  if (!result) {
    return Response.json({ success: false, authenticated: false });
  }

  const adminService = new AdminUserService(env.DB);
  const admin = await adminService.getById(result.adminId);
  if (!admin || !admin.is_active) {
    return Response.json({ success: false, authenticated: false });
  }

  return Response.json({ success: true, authenticated: true, admin });
}

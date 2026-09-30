import { defineMiddleware } from "astro:middleware";
import { SESSION_COOKIE, parseCookie, verifySessionToken } from "@/lib/auth";
import { AdminUserService } from "@/lib/services/admin";
import { getEnvSecret } from "@/lib/session-helpers";

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, locals } = context;
  const url = new URL(request.url);

  // Skip auth for static assets, API routes, login page and landing
  if (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/manifest") ||
    url.pathname === "/sw.js" ||
    url.pathname === "/favicon.svg" ||
    url.pathname === "/admin/login" ||
    url.pathname === "/"
  ) {
    return next();
  }

  // Auth required for admin routes
  try {
    const env = locals.runtime.env;
    const secret = getEnvSecret(env);
    const cookies = parseCookie(request.headers.get("cookie"));
    const raw = cookies[SESSION_COOKIE];

    if (!raw) {
      return context.redirect("/admin/login");
    }

    const result = await verifySessionToken(raw, secret);
    if (!result) {
      return context.redirect("/admin/login");
    }

    const adminService = new AdminUserService(env.DB);
    const admin = await adminService.getById(result.adminId);
    if (!admin || !admin.is_active) {
      return context.redirect("/admin/login");
    }

    locals.SESSION = admin;
  } catch (err) {
    console.error("middleware auth error:", err);
    return context.redirect("/admin/login");
  }

  return next();
});

import { defineMiddleware } from "astro:middleware";
import { SESSION_COOKIE, parseCookie, verifySessionToken } from "@/lib/auth";
import { AdminUserService } from "@/lib/services/admin";
import { getEnvSecret } from "@/lib/session-helpers";

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, locals } = context;
  const url = new URL(request.url);

  // Protected surface is /admin — everything else is public on purpose:
  // the landing page, /signup, /health, /api (authenticated per endpoint) and
  // the catch-all 404 (src/pages/[...slug].astro).
  //
  // The previous rule inverted that: it guarded EVERY path not explicitly
  // listed, so a visitor who followed a dead link was bounced to the login
  // page instead of seeing 404, and the unknown path never reached the
  // catch-all at all. A future admin page must live under /admin/ — that is
  // the whole contract of this block.
  if (!url.pathname.startsWith("/admin/")) {
    return next();
  }

  // The only public page under /admin is the login form itself.
  if (url.pathname === "/admin/login") {
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

import type { APIContext } from "astro";
import { SESSION_COOKIE } from "@/lib/auth";

const CLEAR_COOKIE = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;

const HTML_REDIRECT = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="refresh" content="0; url=/admin/login" />
  <title>در حال خروج...</title>
  <script>window.location.replace("/admin/login");</script>
</head>
<body style="font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background-color: #0f172a; color: #f8fafc;">
  <div style="text-align: center; padding: 2rem;">
    <div style="font-size: 2rem; margin-bottom: 1rem;">👋</div>
    <h2 style="margin-bottom: 0.5rem; font-size: 1.25rem; font-weight: bold;">خروج موفق از حساب کاربری</h2>
    <p style="color: #94a3b8; font-size: 0.875rem;">در حال انتقال به صفحه ورود...</p>
    <a href="/admin/login" style="color: #f59e0b; text-decoration: underline; font-size: 0.875rem; margin-top: 1rem; display: inline-block;">اگر خودکار منتقل نشدید اینجا کلیک کنید</a>
  </div>
</body>
</html>`;

export async function ALL({}: APIContext) {
  return new Response(HTML_REDIRECT, {
    status: 302,
    headers: {
      Location: "/admin/login",
      "Set-Cookie": CLEAR_COOKIE,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}

export const GET = ALL;
export const POST = ALL;

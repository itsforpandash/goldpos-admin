import type { APIContext } from "astro";
import { SESSION_COOKIE } from "@/lib/auth";

const CLEAR_COOKIE = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;

export async function GET({}: APIContext) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/admin/login",
      "Set-Cookie": CLEAR_COOKIE,
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}

export async function POST({}: APIContext) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: "/admin/login",
      "Set-Cookie": CLEAR_COOKIE,
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}

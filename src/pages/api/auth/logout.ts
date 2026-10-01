import type { APIContext } from "astro";
import { SESSION_COOKIE } from "@/lib/auth";

const CLEAR_COOKIE = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;

export async function GET({ request }: APIContext) {
  const accept = request.headers.get("accept") || "";

  if (accept.includes("application/json") && !accept.includes("text/html")) {
    const response = Response.json({ success: true, message: "Logged out" });
    response.headers.set("Set-Cookie", CLEAR_COOKIE);
    return response;
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/admin/login",
      "Set-Cookie": CLEAR_COOKIE,
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}

export async function POST({ request }: APIContext) {
  const accept = request.headers.get("accept") || "";

  if (accept.includes("application/json") && !accept.includes("text/html")) {
    const response = Response.json({ success: true, message: "Logged out" });
    response.headers.set("Set-Cookie", CLEAR_COOKIE);
    return response;
  }

  return new Response(null, {
    status: 303,
    headers: {
      Location: "/admin/login",
      "Set-Cookie": CLEAR_COOKIE,
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}

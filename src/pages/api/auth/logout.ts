import { SESSION_COOKIE } from "@/lib/auth";

export async function GET({ request }) {
  // GET = logout redirect or clear session
  const response = Response.json({ success: true, message: "Logged out" });
  response.headers.set("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return response;
}

export async function POST({ request }) {
  const response = Response.json({ success: true, message: "Logged out" });
  response.headers.set("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return response;
}

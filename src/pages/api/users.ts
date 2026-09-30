import { validateApiTokenResponse } from "@/lib/api";
import { UserService } from "@/lib/services/user";

export async function GET({ locals, request }) {
  const { API_TOKEN, DB } = locals.runtime.env;
  const invalid = await validateApiTokenResponse(request, API_TOKEN);
  if (invalid) return invalid;

  const url = new URL(request.url);
  const search = url.searchParams.get("search") || undefined;
  const status = url.searchParams.get("status") || undefined;

  const userService = new UserService(DB);
  const users = await userService.getAll(search, status);
  return Response.json({ users });
}

export async function POST({ locals, request }) {
  const { API_TOKEN, DB } = locals.runtime.env;
  const invalid = await validateApiTokenResponse(request, API_TOKEN);
  if (invalid) return invalid;

  try {
    const body = await request.json();
    if (!body.username || !body.full_name || !body.phone) {
      return Response.json(
        { message: "username, full_name and phone are required", success: false },
        { status: 400 },
      );
    }
    const userService = new UserService(DB);
    const result = await userService.create(body);
    return Response.json({ success: true, userId: result.userId }, { status: 201 });
  } catch (error: any) {
    const msg = error?.message || "Failed to create user";
    const status = /required/i.test(msg) ? 400 : /UNIQUE/i.test(msg) ? 409 : 500;
    return Response.json({ message: msg, success: false }, { status });
  }
}

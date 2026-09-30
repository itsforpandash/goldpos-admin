import { validateApiTokenResponse } from "@/lib/api";
import { UserService } from "@/lib/services/user";

export async function GET({ locals, params, request }) {
  const { API_TOKEN, DB } = locals.runtime.env;
  const invalid = await validateApiTokenResponse(request, API_TOKEN);
  if (invalid) return invalid;

  const userService = new UserService(DB);
  const user = await userService.getById(Number(params.id));
  if (!user) return Response.json({ message: "User not found" }, { status: 404 });
  return Response.json({ user });
}

export async function PUT({ locals, params, request }) {
  const { API_TOKEN, DB } = locals.runtime.env;
  const invalid = await validateApiTokenResponse(request, API_TOKEN);
  if (invalid) return invalid;

  try {
    const body = await request.json();
    const userService = new UserService(DB);
    if (body.status) {
      await userService.updateStatus(Number(params.id), body.status);
    }
    return Response.json({ success: true });
  } catch (error: any) {
    return Response.json({ message: error?.message || "Failed to update user", success: false }, { status: 500 });
  }
}

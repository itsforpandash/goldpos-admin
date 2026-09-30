import { validateApiTokenResponse } from "@/lib/api";
import { LicenseService } from "@/lib/services/license";

export async function GET({ locals, request }) {
  const { API_TOKEN, DB } = locals.runtime.env;
  const invalid = await validateApiTokenResponse(request, API_TOKEN);
  if (invalid) return invalid;

  const url = new URL(request.url);
  const status = url.searchParams.get("status") || undefined;
  const search = url.searchParams.get("search") || undefined;

  const licenseService = new LicenseService(DB);
  const licenses = await licenseService.getAll(status, search);
  return Response.json({ licenses });
}

export async function POST({ locals, request }) {
  const { API_TOKEN, DB } = locals.runtime.env;
  const invalid = await validateApiTokenResponse(request, API_TOKEN);
  if (invalid) return invalid;

  try {
    const body = await request.json();
    const { userId, planId, quantity = 1, durationDays, maxDevices, expiresAt } = body;

    if (!userId || !planId) {
      return Response.json({ message: "userId and planId are required", success: false }, { status: 400 });
    }

    const days = durationDays ?? 30;
    const expiry = expiresAt || new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    const licenseService = new LicenseService(DB);
    const result = await licenseService.generateForUser(
      {
        userId: Number(userId),
        planId: Number(planId),
        maxDevices: maxDevices ?? 1,
        expiresAt: expiry,
      },
      Number(quantity),
    );

    return Response.json(result, { status: result.success ? 201 : 500 });
  } catch (error: any) {
    return Response.json({ message: error?.message || "Failed to generate license", success: false }, { status: 500 });
  }
}

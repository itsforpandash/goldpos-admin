import { validateApiTokenResponse } from "@/lib/api";
import { DeviceService, generateDeviceHash } from "@/lib/services/device";

export async function GET({ locals, request }) {
  const { API_TOKEN, DB } = locals.runtime.env;
  const invalid = await validateApiTokenResponse(request, API_TOKEN);
  if (invalid) return invalid;

  const url = new URL(request.url);
  const status = url.searchParams.get("status") || undefined;
  const search = url.searchParams.get("search") || undefined;

  const deviceService = new DeviceService(DB);
  const devices = await deviceService.getAll(status, search);
  return Response.json({ devices });
}

export async function POST({ locals, request }) {
  const { API_TOKEN, DB } = locals.runtime.env;
  const invalid = await validateApiTokenResponse(request, API_TOKEN);
  if (invalid) return invalid;

  try {
    const body = await request.json();
    const deviceService = new DeviceService(DB);

    // Generate a device hash if not provided
    if (!body.deviceHash) {
      body.deviceHash = generateDeviceHash();
    }

    const result = await deviceService.create(body);
    return Response.json(result, { status: 201 });
  } catch (error: any) {
    return Response.json({ message: error?.message || "Failed to create device", success: false }, { status: 500 });
  }
}

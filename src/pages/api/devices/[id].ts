import { validateApiTokenResponse } from "@/lib/api";
import { DeviceService } from "@/lib/services/device";
import { ActivityService } from "@/lib/services/activity";

export async function GET({ locals, params, request }) {
  const { API_TOKEN, DB } = locals.runtime.env;
  const invalid = await validateApiTokenResponse(request, API_TOKEN);
  if (invalid) return invalid;

  const deviceId = Number(params.id);
  const deviceService = new DeviceService(DB);
  const device = await deviceService.getById(deviceId);
  if (!device) return Response.json({ message: "Device not found" }, { status: 404 });
  return Response.json({ device });
}

export async function POST({ locals, params, request }) {
  const { API_TOKEN, DB } = locals.runtime.env;
  const invalid = await validateApiTokenResponse(request, API_TOKEN);
  if (invalid) return invalid;

  const deviceId = Number(params.id);
  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  const body = await request.json().catch(() => ({}));

  const deviceService = new DeviceService(DB);
  const activityService = new ActivityService(DB);

  try {
    switch (action) {
      case "deactivate": {
        await deviceService.deactivate(deviceId);
        await activityService.log({
          action: "device_deactivated",
          targetType: "device",
          targetId: deviceId,
          result: "success",
        });
        return Response.json({ success: true });
      }
      case "block": {
        await deviceService.block(deviceId);
        await activityService.log({
          action: "device_blocked",
          targetType: "device",
          targetId: deviceId,
          result: "success",
        });
        return Response.json({ success: true });
      }
      case "reset": {
        await deviceService.resetDevice(deviceId);
        await activityService.log({
          action: "device_reset",
          targetType: "device",
          targetId: deviceId,
          result: "success",
        });
        return Response.json({ success: true });
      }
      default:
        return Response.json({ message: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error: any) {
    return Response.json({ message: error?.message || "Action failed", success: false }, { status: 500 });
  }
}

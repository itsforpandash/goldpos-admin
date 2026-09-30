import { DeviceService } from "@/lib/services/device";
import { ActivityService } from "@/lib/services/activity";

const redirect = (to: string) =>
  new Response(null, { status: 303, headers: { Location: to } });

export async function POST({ locals, request }) {
  const { DB } = locals.runtime.env;
  const admin = locals.SESSION;

  const form = await request.formData();
  const id = Number(form.get("id"));
  const action = String(form.get("action") || "");

  if (!id || !action) {
    return redirect("/admin/devices?err=fields");
  }

  try {
    const deviceService = new DeviceService(DB);
    const activityService = new ActivityService(DB);

    switch (action) {
      case "deactivate":
        await deviceService.deactivate(id);
        await activityService.log({
          actorId: admin?.id,
          action: "device_deactivated",
          targetType: "device",
          targetId: id,
          result: "success",
          ipAddress: request.headers.get("cf-connecting-ip") || "unknown",
        });
        return redirect("/admin/devices?ok=deactivated");
      case "block":
        await deviceService.block(id);
        await activityService.log({
          actorId: admin?.id,
          action: "device_blocked",
          targetType: "device",
          targetId: id,
          result: "success",
          ipAddress: request.headers.get("cf-connecting-ip") || "unknown",
        });
        return redirect("/admin/devices?ok=blocked");
      case "reset":
        await deviceService.resetDevice(id);
        await activityService.log({
          actorId: admin?.id,
          action: "device_reset",
          targetType: "device",
          targetId: id,
          result: "success",
          ipAddress: request.headers.get("cf-connecting-ip") || "unknown",
        });
        return redirect("/admin/devices?ok=reset");
      default:
        return redirect("/admin/devices?err=unknown_action");
    }
  } catch {
    return redirect("/admin/devices?err=action");
  }
}

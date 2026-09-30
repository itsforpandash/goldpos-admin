import { LicenseService } from "@/lib/services/license";
import { ActivityService } from "@/lib/services/activity";

const redirect = (to: string) =>
  new Response(null, { status: 303, headers: { Location: to } });

export async function POST({ locals, request }) {
  const { DB } = locals.runtime.env;
  const admin = locals.SESSION;

  const form = await request.formData();
  const id = Number(form.get("id"));
  const action = String(form.get("action") || "");
  const days = Math.min(Math.max(Number(form.get("days")) || 30, 1), 3650);

  if (!id || !action) {
    return redirect("/admin/licenses?err=fields");
  }

  try {
    const licenseService = new LicenseService(DB);
    const activityService = new ActivityService(DB);

    if (action === "revoke") {
      await licenseService.revoke(id, admin?.id);
      await activityService.log({
        actorId: admin?.id,
        action: "license_revoked",
        targetType: "license",
        targetId: id,
        result: "success",
        ipAddress: request.headers.get("cf-connecting-ip") || "unknown",
      });
      return redirect("/admin/licenses?ok=revoked");
    }

    if (action === "extend") {
      const result = await licenseService.extend(id, days);
      if (!result.success) {
        return redirect("/admin/licenses?err=extend");
      }
      await activityService.log({
        actorId: admin?.id,
        action: "license_extended",
        targetType: "license",
        targetId: id,
        metadata: { days },
        result: "success",
        ipAddress: request.headers.get("cf-connecting-ip") || "unknown",
      });
      return redirect("/admin/licenses?ok=extended");
    }

    return redirect("/admin/licenses?err=unknown_action");
  } catch {
    return redirect("/admin/licenses?err=action");
  }
}

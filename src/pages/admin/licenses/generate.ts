import { LicenseService } from "@/lib/services/license";
import { ActivityService } from "@/lib/services/activity";

const redirect = (to: string) =>
  new Response(null, { status: 303, headers: { Location: to } });

export async function POST({ locals, request }) {
  const { DB } = locals.runtime.env;
  const admin = locals.SESSION;

  const form = await request.formData();
  const userId = Number(form.get("user_id"));
  const planId = Number(form.get("plan_id"));
  const quantity = Math.min(Math.max(Number(form.get("quantity")) || 1, 1), 50);
  const days = Math.min(Math.max(Number(form.get("days")) || 30, 1), 3650);
  const maxDevices = Math.min(Math.max(Number(form.get("max_devices")) || 1, 1), 20);

  if (!userId || !planId) {
    return redirect("/admin/licenses?err=fields");
  }

  try {
    const licenseService = new LicenseService(DB);
    const activityService = new ActivityService(DB);
    const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
    const result = await licenseService.generateForUser(
      { userId, planId, maxDevices, expiresAt },
      quantity,
    );

    await activityService.log({
      actorId: admin?.id,
      action: "licenses_generated",
      targetType: "license",
      targetId: 0,
      metadata: { quantity, days, userId, planId, codes: result.codes },
      result: result.success ? "success" : "fail",
      ipAddress: request.headers.get("cf-connecting-ip") || "unknown",
    });

    if (!result.success) {
      return redirect("/admin/licenses?err=generate");
    }
    return redirect(`/admin/licenses?ok=generated_${result.codes.length}`);
  } catch {
    return redirect("/admin/licenses?err=generate");
  }
}

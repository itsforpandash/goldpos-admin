import { PlanService } from "@/lib/services/plan";
import { ActivityService } from "@/lib/services/activity";

const redirect = (to: string) =>
  new Response(null, { status: 303, headers: { Location: to } });

export async function POST({ locals, request }) {
  const { DB } = locals.runtime.env;
  const admin = locals.SESSION;

  const form = await request.formData();
  const name = String(form.get("name") || "").trim();
  const price = Math.max(Number(form.get("price")) || 0, 0);
  const durationDays = Math.max(Number(form.get("duration_days")) || 30, 1);
  const maxDevices = Math.max(Number(form.get("max_devices")) || 1, 1);
  const description = String(form.get("description") || "").trim() || undefined;

  if (name.length < 2) {
    return redirect("/admin/plans?err=fields");
  }

  try {
    const planService = new PlanService(DB);
    const activityService = new ActivityService(DB);
    const result = await planService.create({
      name,
      price,
      duration_days: durationDays,
      max_devices: maxDevices,
      description,
      status: "active",
    });

    await activityService.log({
      actorId: admin?.id,
      action: "plan_created",
      targetType: "plan",
      targetId: result.planId,
      metadata: { name, price },
      result: "success",
      ipAddress: request.headers.get("cf-connecting-ip") || "unknown",
    });

    return redirect("/admin/plans?ok=created");
  } catch (error: any) {
    if (String(error?.message).includes("UNIQUE")) {
      return redirect("/admin/plans?err=duplicate");
    }
    return redirect("/admin/plans?err=create");
  }
}

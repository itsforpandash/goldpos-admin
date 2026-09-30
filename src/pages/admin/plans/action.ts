import { PlanService } from "@/lib/services/plan";
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
    return redirect("/admin/plans?err=fields");
  }

  try {
    const planService = new PlanService(DB);
    const activityService = new ActivityService(DB);

    if (action === "toggle") {
      const plan = await planService.getById(id);
      if (!plan) return redirect("/admin/plans?err=not_found");
      const status = plan.status === "active" ? "inactive" : "active";
      await planService.update({
        id,
        name: plan.name,
        description: plan.description,
        price: plan.price,
        currency: plan.currency,
        duration_days: plan.duration_days,
        max_devices: plan.max_devices,
        status,
      });
      await activityService.log({
        actorId: admin?.id,
        action: "plan_status_changed",
        targetType: "plan",
        targetId: id,
        metadata: { status },
        result: "success",
        ipAddress: request.headers.get("cf-connecting-ip") || "unknown",
      });
      return redirect("/admin/plans?ok=status");
    }

    if (action === "delete") {
      await planService.delete(id);
      await activityService.log({
        actorId: admin?.id,
        action: "plan_deleted",
        targetType: "plan",
        targetId: id,
        result: "success",
        ipAddress: request.headers.get("cf-connecting-ip") || "unknown",
      });
      return redirect("/admin/plans?ok=deleted");
    }

    return redirect("/admin/plans?err=unknown_action");
  } catch {
    return redirect("/admin/plans?err=action");
  }
}

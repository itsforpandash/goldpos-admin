import { UserService } from "@/lib/services/user";
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
    return redirect("/admin/users?err=fields");
  }

  try {
    const userService = new UserService(DB);
    const activityService = new ActivityService(DB);

    if (action === "activate" || action === "suspend") {
      const status = action === "activate" ? "active" : "suspended";
      await userService.updateStatus(id, status);
      await activityService.log({
        actorId: admin?.id,
        action: "user_status_changed",
        targetType: "user",
        targetId: id,
        metadata: { status },
        result: "success",
        ipAddress: request.headers.get("cf-connecting-ip") || "unknown",
      });
      return redirect("/admin/users?ok=status");
    }

    if (action === "delete") {
      await userService.delete(id);
      await activityService.log({
        actorId: admin?.id,
        action: "user_deleted",
        targetType: "user",
        targetId: id,
        result: "success",
        ipAddress: request.headers.get("cf-connecting-ip") || "unknown",
      });
      return redirect("/admin/users?ok=deleted");
    }

    return redirect("/admin/users?err=unknown_action");
  } catch (error: any) {
    if (String(error?.message) === "HAS_LICENSES") {
      return redirect("/admin/users?err=has_licenses");
    }
    return redirect("/admin/users?err=action");
  }
}

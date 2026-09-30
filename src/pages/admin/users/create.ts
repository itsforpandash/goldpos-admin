import { UserService } from "@/lib/services/user";
import { ActivityService } from "@/lib/services/activity";

const redirect = (to: string) =>
  new Response(null, { status: 303, headers: { Location: to } });

export async function POST({ locals, request }) {
  const { DB } = locals.runtime.env;
  const admin = locals.SESSION;

  const form = await request.formData();
  const username = String(form.get("username") || "").trim();
  const fullName = String(form.get("full_name") || "").trim();
  const phone = String(form.get("phone") || "").trim();

  if (username.length < 3 || fullName.length < 2 || phone.length < 5) {
    return redirect("/admin/users?err=fields");
  }

  try {
    const userService = new UserService(DB);
    const activityService = new ActivityService(DB);
    const result = await userService.create({
      username,
      full_name: fullName,
      phone,
    });

    await activityService.log({
      actorId: admin?.id,
      action: "user_created",
      targetType: "user",
      targetId: result.userId,
      metadata: { username },
      result: "success",
      ipAddress: request.headers.get("cf-connecting-ip") || "unknown",
    });

    return redirect("/admin/users?ok=created");
  } catch (error: any) {
    if (String(error?.message).includes("UNIQUE")) {
      return redirect("/admin/users?err=duplicate");
    }
    return redirect("/admin/users?err=create");
  }
}

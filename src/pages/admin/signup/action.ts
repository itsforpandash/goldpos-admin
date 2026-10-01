import type { APIContext } from "astro";
import { SignupError, SignupService } from "@/lib/services/signup";
import { ActivityService } from "@/lib/services/activity";
import { getClientIp } from "@/lib/session-helpers";

const redirect = (to: string) =>
  new Response(null, { status: 303, headers: { Location: to } });

/** Carry a Persian detail message through the redirect without a raw query dump. */
const errUrl = (key: string, detail?: string) => {
  const url = new URL("/admin/signup", "https://placeholder.invalid");
  url.searchParams.set("err", key);
  if (detail) url.searchParams.set("msg", detail);
  return `/admin/signup?${url.searchParams.toString()}`;
};

export async function POST({ locals, request }: APIContext) {
  const { DB } = locals.runtime.env;
  const admin = locals.SESSION;
  const ipAddress = getClientIp(request);

  if (!admin) {
    return redirect("/admin/login");
  }

  const form = await request.formData();
  const id = Number(form.get("id"));
  const action = String(form.get("action") || "");

  if (!id || !action) {
    return redirect("/admin/signup?err=fields");
  }

  const signupService = new SignupService(DB);
  const activityService = new ActivityService(DB);

  try {
    if (action === "approve") {
      const planIdRaw = String(form.get("plan_id") || "").trim();
      const userPhone = String(form.get("user_phone") || "").trim();

      const result = await signupService.approve({
        id,
        adminId: admin.id,
        planId: planIdRaw ? Number(planIdRaw) : null,
        userPhone: userPhone || null,
      });

      await activityService.log({
        actorId: admin.id,
        action: "signup_approved",
        targetType: "signup_request",
        targetId: id,
        metadata: {
          code: result.code,
          licenseId: result.licenseId,
          userId: result.userId,
          userCreated: result.userCreated,
          plan: result.planName,
          days: result.days,
        },
        ipAddress,
        result: "success",
      });

      const url = new URL("/admin/signup", "https://placeholder.invalid");
      url.searchParams.set("ok", "approved");
      url.searchParams.set("code", result.code);
      url.searchParams.set("plan", result.planName);
      url.searchParams.set("user", result.userFullName);
      url.searchParams.set("created", result.userCreated ? "1" : "0");
      return redirect(`/admin/signup?${url.searchParams.toString()}`);
    }

    if (action === "reject") {
      const requestBefore = await signupService.getById(id);
      await signupService.reject(id, admin.id);

      await activityService.log({
        actorId: admin.id,
        action: "signup_rejected",
        targetType: "signup_request",
        targetId: id,
        metadata: requestBefore ? { contact: requestBefore.contact } : undefined,
        ipAddress,
        result: "success",
      });

      return redirect("/admin/signup?ok=rejected");
    }

    return redirect("/admin/signup?err=unknown_action");
  } catch (err: any) {
    if (err instanceof SignupError) {
      await activityService.log({
        actorId: admin.id,
        action: "signup_review_failed",
        targetType: "signup_request",
        targetId: id,
        metadata: { reason: err.code },
        ipAddress,
        result: "fail",
      });
      return redirect(errUrl(err.code, err.message));
    }
    return redirect("/admin/signup?err=action");
  }
}

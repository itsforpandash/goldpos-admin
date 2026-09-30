import { validateApiTokenResponse } from "@/lib/api";
import { LicenseService } from "@/lib/services/license";
import { ActivityService } from "@/lib/services/activity";

export async function GET({ locals, params, request }) {
  const { API_TOKEN, DB } = locals.runtime.env;
  const invalid = await validateApiTokenResponse(request, API_TOKEN);
  if (invalid) return invalid;

  const licenseService = new LicenseService(DB);
  const license = await licenseService.getById(Number(params.id));
  if (!license) return Response.json({ message: "License not found" }, { status: 404 });

  const history = await licenseService.getActivationHistory(Number(params.id));
  return Response.json({ license, history });
}

export async function POST({ locals, params, request }) {
  const { API_TOKEN, DB } = locals.runtime.env;
  const invalid = await validateApiTokenResponse(request, API_TOKEN);
  if (invalid) return invalid;

  const licenseId = Number(params.id);
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || (await request.json().catch(() => ({})))?.action;
  const body = await request.json().catch(() => ({}));

  const licenseService = new LicenseService(DB);
  const activityService = new ActivityService(DB);

  try {
    switch (action) {
      case "revoke": {
        await licenseService.revoke(licenseId);
        await activityService.log({
          action: "license_revoked",
          targetType: "license",
          targetId: licenseId,
          result: "success",
        });
        return Response.json({ success: true });
      }
      case "extend": {
        const days = Number(body.days) || 30;
        const result = await licenseService.extend(licenseId, days);
        await activityService.log({
          action: "license_extended",
          targetType: "license",
          targetId: licenseId,
          metadata: { days },
          result: "success",
        });
        return Response.json(result);
      }
      default:
        return Response.json({ message: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error: any) {
    return Response.json({ message: error?.message || "Action failed", success: false }, { status: 500 });
  }
}

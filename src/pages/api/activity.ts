import { validateApiTokenResponse } from "@/lib/api";
import { ActivityService } from "@/lib/services/activity";

export async function GET({ locals, request }: any) {
  const { API_TOKEN, DB } = locals.runtime.env;
  const invalid = await validateApiTokenResponse(request, API_TOKEN);
  if (invalid) return invalid;

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const limit = 20;
  const activityService = new ActivityService(DB);

  const logs = await activityService.getLogs(undefined, undefined, page, limit);
  const total = await activityService.getTotalCount();

  return Response.json({ logs, total, page, limit });
}

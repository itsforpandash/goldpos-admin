import { validateApiTokenResponse } from "@/lib/api";
import { DashboardService } from "@/lib/services/dashboard";

export async function GET({ locals, request }: any) {
  const { API_TOKEN, DB } = locals.runtime.env;
  const invalid = await validateApiTokenResponse(request, API_TOKEN);
  if (invalid) return invalid;

  const dashboardService = new DashboardService(DB);
  const [kpis, charts, activity, alerts] = await Promise.all([
    dashboardService.getKpis(),
    dashboardService.getCharts(),
    dashboardService.getRecentActivity(),
    dashboardService.getAlerts(),
  ]);

  return Response.json({ kpis, charts, activity, alerts });
}

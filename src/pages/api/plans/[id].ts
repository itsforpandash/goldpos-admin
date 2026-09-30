import { validateApiTokenResponse } from "@/lib/api";
import { PlanService } from "@/lib/services/plan";

export async function GET({ locals, params, request }) {
  const { API_TOKEN, DB } = locals.runtime.env;
  const invalid = await validateApiTokenResponse(request, API_TOKEN);
  if (invalid) return invalid;

  const planService = new PlanService(DB);
  const plan = await planService.getById(Number(params.id));
  if (!plan) return Response.json({ message: "Plan not found" }, { status: 404 });
  return Response.json({ plan });
}

export async function PUT({ locals, params, request }) {
  const { API_TOKEN, DB } = locals.runtime.env;
  const invalid = await validateApiTokenResponse(request, API_TOKEN);
  if (invalid) return invalid;

  try {
    const body = await request.json();
    const planService = new PlanService(DB);
    await planService.update({ id: Number(params.id), ...body });
    return Response.json({ success: true });
  } catch (error: any) {
    return Response.json({ message: error?.message || "Failed to update plan", success: false }, { status: 500 });
  }
}

export async function DELETE({ locals, params, request }) {
  const { API_TOKEN, DB } = locals.runtime.env;
  const invalid = await validateApiTokenResponse(request, API_TOKEN);
  if (invalid) return invalid;

  try {
    const planService = new PlanService(DB);
    await planService.delete(Number(params.id));
    return Response.json({ success: true });
  } catch (error: any) {
    return Response.json({ message: error?.message || "Failed to delete plan", success: false }, { status: 500 });
  }
}

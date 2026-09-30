import { validateApiTokenResponse } from "@/lib/api";
import { PlanService } from "@/lib/services/plan";

export async function GET({ locals, request }) {
  const { API_TOKEN, DB } = locals.runtime.env;
  const invalid = await validateApiTokenResponse(request, API_TOKEN);
  if (invalid) return invalid;

  const url = new URL(request.url);
  const status = url.searchParams.get("status") || undefined;

  const planService = new PlanService(DB);
  const plans = await planService.getAll(status);
  return Response.json({ plans });
}

export async function POST({ locals, request }) {
  const { API_TOKEN, DB } = locals.runtime.env;
  const invalid = await validateApiTokenResponse(request, API_TOKEN);
  if (invalid) return invalid;

  try {
    const body = await request.json();
    const planService = new PlanService(DB);
    const result = await planService.create(body);
    return Response.json(result, { status: 201 });
  } catch (error: any) {
    const msg = error?.message || "Failed to create plan";
    const status = /UNIQUE constraint/i.test(msg) ? 409 : 500;
    return Response.json({ message: msg, success: false }, { status });
  }
}

import { validateApiTokenResponse } from "@/lib/api";
import { LicenseService } from "@/lib/services/license";
import { DeviceService } from "@/lib/services/device";

export async function GET({ locals, params, request }: any) {
  const { API_TOKEN, DB } = locals.runtime.env;
  const invalid = await validateApiTokenResponse(request, API_TOKEN);
  if (invalid) return invalid;

  const param = params.device_hash;
  const deviceService = new DeviceService(DB);
  const licenseService = new LicenseService(DB);

  const device = await deviceService.getByHash(param);
  if (!device) {
    // Fallback: the param may be a license code instead of a device hash
    const license = await licenseService.getByCode(param);
    if (license) {
      if (license.status === "revoked") {
        return Response.json({ valid: false, reason: "revoked", license }, { status: 403 });
      }
      if (license.status !== "active") {
        return Response.json({ valid: false, reason: "inactive", license }, { status: 403 });
      }
      if (new Date(license.expires_at).getTime() < Date.now()) {
        return Response.json({ valid: false, reason: "expired", license }, { status: 403 });
      }
      return Response.json({ valid: true, license, expires_at: license.expires_at });
    }
    return Response.json({ valid: false, message: "Device not found" }, { status: 404 });
  }

  const license = await licenseService.getById(device.license_id);
  if (!license || license.status !== "active") {
    return Response.json({ valid: false, reason: "license_invalid", device }, { status: 403 });
  }
  if (new Date(license.expires_at).getTime() < Date.now()) {
    return Response.json({ valid: false, reason: "expired", license }, { status: 403 });
  }

  return Response.json({
    valid: true,
    license,
    device,
    expires_at: license.expires_at,
  });
}

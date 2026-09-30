import { validateApiTokenResponse } from "@/lib/api";
import { LicenseService } from "@/lib/services/license";
import { DeviceService, generateDeviceHash } from "@/lib/services/device";
import { ActivityService } from "@/lib/services/activity";
import { mobileActivateLimiter } from "@/lib/security";

export async function POST({ locals, params, request }: any) {
  const { API_TOKEN, DB } = locals.runtime.env;
  const invalid = await validateApiTokenResponse(request, API_TOKEN);
  if (invalid) return invalid;

  const rawId = String(params.id || "");
  const licenseId = /^\d+$/.test(rawId) ? parseInt(rawId, 10) : NaN;
  const action = params.action;

  const licenseService = new LicenseService(DB);
  const deviceService = new DeviceService(DB);
  const activityService = new ActivityService(DB);

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const rateKey = `mobile_activate_${ip}`;
  if (!mobileActivateLimiter.allow(rateKey)) {
    return Response.json({ message: "Rate limit exceeded", success: false }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const deviceHash = body.deviceHash || body.device_hash;
  const deviceModel = body.deviceModel || body.model;
  const androidVersion = body.androidVersion || body.android_version;
  const appVersion = body.appVersion || body.app_version;

  if (action === "activate") {
    const license = Number.isFinite(licenseId)
      ? await licenseService.getById(licenseId)
      : await licenseService.getByCode(rawId);
    if (!license) {
      return Response.json({ success: false, message: "License not found" }, { status: 404 });
    }
    const licenseIdResolved = license.id;
    if (license.status === "revoked") {
      return Response.json({ success: false, message: "License has been revoked" }, { status: 400 });
    }
    if (new Date(license.expires_at).getTime() < Date.now()) {
      return Response.json({ success: false, message: "License has expired" }, { status: 400 });
    }
    // A fresh (unused) license becomes active on first device activation
    if (license.status === "unused") {
      await licenseService.activate(license.code);
      license.status = "active";
    }
    if (license.status !== "active") {
      return Response.json({ success: false, message: "License is not active" }, { status: 400 });
    }

    // Check max devices
    const activeDevices = await deviceService.getAll("active");
    const countForLicense = activeDevices.filter((d: any) => d.license_id === licenseIdResolved).length;
    if (countForLicense >= license.max_devices) {
      return Response.json({ success: false, message: "Maximum devices reached" }, { status: 400 });
    }

    // Create or get device by hash
    let device = deviceHash ? await deviceService.getByHash(deviceHash) : null;
    if (!device) {
      const result = await deviceService.create({
        deviceHash: deviceHash || generateDeviceHash(),
        licenseId: licenseIdResolved,
        userId: license.user_id,
        deviceModel,
        androidVersion,
        appVersion,
        ipAddress: ip,
      });
      device = await deviceService.getById(result.deviceId);
    } else {
      await deviceService.connect(device.device_hash, ip);
    }

    await activityService.log({
      action: "device_activated",
      targetType: "license",
      targetId: licenseIdResolved,
      metadata: { deviceId: device?.id, model: deviceModel, ip },
      result: "success",
      ipAddress: ip,
    });

    return Response.json({ success: true, device });
  }

  if (action === "validate") {
    if (!deviceHash) {
      return Response.json({ success: false, message: "deviceHash required" }, { status: 400 });
    }
    const device = await deviceService.getByHash(deviceHash);
    if (!device) {
      return Response.json({ valid: false, reason: "device_not_found" }, { status: 404 });
    }
    const license = await licenseService.getById(device.license_id);
    if (!license) {
      return Response.json({ valid: false, reason: "license_not_found" }, { status: 404 });
    }
    if (license.status === "revoked") {
      return Response.json({ valid: false, reason: "revoked", license });
    }
    if (license.status !== "active") {
      return Response.json({ valid: false, reason: "inactive", license });
    }
    if (new Date(license.expires_at).getTime() < Date.now()) {
      await licenseService.validate(license.code); // triggers auto-expire side effect
      return Response.json({ valid: false, reason: "expired", license });
    }
    return Response.json({ valid: true, license, expires_at: license.expires_at });
  }

  if (action === "deactivate") {
    if (deviceHash) {
      const device = await deviceService.getByHash(deviceHash);
      if (device) await deviceService.deactivate(device.id);
    }
    return Response.json({ success: true });
  }

  return Response.json({ success: false, message: `Unknown action: ${action}` }, { status: 400 });
}

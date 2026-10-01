import { LicenseService } from "@/lib/services/license";
import { DeviceService } from "@/lib/services/device";
import { GalleryService } from "@/lib/services/gallery";
import { createMobileAccessToken, verifyMobileAccessToken } from "@/lib/mobile-auth";
import { getEnvSecret } from "@/lib/session-helpers";

export async function POST({ locals, request }: any) {
  try {
    const env = locals?.runtime?.env || process.env;
    const DB = env?.DB;
    const secret = env?.SESSION_SECRET || "goldpos-mobile-secure-token-secret-2026";

    if (!DB) {
      return Response.json({ success: false, message: "Database binding unavailable" }, { status: 500 });
    }

    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    const body = await request.json().catch(() => ({}));

    const token = body.access_token || body.token;
    const deviceHash = body.device_hash || body.deviceHash;
    const licenseCode = body.license_code || body.licenseCode;
    const lastServerTime = body.last_server_time || body.lastServerTime;

    const licenseService = new LicenseService(DB);
    const deviceService = new DeviceService(DB);
    const galleryService = new GalleryService(DB);

    let targetDevice = null;
    let targetLicense = null;

    // 1. Try resolving via access_token
    if (token) {
      const verified = await verifyMobileAccessToken(token, secret);
      if (verified) {
        targetLicense = await licenseService.getById(verified.license_id);
        if (verified.device_hash) {
          targetDevice = await deviceService.getByHash(verified.device_hash);
        }
      }
    }

    // 2. Try resolving via device_hash
    if (!targetDevice && deviceHash) {
      targetDevice = await deviceService.getByHash(deviceHash);
      if (targetDevice && !targetLicense) {
        targetLicense = await licenseService.getById(targetDevice.license_id);
      }
    }

    // 3. Try resolving via license_code
    if (!targetLicense && licenseCode) {
      targetLicense = await licenseService.getByCode(licenseCode);
    }

    if (!targetLicense) {
      return Response.json(
        {
          valid: false,
          status: "not_found",
          reason: "license_not_found",
          message: "لایسنس یا دستگاه در سیستم یافت نشد",
        },
        { status: 404 },
      );
    }

    // Anti-tampering check: verify that device isn't claiming an impossible backward clock
    const now = Date.now();
    if (lastServerTime && typeof lastServerTime === "number") {
      if (lastServerTime > now + 300_000) {
        console.warn(`[Anti-Tampering] Potential clock rollback detected. Server=${now}, DeviceReported=${lastServerTime}`);
      }
    }

    // Check license status
    if (targetLicense.status === "revoked") {
      return Response.json(
        {
          valid: false,
          status: "revoked",
          reason: "revoked",
          message: "اشتراک شما توسط مدیر لغو گردیده است. جهت اطلاعات بیشتر با پشتیبانی تماس بگیرید.",
          license: { code: targetLicense.code, status: "revoked" },
        },
        { status: 403 },
      );
    }

    const expiresTime = new Date(targetLicense.expires_at).getTime();
    if (expiresTime < now || targetLicense.status === "expired") {
      await licenseService.validate(targetLicense.code);
      return Response.json(
        {
          valid: false,
          status: "expired",
          reason: "expired",
          message: "اشتراک شما منقضی شده است. لطفاً نسبت به تمدید لایسنس اقدام فرمایید.",
          license: {
            code: targetLicense.code,
            status: "expired",
            expires_at: targetLicense.expires_at,
          },
        },
        { status: 401 },
      );
    }

    if (targetLicense.status !== "active") {
      return Response.json(
        {
          valid: false,
          status: "inactive",
          reason: "inactive",
          message: "اشتراک شما هنوز فعال نشده است.",
        },
        { status: 403 },
      );
    }

    // Update device activity
    if (targetDevice) {
      await deviceService.connect(targetDevice.device_hash, ip);
    }

    // Retrieve gallery info for First-time Gallery Setup check
    const galleryInfo =
      (await galleryService.getByLicenseId(targetLicense.id)) ||
      (targetDevice ? await galleryService.getByDeviceHash(targetDevice.device_hash) : null) ||
      (await galleryService.getByUserId(targetLicense.user_id));

    const requires_gallery_setup = !galleryInfo || !galleryInfo.gallery_name || galleryInfo.gallery_name.trim() === "";

    // Generate refreshed mobile access token
    const newAccessToken = await createMobileAccessToken(
      {
        license_id: targetLicense.id,
        license_code: targetLicense.code,
        device_hash: targetDevice?.device_hash || deviceHash || "",
        user_id: targetLicense.user_id,
        expires_at: Math.floor(expiresTime / 1000),
        issued_at: Math.floor(now / 1000),
      },
      secret,
    );

    const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
    const gracePeriodUntil = new Date(Math.min(expiresTime, now + GRACE_PERIOD_MS));

    return Response.json(
      {
        valid: true,
        status: "active",
        access_token: newAccessToken,
        server_time: new Date(now).toISOString(),
        server_timestamp: now,
        last_server_time: now,
        grace_period_days: 7,
        grace_period_until: gracePeriodUntil.toISOString(),
        license: {
          id: targetLicense.id,
          code: targetLicense.code,
          plan_name: targetLicense.plan_name || "طلایی",
          status: targetLicense.status,
          expires_at: targetLicense.expires_at,
          max_devices: targetLicense.max_devices,
        },
        device: targetDevice
          ? {
              id: targetDevice.id,
              device_hash: targetDevice.device_hash,
              device_model: targetDevice.device_model,
              status: targetDevice.status,
            }
          : null,
        gallery_info: galleryInfo || null,
        requires_gallery_setup,
        message: "اشتراک فعال و معتبر است",
      },
      { status: 200 },
    );
  } catch (err: any) {
    return Response.json(
      { success: false, error: err?.message || String(err), stack: err?.stack },
      { status: 500 },
    );
  }
}

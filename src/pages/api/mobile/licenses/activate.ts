import { LicenseService } from "@/lib/services/license";
import { DeviceService, generateDeviceHash } from "@/lib/services/device";
import { GalleryService } from "@/lib/services/gallery";
import { ActivityService } from "@/lib/services/activity";
import { mobileActivateLimiter } from "@/lib/security";
import { createMobileAccessToken } from "@/lib/mobile-auth";
import { getEnvSecret } from "@/lib/session-helpers";

export async function POST({ locals, request }: any) {
  const env = locals?.runtime?.env || process.env;
  const DB = env?.DB;
  const secret = env?.SESSION_SECRET || env?.JWT_SECRET || "goldpos-mobile-secure-token-secret-2026";

  if (!DB) {
    return Response.json({ success: false, message: "Database binding unavailable" }, { status: 500 });
  }

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const rateKey = `mobile_activate_${ip}`;
  if (!mobileActivateLimiter.allow(rateKey)) {
    return Response.json(
      { success: false, message: "تعداد درخواست‌های بیش از حد مجاز. لطفاً دقایقی دیگر تلاش کنید." },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => ({}));
  let licenseCode = String(body.license_code || body.code || "").trim();
  const deviceHash = String(body.device_hash || body.deviceHash || "").trim();
  const deviceModel = body.device_model || body.model || "Unknown Android Device";
  const androidVersion = body.android_version || body.androidVersion;
  const appVersion = body.app_version || body.appVersion;

  // Gallery info provided on activation
  const galleryName = body.gallery_name || body.galleryName;
  const ownerName = body.owner_name || body.ownerName;
  const phone = body.phone || body.phoneNumber;
  const address = body.address;

  if (!licenseCode) {
    return Response.json({ success: false, message: "کد اشتراک الزامی است" }, { status: 400 });
  }

  // Normalize code: uppercase, trim
  licenseCode = licenseCode.toUpperCase();

  const licenseService = new LicenseService(DB);
  const deviceService = new DeviceService(DB);
  const galleryService = new GalleryService(DB);
  const activityService = new ActivityService(DB);

  let license = await licenseService.getByCode(licenseCode);
  if (!license) {
    return Response.json(
      { success: false, message: "کد لایسنس وارد شده معتبر نمی‌باشد" },
      { status: 404 },
    );
  }

  if (license.status === "revoked") {
    return Response.json(
      { success: false, message: "این لایسنس توسط مدیریت لغو شده است" },
      { status: 403 },
    );
  }

  const now = Date.now();
  const expiresTime = new Date(license.expires_at).getTime();
  if (expiresTime < now) {
    return Response.json(
      { success: false, message: "تاریخ اعتبار این لایسنس به پایان رسیده است" },
      { status: 400 },
    );
  }

  // A fresh (unused) license becomes active on first device activation
  if (license.status === "unused") {
    await licenseService.activate(license.code, { deviceModel });
    license.status = "active";
  }

  if (license.status !== "active") {
    return Response.json(
      { success: false, message: "لایسنس در وضعیت فعال قرار ندارد" },
      { status: 400 },
    );
  }

  // Check max devices
  const activeDevices = await deviceService.getAll("active");
  const currentCount = activeDevices.filter((d: any) => d.license_id === license.id).length;

  let existingDevice = deviceHash ? await deviceService.getByHash(deviceHash) : null;
  if (!existingDevice && currentCount >= license.max_devices) {
    return Response.json(
      {
        success: false,
        message: `ظرفیت فعال‌سازی دستگاه‌های این لایسنس (${license.max_devices} دستگاه) تکمیل شده است.`,
      },
      { status: 400 },
    );
  }

  // Upsert device
  let device = existingDevice;
  const targetDeviceHash = deviceHash || generateDeviceHash();
  if (!device) {
    const result = await deviceService.create({
      deviceHash: targetDeviceHash,
      licenseId: license.id,
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

  // Save gallery info if submitted
  if (galleryName) {
    await galleryService.upsert({
      userId: license.user_id,
      licenseId: license.id,
      deviceHash: targetDeviceHash,
      galleryName,
      ownerName,
      phone,
      address,
    });
  }

  // Check gallery setup status
  const currentGallery =
    (await galleryService.getByLicenseId(license.id)) ||
    (await galleryService.getByDeviceHash(targetDeviceHash)) ||
    (await galleryService.getByUserId(license.user_id));

  const requires_gallery_setup = !currentGallery || !currentGallery.gallery_name || currentGallery.gallery_name.trim() === "";

  await activityService.log({
    action: "device_activated",
    targetType: "license",
    targetId: license.id,
    metadata: { deviceId: device?.id, model: deviceModel, ip, licenseCode },
    result: "success",
    ipAddress: ip,
  });

  // Create signed access token
  const accessToken = await createMobileAccessToken(
    {
      license_id: license.id,
      license_code: license.code,
      device_hash: targetDeviceHash,
      user_id: license.user_id,
      expires_at: Math.floor(expiresTime / 1000),
      issued_at: Math.floor(now / 1000),
    },
    secret,
  );

  const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
  const gracePeriodUntil = new Date(Math.min(expiresTime, now + GRACE_PERIOD_MS));

  return Response.json(
    {
      success: true,
      message: "لایسنس با موفقیت فعال شد",
      access_token: accessToken,
      server_time: new Date(now).toISOString(),
      server_timestamp: now,
      last_server_time: now,
      grace_period_days: 7,
      grace_period_until: gracePeriodUntil.toISOString(),
      license: {
        id: license.id,
        code: license.code,
        plan_name: license.plan_name || "طلایی",
        status: license.status,
        expires_at: license.expires_at,
        max_devices: license.max_devices,
      },
      device: device
        ? {
            id: device.id,
            device_hash: device.device_hash,
            device_model: device.device_model,
            status: device.status,
          }
        : null,
      gallery_info: currentGallery || null,
      requires_gallery_setup,
    },
    { status: 200 },
  );
}

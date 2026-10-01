import { GalleryService } from "@/lib/services/gallery";
import { LicenseService } from "@/lib/services/license";
import { DeviceService } from "@/lib/services/device";
import { verifyMobileAccessToken } from "@/lib/mobile-auth";
import { getEnvSecret } from "@/lib/session-helpers";

export async function POST({ locals, request }: any) {
  const env = locals?.runtime?.env || process.env;
  const DB = env?.DB;
  const secret = env?.SESSION_SECRET || env?.JWT_SECRET || "goldpos-mobile-secure-token-secret-2026";

  if (!DB) {
    return Response.json({ success: false, message: "Database unavailable" }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const token = body.access_token || body.token;
  const deviceHash = body.device_hash || body.deviceHash;
  const licenseCode = body.license_code || body.licenseCode;

  const galleryName = String(body.gallery_name || "").trim();
  const ownerName = String(body.owner_name || "").trim();
  const phone = String(body.phone || "").trim();
  const address = String(body.address || "").trim();

  if (!galleryName) {
    return Response.json({ success: false, message: "نام گالری طلا و جواهر الزامی است" }, { status: 400 });
  }

  const licenseService = new LicenseService(DB);
  const deviceService = new DeviceService(DB);
  const galleryService = new GalleryService(DB);

  let userId: number | null = null;
  let licenseId: number | null = null;
  let resolvedDeviceHash: string | null = deviceHash || null;

  if (token) {
    const verified = await verifyMobileAccessToken(token, secret);
    if (verified) {
      userId = verified.user_id;
      licenseId = verified.license_id;
      if (!resolvedDeviceHash) resolvedDeviceHash = verified.device_hash;
    }
  }

  if (!userId && licenseCode) {
    const lic = await licenseService.getByCode(licenseCode);
    if (lic) {
      userId = lic.user_id;
      licenseId = lic.id;
    }
  }

  if (!userId && resolvedDeviceHash) {
    const dev = await deviceService.getByHash(resolvedDeviceHash);
    if (dev) {
      userId = dev.user_id;
      licenseId = dev.license_id;
    }
  }

  if (!userId) {
    return Response.json(
      { success: false, message: "احراز هویت دستگاه یا لایسنس امکان‌پذیر نبود" },
      { status: 401 },
    );
  }

  const result = await galleryService.upsert({
    userId,
    licenseId,
    deviceHash: resolvedDeviceHash,
    galleryName,
    ownerName,
    phone,
    address,
  });

  const updatedGallery = await galleryService.getByUserId(userId);

  return Response.json({
    success: true,
    message: "اطلاعات گالری با موفقیت ثبت شد",
    gallery_info: updatedGallery,
    requires_gallery_setup: false,
    server_time: new Date().toISOString(),
    server_timestamp: Date.now(),
  });
}

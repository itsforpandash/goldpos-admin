export interface GalleryInfo {
  id?: number;
  user_id: number;
  license_id?: number | null;
  device_hash?: string | null;
  gallery_name: string;
  owner_name?: string | null;
  phone?: string | null;
  address?: string | null;
  created_at?: string;
  updated_at?: string;
  user_name?: string;
  license_code?: string;
}

export class GalleryService {
  private DB: D1Database;

  constructor(DB: D1Database) {
    this.DB = DB;
  }

  async getAll() {
    const query = `
      SELECT 
        g.*,
        u.full_name as user_name,
        u.phone as user_phone,
        l.code as license_code,
        l.status as license_status
      FROM gallery_info g
      LEFT JOIN users u ON g.user_id = u.id
      LEFT JOIN licenses l ON g.license_id = l.id
      ORDER BY g.updated_at DESC
    `;
    const response = await this.DB.prepare(query).all<GalleryInfo>();
    return response.success ? response.results : [];
  }

  async getByLicenseId(licenseId: number) {
    const query = `
      SELECT g.*, u.full_name as user_name, l.code as license_code
      FROM gallery_info g
      LEFT JOIN users u ON g.user_id = u.id
      LEFT JOIN licenses l ON g.license_id = l.id
      WHERE g.license_id = ?
      LIMIT 1
    `;
    return await this.DB.prepare(query).bind(licenseId).first<GalleryInfo>();
  }

  async getByUserId(userId: number) {
    const query = `
      SELECT g.*, u.full_name as user_name, l.code as license_code
      FROM gallery_info g
      LEFT JOIN users u ON g.user_id = u.id
      LEFT JOIN licenses l ON g.license_id = l.id
      WHERE g.user_id = ?
      ORDER BY g.updated_at DESC
      LIMIT 1
    `;
    return await this.DB.prepare(query).bind(userId).first<GalleryInfo>();
  }

  async getByDeviceHash(deviceHash: string) {
    const query = `
      SELECT g.*, u.full_name as user_name, l.code as license_code
      FROM gallery_info g
      LEFT JOIN users u ON g.user_id = u.id
      LEFT JOIN licenses l ON g.license_id = l.id
      WHERE g.device_hash = ?
      LIMIT 1
    `;
    return await this.DB.prepare(query).bind(deviceHash).first<GalleryInfo>();
  }

  async upsert(data: {
    userId: number;
    licenseId?: number | null;
    deviceHash?: string | null;
    galleryName: string;
    ownerName?: string | null;
    phone?: string | null;
    address?: string | null;
  }) {
    if (!data.galleryName || !data.userId) {
      throw new Error("galleryName and userId are required");
    }

    // Check if record exists for this license or user
    let existing = null;
    if (data.licenseId) {
      existing = await this.getByLicenseId(data.licenseId);
    }
    if (!existing && data.deviceHash) {
      existing = await this.getByDeviceHash(data.deviceHash);
    }
    if (!existing) {
      existing = await this.getByUserId(data.userId);
    }

    if (existing && existing.id) {
      const updateQuery = `
        UPDATE gallery_info 
        SET gallery_name = ?, owner_name = ?, phone = ?, address = ?, license_id = COALESCE(?, license_id), device_hash = COALESCE(?, device_hash), updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `;
      const res = await this.DB.prepare(updateQuery)
        .bind(
          data.galleryName,
          data.ownerName || null,
          data.phone || null,
          data.address || null,
          data.licenseId || null,
          data.deviceHash || null,
          existing.id,
        )
        .run();
      return { success: res.success, id: existing.id, updated: true };
    }

    const insertQuery = `
      INSERT INTO gallery_info (user_id, license_id, device_hash, gallery_name, owner_name, phone, address)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const res = await this.DB.prepare(insertQuery)
      .bind(
        data.userId,
        data.licenseId || null,
        data.deviceHash || null,
        data.galleryName,
        data.ownerName || null,
        data.phone || null,
        data.address || null,
      )
      .run();

    return { success: res.success, id: res.meta.last_row_id, updated: false };
  }

  async delete(id: number) {
    const res = await this.DB.prepare(`DELETE FROM gallery_info WHERE id = ?`).bind(id).run();
    return { success: res.success };
  }
}

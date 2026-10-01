import { DEVICE_HASH_ALPHABET, DEVICE_HASH_LENGTH, randomString } from "@/lib/codec/secure-random";

export const DEVICE_QUERIES = {
  BASE_SELECT: `
    SELECT 
      devices.*,
      licenses.code as license_code,
      users.full_name as user_name,
      users.phone as user_phone,
      plans.name as plan_name
    FROM devices
    LEFT JOIN licenses ON devices.license_id = licenses.id
    LEFT JOIN users ON devices.user_id = users.id
    LEFT JOIN plans ON licenses.plan_id = plans.id
  `,
  INSERT_DEVICE: `INSERT INTO devices (device_hash, license_id, user_id, device_model, android_version, app_version, last_ip) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  UPDATE_DEVICE: `UPDATE devices SET status = ?, last_connected_at = CURRENT_TIMESTAMP, last_ip = ? WHERE id = ?`,
};

/**
 * Generate a fallback device hash: 32 chars from a 55-symbol alphabet.
 *
 * Used only when the mobile app omits `deviceHash` in the request; it must stay
 * a 32-char string because `devices.device_hash` is VARCHAR(64) and existing
 * rows are 32 chars (migrations/0004_create_devices.sql:6).
 *
 * 32 chars x log2(55) = ~186 bits of entropy.
 *
 * Security: drawn from crypto.getRandomValues with rejection sampling. The old
 * implementation used Math.random(), a non-cryptographic PRNG whose state is
 * recoverable from observed output — a device hash gates how many activations a
 * license can bind, so it must not be predictable. 55 does not divide 256, so
 * naive `% 55` would over-favor the first 36 symbols; rejection sampling keeps
 * every symbol exactly equiprobable (see ../codec/secure-random.ts).
 */
export function generateDeviceHash(): string {
  return randomString(DEVICE_HASH_ALPHABET, DEVICE_HASH_LENGTH);
}

const processDeviceResults = (rows: any[]) => {
  return rows.map((row) => ({ ...row }));
};

export class DeviceService {
  private DB: D1Database;

  constructor(DB: D1Database) {
    this.DB = DB;
  }

  async getById(id: number) {
    const query = `${DEVICE_QUERIES.BASE_SELECT} WHERE devices.id = ?`;
    const response = await this.DB.prepare(query).bind(id).all();
    if (response.success && response.results.length) {
      return processDeviceResults(response.results)[0];
    }
    return null;
  }

  async getByHash(deviceHash: string) {
    const query = `${DEVICE_QUERIES.BASE_SELECT} WHERE devices.device_hash = ?`;
    const response = await this.DB.prepare(query).bind(deviceHash).all();
    if (response.success && response.results.length) {
      return processDeviceResults(response.results)[0];
    }
    return null;
  }

  async getAll(status?: string, search?: string) {
    let query = `${DEVICE_QUERIES.BASE_SELECT}`;
    const binds: any[] = [];
    const filters: string[] = [];

    if (status) {
      filters.push(`devices.status = ?`);
      binds.push(status);
    }
    if (search) {
      filters.push(`(devices.device_hash LIKE ? OR users.full_name LIKE ? OR licenses.code LIKE ?)`);
      binds.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (filters.length) {
      query += ` WHERE ${filters.join(" AND ")}`;
    }
    query += ` ORDER BY devices.created_at DESC LIMIT 1000`;

    const response = await this.DB.prepare(query).bind(...binds).all();
    if (response.success) {
      return processDeviceResults(response.results);
    }
    return [];
  }

  async create(deviceData: {
    deviceHash: string;
    licenseId: number;
    userId: number;
    deviceModel?: string;
    androidVersion?: string;
    appVersion?: string;
    ipAddress?: string;
  }) {
    const { deviceHash, licenseId, userId, deviceModel, androidVersion, appVersion, ipAddress } = deviceData;

    const response = await this.DB.prepare(DEVICE_QUERIES.INSERT_DEVICE)
      .bind(deviceHash, licenseId, userId, deviceModel || null, androidVersion || null, appVersion || null, ipAddress || null)
      .run();

    if (!response.success) {
      throw new Error("Failed to create device");
    }

    // Create activation record
    const deviceId = response.meta.last_row_id;
    await this.DB.prepare(
      `INSERT INTO activations (license_id, device_id, ip_address) VALUES (?, ?, ?)`,
    )
      .bind(licenseId, deviceId, ipAddress || null)
      .run();

    // Update license's activated_at if not already set
    await this.DB.prepare(`UPDATE licenses SET activated_at = CURRENT_TIMESTAMP WHERE id = ? AND activated_at IS NULL`)
      .bind(licenseId)
      .run();

    return { success: true, deviceId };
  }

  async connect(deviceHash: string, ipAddress?: string) {
    const device = await this.getByHash(deviceHash);
    if (!device) {
      return { success: false, message: "Device not found" };
    }

    const response = await this.DB.prepare(DEVICE_QUERIES.UPDATE_DEVICE)
      .bind("active", ipAddress || null, device.id)
      .run();

    if (!response.success) {
      return { success: false, message: "Failed to update device connection" };
    }

    // Update activation's last connected time
    await this.DB.prepare(
      `UPDATE activations SET deactivated_at = NULL WHERE device_id = ?`,
    )
      .bind(device.id)
      .run();

    return { success: true, device };
  }

  async deactivate(deviceId: number) {
    const response = await this.DB.prepare(
      `UPDATE devices SET status = 'inactive' WHERE id = ?`,
    ).bind(deviceId).run();

    if (!response.success) {
      throw new Error("Failed to deactivate device");
    }

    // Close open activation
    await this.DB.prepare(
      `UPDATE activations SET deactivated_at = CURRENT_TIMESTAMP WHERE device_id = ? AND deactivated_at IS NULL`,
    )
      .bind(deviceId)
      .run();

    return { success: true };
  }

  async block(deviceId: number) {
    const response = await this.DB.prepare(
      `UPDATE devices SET status = 'blocked' WHERE id = ?`,
    ).bind(deviceId).run();

    if (!response.success) {
      throw new Error("Failed to block device");
    }

    // Deactivate if active
    await this.DB.prepare(
      `UPDATE activations SET deactivated_at = CURRENT_TIMESTAMP WHERE device_id = ? AND deactivated_at IS NULL`,
    )
      .bind(deviceId)
      .run();

    return { success: true };
  }

  async resetDevice(deviceId: number) {
    // Reset device info while keeping it active
    const response = await this.DB.prepare(
      `UPDATE devices SET device_model = NULL, android_version = NULL, app_version = NULL, last_connected_at = NULL WHERE id = ?`,
    ).bind(deviceId).run();

    if (!response.success) {
      throw new Error("Failed to reset device");
    }

    return { success: true };
  }

  async getStats() {
    const [total, active, blocked] = await Promise.all([
      this.DB.prepare(`SELECT COUNT(*) as count FROM devices`).first<{ count: number }>(),
      this.DB.prepare(`SELECT COUNT(*) as count FROM devices WHERE status = 'active'`).first<{ count: number }>(),
      this.DB.prepare(`SELECT COUNT(*) as count FROM devices WHERE status = 'blocked'`).first<{ count: number }>(),
    ]);

    return {
      total_devices: total?.count ?? 0,
      active_devices: active?.count ?? 0,
      blocked_devices: blocked?.count ?? 0,
    };
  }

  async getActivationsPerDay(days = 14) {
    const response = await this.DB.prepare(
      `SELECT date(first_activated_at) as day, COUNT(*) as count
       FROM devices
       WHERE date(first_activated_at) >= date('now', '-' || ? || ' days')
       GROUP BY day
       ORDER BY day ASC`,
    )
      .bind(days)
      .all<{ day: string; count: number }>();

    if (response.success) {
      const map = new Map(response.results.map((r) => [r.day, r.count]));
      const result: { day: string; count: number }[] = [];
      const now = new Date();
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 86400000);
        const key = d.toISOString().slice(0, 10);
        result.push({ day: key, count: map.get(key) ?? 0 });
      }
      return result;
    }
    return [];
  }

  async getRecentActivity(limit = 20) {
    const response = await this.DB.prepare(
      `SELECT d.*, u.full_name as user_name, l.code as license_code
       FROM devices d
       LEFT JOIN users u ON d.user_id = u.id
       LEFT JOIN licenses l ON d.license_id = l.id
       WHERE d.last_connected_at IS NOT NULL
       ORDER BY d.last_connected_at DESC
       LIMIT ?`,
    )
      .bind(limit)
      .all();
    if (response.success) {
      return response.results;
    }
    return [];
  }
}

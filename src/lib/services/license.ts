import { CROCKFORD_BASE32_ALPHABET, LICENSE_CODE_PAYLOAD_LENGTH, groupCode, randomString } from "@/lib/codec/secure-random";

export const LICENSE_QUERIES = {
  BASE_SELECT: `
    SELECT 
      licenses.*,
      users.full_name as user_name,
      users.username as user_username,
      users.phone as user_phone,
      plans.name as plan_name,
      COUNT(DISTINCT devices.id) as active_device_count
    FROM licenses
    LEFT JOIN users ON licenses.user_id = users.id
    LEFT JOIN plans ON licenses.plan_id = plans.id
    LEFT JOIN devices ON licenses.id = devices.license_id AND devices.status = 'active'
  `,
  GENERATE_CODE_PREFIX: "GPOS-",
};

const processLicenseResults = (rows: any[]) => {
  return rows.map((row) => ({ ...row }));
};

/**
 * Device/fallback alphabet for generated license bodies: Crockford Base32.
 * See ../codec/secure-random.ts for the alphabet and its justification.
 */
const CODE_ALPHABET = CROCKFORD_BASE32_ALPHABET;

/**
 * Generate one license code in the NEW format:
 *   GPOS-XXXX-XXXX-XXXX-XXXX   (prefix + 16 Crockford chars in 4 groups)
 *
 * Entropy: 16 chars x 5 bits = 80 bits (the "GPOS-" prefix and the "-"
 * separators are display formatting only and contribute no entropy).
 *
 * Drawn from crypto.getRandomValues with rejection sampling — Math.random()
 * is a non-cryptographic PRNG whose state is predictable from observed output,
 * which would let an attacker forecast future license codes.
 *
 * NOTE: this returns a CODE IN THE NEW FORMAT ONLY. Legacy licenses already in
 * the database use the old 7-char body ("GPOS-ABC-DE7") and are untouched —
 * lookup by code is a plain equality match and never reformats or rejects them.
 */
function generateLicenseCode(): string {
  const payload = randomString(CODE_ALPHABET, LICENSE_CODE_PAYLOAD_LENGTH);
  return `${LICENSE_QUERIES.GENERATE_CODE_PREFIX}${groupCode(payload)}`;
}

/**
 * Generate `count` license codes.
 *
 * Uniqueness is enforced within this batch via a Set. The optional
 * `isTaken(code)` predicate additionally screens against codes that already
 * exist elsewhere (e.g. rows already in the database) and redraws on a hit.
 * The predicate MUST be synchronous — the exported signature is sync and is
 * relied on by callers that must keep working; callers screen against the DB by
 * pre-loading the existing codes into a Set:
 *
 *   const taken = new Set(existingCodes);
 *   generateUniqueLicenseCodes(50, (c) => taken.has(c));
 *
 * With 80 bits of entropy a collision with a stored code is effectively
 * impossible, but the hook lets a caller detect and report one instead of
 * letting the INSERT fail silently.
 *
 * Backward compatible: `generateUniqueLicenseCodes(count)` keeps working.
 */
export function generateUniqueLicenseCodes(count: number, isTaken?: (code: string) => boolean): string[] {
  const codes: string[] = [];
  const used = new Set<string>();
  for (let i = 0; i < count; i++) {
    let code = generateLicenseCode();
    // Redraw on an in-batch collision or, if provided, a hit from the
    // external source. The retry budget is generous so a pathological
    // `isTaken` (e.g. one that always returns true) fails loudly rather than
    // spinning forever.
    let attempts = 0;
    while (used.has(code) || (isTaken?.(code) ?? false)) {
      if (++attempts > 1000) {
        throw new Error(
          `generateUniqueLicenseCodes: could not generate a unique code for item ${i + 1}/${count} after ${attempts} attempts`,
        );
      }
      code = generateLicenseCode();
    }
    used.add(code);
    codes.push(code);
  }
  return codes;
}

export class LicenseService {
  private DB: D1Database;

  constructor(DB: D1Database) {
    this.DB = DB;
  }

  async getByCode(code: string) {
    const query = `${LICENSE_QUERIES.BASE_SELECT} WHERE licenses.code = ? GROUP BY licenses.id`;
    const response = await this.DB.prepare(query).bind(code).all();
    if (response.success && response.results.length) {
      const [license] = processLicenseResults(response.results);
      return license;
    }
    return null;
  }

  async getById(id: number) {
    const query = `${LICENSE_QUERIES.BASE_SELECT} WHERE licenses.id = ? GROUP BY licenses.id`;
    const response = await this.DB.prepare(query).bind(id).all();
    if (response.success && response.results.length) {
      const [license] = processLicenseResults(response.results);
      return license;
    }
    return null;
  }

  async getAll(status?: string, search?: string) {
    let query = LICENSE_QUERIES.BASE_SELECT;
    const binds: any[] = [];
    const filters: string[] = [];

    if (status) {
      filters.push(`licenses.status = ?`);
      binds.push(status);
    }
    if (search) {
      filters.push(`(licenses.code LIKE ? OR users.full_name LIKE ? OR users.phone LIKE ?)`);
      binds.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (filters.length) {
      query += ` WHERE ${filters.join(" AND ")}`;
    }
    query += ` GROUP BY licenses.id ORDER BY licenses.created_at DESC LIMIT 1000`;

    const response = await this.DB.prepare(query).bind(...binds).all();
    if (response.success) {
      return processLicenseResults(response.results);
    }
    return [];
  }

  async generateForUser(user: {
    userId: number;
    planId: number;
    maxDevices?: number;
    expiresAt: string;
  }, quantity: number) {
    const codes = generateUniqueLicenseCodes(quantity);
    let createdCount = 0;
    const error: string[] = [];

    for (const code of codes) {
      try {
        const result = await this.DB.prepare(
          `INSERT INTO licenses (code, user_id, plan_id, status, max_devices, expires_at) VALUES (?, ?, ?, 'unused', ?, ?)`,
        )
          .bind(code, user.userId, user.planId, user.maxDevices ?? 1, user.expiresAt)
          .run();

        if (result.success) {
          await this.DB.prepare(
            `INSERT INTO license_events (license_id, event_type, details) VALUES (?, 'created', ?)`,
          )
            .bind(result.meta.last_row_id, `License ${code} generated`)
            .run();
          createdCount++;
        } else {
          error.push(code);
        }
      } catch {
        // keep going
      }
    }

    return { success: createdCount > 0, codes: codes.slice(0, createdCount), failed: error };
  }

  async activate(code: string, deviceInfo?: { deviceHash?: string; deviceModel?: string }) {
    const license = await this.getByCode(code);
    if (!license) {
      return { success: false, message: "License not found" };
    }
    if (license.status === "revoked") {
      return { success: false, message: "License has been revoked" };
    }
    if (new Date(license.expires_at).getTime() < Date.now()) {
      return { success: false, message: "License has expired" };
    }

    const response = await this.DB.prepare(
      `UPDATE licenses SET status = 'active', activated_at = COALESCE(activated_at, CURRENT_TIMESTAMP) WHERE id = ?`,
    )
      .bind(license.id)
      .run();

    if (!response.success) {
      return { success: false, message: "Failed to activate license" };
    }

    await this.DB.prepare(`INSERT INTO license_events (license_id, event_type, details) VALUES (?, 'activated', ?)`)
      .bind(license.id, `License activated${deviceInfo?.deviceModel ? ` on ${deviceInfo.deviceModel}` : ""}`)
      .run();

    return { success: true, message: "License activated", license };
  }

  async validate(code: string) {
    const license = await this.getByCode(code);
    if (!license) {
      return { valid: false, reason: "not_found" };
    }
    if (license.status === "revoked") {
      return { valid: false, reason: "revoked", license };
    }
    if (license.status !== "active") {
      return { valid: false, reason: "inactive", license };
    }
    const expires = new Date(license.expires_at).getTime();
    if (expires < Date.now()) {
      // auto-expire
      await this.DB.prepare(`UPDATE licenses SET status = 'expired' WHERE id = ? AND status = 'active'`).bind(license.id).run();
      await this.DB.prepare(`INSERT INTO license_events (license_id, event_type, details) VALUES (?, 'expired', ?)`)
        .bind(license.id, "License auto-expired on validation")
        .run();
      return { valid: false, reason: "expired", license };
    }
    return { valid: true, license };
  }

  async revoke(id: number, revokedBy?: number) {
    const response = await this.DB.prepare(
      `UPDATE licenses SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP, revoked_by = ? WHERE id = ? AND status != 'revoked'`,
    )
      .bind(revokedBy ?? null, id)
      .run();

    if (!response.success || response.meta.changes === 0) {
      throw new Error("Failed to revoke license");
    }

    await this.DB.prepare(`INSERT INTO license_events (license_id, event_type, details) VALUES (?, 'revoked', ?)`)
      .bind(id, "License revoked by admin")
      .run();

    // Deactivate linked devices
    await this.DB.prepare(`UPDATE devices SET status = 'inactive' WHERE license_id = ? AND status = 'active'`).bind(id).run();

    return { success: true };
  }

  async extend(id: number, days: number) {
    const license = await this.getById(id);
    if (!license) {
      throw new Error("License not found");
    }

    const base =
      license.status === "active" && new Date(license.expires_at).getTime() > Date.now()
        ? new Date(license.expires_at).getTime()
        : Date.now();

    const newExpiry = new Date(base + days * 24 * 60 * 60 * 1000).toISOString();

    const response = await this.DB.prepare(
      `UPDATE licenses SET expires_at = ?, status = CASE WHEN status IN ('active', 'expired') THEN 'active' ELSE status END WHERE id = ?`,
    )
      .bind(newExpiry, id)
      .run();

    if (!response.success) {
      throw new Error("Failed to extend license");
    }

    await this.DB.prepare(`INSERT INTO license_events (license_id, event_type, details) VALUES (?, 'extended', ?)`)
      .bind(id, `License extended by ${days} days`)
      .run();

    return { success: true, newExpiresAt: newExpiry };
  }

  async getStats() {
    const [active, expired, unused, revoked] = await Promise.all([
      this.DB.prepare(`SELECT COUNT(*) as count FROM licenses WHERE status = 'active'`).first<{ count: number }>(),
      this.DB.prepare(`SELECT COUNT(*) as count FROM licenses WHERE status = 'expired'`).first<{ count: number }>(),
      this.DB.prepare(`SELECT COUNT(*) as count FROM licenses WHERE status = 'unused'`).first<{ count: number }>(),
      this.DB.prepare(`SELECT COUNT(*) as count FROM licenses WHERE status = 'revoked'`).first<{ count: number }>(),
    ]);
    return {
      active_licenses: active?.count ?? 0,
      expired_licenses: expired?.count ?? 0,
      unused_licenses: unused?.count ?? 0,
      revoked_licenses: revoked?.count ?? 0,
    };
  }

  async getExpiringSoon(days = 7) {
    const response = await this.DB.prepare(
      `SELECT COUNT(*) as count FROM licenses WHERE status = 'active' AND expires_at <= datetime('now', '+' || ? || ' days') AND expires_at > datetime('now')`,
    )
      .bind(days)
      .first<{ count: number }>();
    return response?.count ?? 0;
  }

  async getActivationsPerDay(days = 14) {
    const response = await this.DB.prepare(
      `SELECT date(activated_at) as day, COUNT(*) as count
       FROM licenses
       WHERE activated_at IS NOT NULL AND date(activated_at) >= date('now', '-' || ? || ' days')
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

  async getRecentEvents(limit = 10) {
    const response = await this.DB.prepare(
      `SELECT le.*, licenses.code
       FROM license_events le
       JOIN licenses ON le.license_id = licenses.id
       ORDER BY le.created_at DESC
       LIMIT ?`,
    )
      .bind(limit)
      .all();
    if (response.success) {
      return response.results;
    }
    return [];
  }

  async getActivationHistory(licenseId: number) {
    const response = await this.DB.prepare(
      `SELECT a.*, d.device_model, d.android_version, d.app_version, d.device_hash
       FROM activations a
       LEFT JOIN devices d ON a.device_id = d.id
       WHERE a.license_id = ?
       ORDER BY a.activated_at DESC`,
    )
      .bind(licenseId)
      .all();
    if (response.success) {
      return response.results;
    }
    return [];
  }
}

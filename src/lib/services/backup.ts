export interface BackupPayload {
  version: string;
  exported_at: string;
  tables: {
    users?: any[];
    plans?: any[];
    licenses?: any[];
    devices?: any[];
    activations?: any[];
    admin_users?: any[];
    settings?: any[];
    app_settings?: any[];
    gallery_info?: any[];
    license_events?: any[];
    signup_requests?: any[];
  };
  summary: {
    total_users: number;
    total_plans: number;
    total_licenses: number;
    total_devices: number;
    total_galleries: number;
  };
}

export class BackupService {
  private DB: D1Database;

  constructor(DB: D1Database) {
    this.DB = DB;
  }

  async exportAll(): Promise<BackupPayload> {
    const safeSelect = async (table: string) => {
      try {
        const res = await this.DB.prepare(`SELECT * FROM ${table}`).all();
        return res.success ? res.results : [];
      } catch {
        return [];
      }
    };

    const [
      users,
      plans,
      licenses,
      devices,
      activations,
      admin_users,
      settings,
      app_settings,
      gallery_info,
      license_events,
      signup_requests,
    ] = await Promise.all([
      safeSelect("users"),
      safeSelect("plans"),
      safeSelect("licenses"),
      safeSelect("devices"),
      safeSelect("activations"),
      safeSelect("admin_users"),
      safeSelect("settings"),
      safeSelect("app_settings"),
      safeSelect("gallery_info"),
      safeSelect("license_events"),
      safeSelect("signup_requests"),
    ]);

    return {
      version: "1.0",
      exported_at: new Date().toISOString(),
      tables: {
        users,
        plans,
        licenses,
        devices,
        activations,
        admin_users,
        settings,
        app_settings,
        gallery_info,
        license_events,
        signup_requests,
      },
      summary: {
        total_users: users.length,
        total_plans: plans.length,
        total_licenses: licenses.length,
        total_devices: devices.length,
        total_galleries: gallery_info.length,
      },
    };
  }

  async importData(
    backup: BackupPayload,
    mode: "merge" | "replace" = "merge",
  ): Promise<{ success: boolean; imported: Record<string, number>; errors: string[] }> {
    const errors: string[] = [];
    const imported: Record<string, number> = {};

    if (!backup || !backup.tables) {
      throw new Error("فایل پشتیبان نامعتبر است (فرمت غیراستاندارد)");
    }

    const { tables } = backup;

    // Helper to insert or replace row
    const upsertRows = async (tableName: string, rows?: any[]) => {
      if (!Array.isArray(rows) || rows.length === 0) {
        imported[tableName] = 0;
        return;
      }

      let count = 0;
      for (const row of rows) {
        try {
          const keys = Object.keys(row);
          if (keys.length === 0) continue;

          const placeholders = keys.map(() => "?").join(", ");
          const columns = keys.map((k) => `"${k}"`).join(", ");
          const values = keys.map((k) => row[k]);

          // Use INSERT OR REPLACE
          const sql = `INSERT OR REPLACE INTO ${tableName} (${columns}) VALUES (${placeholders})`;
          const res = await this.DB.prepare(sql).bind(...values).run();
          if (res.success) {
            count++;
          }
        } catch (e: any) {
          errors.push(`خطا در جدول ${tableName}: ${e?.message || e}`);
        }
      }
      imported[tableName] = count;
    };

    if (mode === "replace") {
      // Clear tables in reverse dependency order
      const clearOrder = [
        "gallery_info",
        "license_events",
        "activations",
        "devices",
        "licenses",
        "plans",
        "signup_requests",
        "users",
      ];
      for (const tbl of clearOrder) {
        try {
          await this.DB.prepare(`DELETE FROM ${tbl}`).run();
        } catch {
          // ignore if table doesn't exist
        }
      }
    }

    // Import order respecting foreign keys:
    // 1. users, admin_users, settings, app_settings
    // 2. plans
    // 3. licenses
    // 4. devices
    // 5. activations, license_events, gallery_info, signup_requests
    await upsertRows("users", tables.users);
    await upsertRows("admin_users", tables.admin_users);
    await upsertRows("settings", tables.settings);
    await upsertRows("app_settings", tables.app_settings);
    await upsertRows("plans", tables.plans);
    await upsertRows("licenses", tables.licenses);
    await upsertRows("devices", tables.devices);
    await upsertRows("activations", tables.activations);
    await upsertRows("license_events", tables.license_events);
    await upsertRows("gallery_info", tables.gallery_info);
    await upsertRows("signup_requests", tables.signup_requests);

    return {
      success: errors.length === 0,
      imported,
      errors,
    };
  }
}

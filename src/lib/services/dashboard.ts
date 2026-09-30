import { UserService } from "./user";
import { LicenseService } from "./license";
import { DeviceService } from "./device";

export class DashboardService {
  private DB: D1Database;
  private users: UserService;
  private licenses: LicenseService;
  private devices: DeviceService;

  constructor(DB: D1Database) {
    this.DB = DB;
    this.users = new UserService(DB);
    this.licenses = new LicenseService(DB);
    this.devices = new DeviceService(DB);
  }

  async getKpis() {
    const [userStats, licenseStats, expiringSoon, deviceStats, todayActivations, todayUsers] = await Promise.all([
      this.users.getStats(),
      this.licenses.getStats(),
      this.licenses.getExpiringSoon(7),
      this.devices.getStats(),
      this.DB.prepare(
        `SELECT COUNT(*) as count FROM licenses WHERE date(activated_at) = date('now')`,
      ).first<{ count: number }>(),
      this.DB.prepare(
        `SELECT COUNT(*) as count FROM users WHERE date(created_at) = date('now')`,
      ).first<{ count: number }>(),
    ]);

    return {
      ...userStats,
      ...licenseStats,
      ...deviceStats,
      expiring_soon: expiringSoon,
      activations_today: todayActivations?.count ?? 0,
      users_today: todayUsers?.count ?? 0,
    };
  }

  async getCharts() {
    const [activations, planDistribution, newUsers] = await Promise.all([
      this.licenses.getActivationsPerDay(14),
      this.DB.prepare(
        `SELECT plans.name, COUNT(licenses.id) as count
         FROM plans
         LEFT JOIN licenses ON plans.id = licenses.plan_id AND licenses.status IN ('active', 'expired')
         GROUP BY plans.id
         ORDER BY count DESC`,
      ).all<{ name: string; count: number }>(),
      this.users.getNewUsersPerMonth(6),
    ]);

    return {
      activations,
      plan_distribution: planDistribution.success ? planDistribution.results : [],
      new_users: newUsers,
    };
  }

  async getRecentActivity() {
    const [licenseEvents, recentDevices] = await Promise.all([
      this.licenses.getRecentEvents(8),
      this.devices.getRecentActivity(8),
    ]);

    return { license_events: licenseEvents, devices: recentDevices };
  }

  async getAlerts() {
    const [expiring, revokedToday, devicesToday] = await Promise.all([
      this.licenses.getExpiringSoon(7),
      this.DB.prepare(
        `SELECT COUNT(*) as count FROM licenses WHERE status = 'revoked' AND date(revoked_at) >= date('now', '-1 day')`,
      ).first<{ count: number }>(),
      this.DB.prepare(
        `SELECT COUNT(*) as count FROM devices WHERE date(first_activated_at) = date('now')`,
      ).first<{ count: number }>(),
    ]);

    const alerts: { type: "warning" | "danger" | "success"; message: string }[] = [];
    if (expiring > 0) {
      alerts.push({ type: "warning", message: `${expiring} لایسنس طی ۷ روز آینده منقضی می‌شود` });
    }
    if ((revokedToday?.count ?? 0) > 0) {
      alerts.push({ type: "danger", message: `${revokedToday!.count} لایسنس در ۲۴ ساعت گذشته لغو شده` });
    }
    if ((devicesToday?.count ?? 0) > 0) {
      alerts.push({ type: "success", message: `${devicesToday!.count} دستگاه امروز فعال شده` });
    }

    return alerts;
  }
}

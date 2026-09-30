export const USER_QUERIES = {
  BASE_SELECT: `
    SELECT 
      users.*,
      COUNT(DISTINCT licenses.id) as license_count,
      COUNT(DISTINCT CASE WHEN devices.status = 'active' THEN devices.id END) as active_device_count
    FROM users
    LEFT JOIN licenses ON users.id = licenses.user_id
    LEFT JOIN devices ON licenses.id = devices.license_id
  `,
  INSERT_USER: `INSERT INTO users (username, full_name, phone, email, password_hash, status, role, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  GET_BY_ID: `GROUP BY users.id HAVING users.id = ?`,
  GET_BY_PHONE: `GROUP BY users.id HAVING users.phone = ?`,
  UPDATE_STATUS: `UPDATE users SET status = ? WHERE id = ?`,
};

const processUserResults = (rows: any[]) => {
  return rows.map((row) => {
    const user = { ...row };
    delete user.password_hash;
    return user;
  });
};

export class UserService {
  private DB: D1Database;

  constructor(DB: D1Database) {
    this.DB = DB;
  }

  async getById(id: number) {
    const query = `${USER_QUERIES.BASE_SELECT} ${USER_QUERIES.GET_BY_ID}`;
    const response = await this.DB.prepare(query).bind(id).all();
    if (response.success) {
      const [user] = processUserResults(response.results);
      return user || null;
    }
    return null;
  }

  async getByPhone(phone: string) {
    const query = `${USER_QUERIES.BASE_SELECT} ${USER_QUERIES.GET_BY_PHONE}`;
    const response = await this.DB.prepare(query).bind(phone).all();
    if (response.success) {
      const [user] = processUserResults(response.results);
      return user || null;
    }
    return null;
  }

  async getAll(search?: string, status?: string) {
    let query = USER_QUERIES.BASE_SELECT;
    const binds: any[] = [];

    const filters: string[] = [];
    if (search) {
      filters.push(`(users.full_name LIKE ? OR users.phone LIKE ? OR users.username LIKE ?)`);
      binds.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (status) {
      filters.push(`users.status = ?`);
      binds.push(status);
    }
    if (filters.length) {
      query += ` WHERE ${filters.join(" AND ")}`;
    }
    query += ` GROUP BY users.id ORDER BY users.id DESC LIMIT 500`;

    const response = await this.DB.prepare(query).bind(...binds).all();
    if (response.success) {
      return processUserResults(response.results);
    }
    return [];
  }

  async create(userData: {
    username: string;
    full_name: string;
    phone: string;
    email?: string;
    password_hash?: string | null;
    role?: string;
    notes?: string;
  }) {
    if (!userData.username || !userData.full_name || !userData.phone) {
      throw new Error("username, full_name and phone are required");
    }
    const response = await this.DB.prepare(USER_QUERIES.INSERT_USER)
      .bind(
        userData.username,
        userData.full_name,
        userData.phone,
        userData.email || null,
        userData.password_hash || "",
        "active",
        userData.role || "customer",
        userData.notes || null,
      )
      .run();

    if (!response.success) {
      throw new Error("Failed to create user");
    }
    return { success: true, userId: response.meta.last_row_id };
  }

  async updateStatus(id: number, status: string) {
    const response = await this.DB.prepare(USER_QUERIES.UPDATE_STATUS).bind(status, id).run();
    if (!response.success) {
      throw new Error("Failed to update user status");
    }
    return { success: true };
  }

  async delete(id: number) {
    const licenses = await this.DB.prepare(
      `SELECT COUNT(*) as count FROM licenses WHERE user_id = ?`,
    ).bind(id).first<{ count: number }>();
    if ((licenses?.count ?? 0) > 0) {
      throw new Error("HAS_LICENSES");
    }
    const response = await this.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(id).run();
    if (!response.success) {
      throw new Error("Failed to delete user");
    }
    return { success: true };
  }

  // For dashboard counts
  async getStats() {
    const [total, active] = await Promise.all([
      this.DB.prepare(`SELECT COUNT(*) as count FROM users`).first<{ count: number }>(),
      this.DB.prepare(`SELECT COUNT(*) as count FROM users WHERE status = 'active'`).first<{ count: number }>(),
    ]);
    return {
      total_users: total?.count ?? 0,
      active_users: active?.count ?? 0,
    };
  }

  async getNewUsersPerMonth(months = 6) {
    const response = await this.DB.prepare(
      `SELECT 
         strftime('%Y-%m', created_at) as month,
         COUNT(*) as count
       FROM users
       WHERE created_at >= datetime('now', '-' || ? || ' months')
       GROUP BY month
       ORDER BY month ASC`,
    )
      .bind(months)
      .all<{ month: string; count: number }>();

    if (response.success) {
      const map = new Map(response.results.map((r) => [r.month, r.count]));
      const result: { month: string; count: number }[] = [];
      const now = new Date();
      for (let i = months - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = d.toISOString().slice(0, 7);
        result.push({ month: key, count: map.get(key) ?? 0 });
      }
      return result;
    }
    return [];
  }
}

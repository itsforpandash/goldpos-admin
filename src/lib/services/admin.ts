export const ADMIN_QUERIES = {
  SELECT_BY_USERNAME: `SELECT * FROM admin_users WHERE username = ?`,
  SELECT_BY_ID: `SELECT * FROM admin_users WHERE id = ?`,
  LIST: `SELECT * FROM admin_users ORDER BY id ASC LIMIT 200`,
  UPDATE_LOGIN: `UPDATE admin_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?`,
  UPDATE_ACTIVE: `UPDATE admin_users SET is_active = ? WHERE id = ?`,
  UPDATE_PASSWORD: `UPDATE admin_users SET password_hash = ? WHERE id = ?`,
};

export class AdminUserService {
  private DB: D1Database;

  constructor(DB: D1Database) {
    this.DB = DB;
  }

  async getByUsername(username: string) {
    const response = await this.DB.prepare(ADMIN_QUERIES.SELECT_BY_USERNAME)
      .bind(username)
      .first<{ id: number; username: string; full_name: string; password_hash: string; role: string; is_active: boolean }>();
    return response ?? null;
  }

  async getById(id: number) {
    const response = await this.DB.prepare(ADMIN_QUERIES.SELECT_BY_ID)
      .bind(id)
      .first();
    if (!response) return null;
    const { password_hash: _ph, ...admin } = response as any;
    return admin;
  }

  async getAll() {
    const response = await this.DB.prepare(ADMIN_QUERIES.LIST).all();
    if (response.success) {
      return response.results.map((row: any) => {
        const { password_hash: _ph, ...admin } = row;
        return admin;
      });
    }
    return [];
  }

  async touchLogin(id: number) {
    await this.DB.prepare(ADMIN_QUERIES.UPDATE_LOGIN).bind(id).run();
  }

  async setActive(id: number, isActive: boolean) {
    await this.DB.prepare(ADMIN_QUERIES.UPDATE_ACTIVE).bind(isActive ? 1 : 0, id).run();
  }

  async changePassword(id: number, newHash: string) {
    await this.DB.prepare(ADMIN_QUERIES.UPDATE_PASSWORD).bind(newHash, id).run();
  }
}

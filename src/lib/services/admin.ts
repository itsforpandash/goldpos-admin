export const ADMIN_QUERIES = {
  SELECT_BY_USERNAME: `SELECT * FROM admin_users WHERE username = ?`,
  SELECT_BY_ID: `SELECT * FROM admin_users WHERE id = ?`,
  LIST: `SELECT * FROM admin_users ORDER BY id ASC LIMIT 200`,
  UPDATE_LOGIN: `UPDATE admin_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?`,
  UPDATE_ACTIVE: `UPDATE admin_users SET is_active = ? WHERE id = ?`,
  UPDATE_PASSWORD: `UPDATE admin_users SET password_hash = ?, must_change_password = ? WHERE id = ?`,
};

export class AdminUserService {
  private DB: D1Database;

  constructor(DB: D1Database) {
    this.DB = DB;
  }

  async getByUsername(username: string) {
    const response = await this.DB.prepare(ADMIN_QUERIES.SELECT_BY_USERNAME)
      .bind(username)
      .first<{
        id: number;
        username: string;
        full_name: string;
        password_hash: string;
        role: string;
        is_active: boolean;
        /** Set by migration 0009. D1/SQLite returns 0/1 integers; normalize to boolean. */
        must_change_password?: number | boolean;
      }>();
    if (!response) return null;
    return { ...response, must_change_password: !!response.must_change_password };
  }

  async getById(id: number) {
    const response = await this.DB.prepare(ADMIN_QUERIES.SELECT_BY_ID)
      .bind(id)
      .first();
    if (!response) return null;
    const { password_hash: _ph, ...admin } = response as any;
    return admin;
  }

  /**
   * Fetch an admin *including* password_hash. Only for the change-password flow,
   * which must verify the current password server-side. Every other code path must
   * use getById/getByUsername so the hash is stripped before it reaches a view.
   */
  async getWithHash(id: number) {
    const response = await this.DB.prepare(ADMIN_QUERIES.SELECT_BY_ID)
      .bind(id)
      .first<{
        id: number;
        username: string;
        password_hash: string;
        must_change_password?: number | boolean;
      }>();
    if (!response) return null;
    return { ...response, must_change_password: !!response.must_change_password };
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

  /**
   * Store a new password hash and clear the must_change_password flag in the same
   * UPDATE, so there is no window where the new hash is stored but the account is
   * still treated as needing a change (or vice versa).
   */
  async changePassword(id: number, newHash: string, mustChange = false) {
    await this.DB.prepare(ADMIN_QUERIES.UPDATE_PASSWORD)
      .bind(newHash, mustChange ? 1 : 0, id)
      .run();
  }
}

export const ACTIVITY_QUERIES = {
  INSERT_LOG: `INSERT INTO audit_logs (actor_id, action, target_type, target_id, metadata, ip_address, result) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  GET_LOGS: `
    SELECT al.*, au.username as actor_username, au.full_name as actor_name
    FROM audit_logs al
    LEFT JOIN admin_users au ON al.actor_id = au.id
  `,
};

export class ActivityService {
  private DB: D1Database;

  constructor(DB: D1Database) {
    this.DB = DB;
  }

  async log(params: {
    actorId?: number;
    action: string;
    targetType?: string;
    targetId?: number;
    metadata?: Record<string, any>;
    ipAddress?: string;
    result?: string;
  }) {
    const { actorId, action, targetType, targetId, metadata, ipAddress, result } = params;

    await this.DB.prepare(ACTIVITY_QUERIES.INSERT_LOG)
      .bind(
        actorId ?? null,
        action,
        targetType || null,
        targetId ?? null,
        metadata ? JSON.stringify(metadata) : null,
        ipAddress || null,
        result || null,
      )
      .run();

    return { success: true };
  }

  async getLogs(
    action?: string,
    targetType?: string,
    page = 1,
    limit = 20,
  ) {
    let query = `${ACTIVITY_QUERIES.GET_LOGS}`;
    const binds: any[] = [];
    const filters: string[] = [];

    if (action) {
      filters.push(`al.action = ?`);
      binds.push(action);
    }
    if (targetType) {
      filters.push(`al.target_type = ?`);
      binds.push(targetType);
    }
    if (filters.length) {
      query += ` WHERE ${filters.join(" AND ")}`;
    }
    query += ` ORDER BY al.created_at DESC LIMIT ? OFFSET ?`;
    binds.push(limit, (page - 1) * limit);

    const response = await this.DB.prepare(query).bind(...binds).all();
    if (response.success) {
      return response.results.map((row: any) => ({
        ...row,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
      }));
    }
    return [];
  }

  async getTotalCount() {
    const response = await this.DB.prepare(
      `SELECT COUNT(*) as count FROM audit_logs`,
    ).first<{ count: number }>();
    return response?.count ?? 0;
  }
}

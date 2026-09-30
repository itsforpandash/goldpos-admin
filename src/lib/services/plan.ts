export const PLAN_QUERIES = {
  BASE_SELECT: `
    SELECT 
      plans.*,
      features.id as feature_id,
      features.name as feature_name,
      features.description as feature_description
    FROM plans
    LEFT JOIN plan_features
      ON plans.id = plan_features.plan_id
    LEFT JOIN features
      ON plan_features.feature_id = features.id
  `,
  INSERT_PLAN: `INSERT INTO plans (name, description, price, currency, duration_days, max_devices, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  UPDATE_PLAN: `UPDATE plans SET name = ?, description = ?, price = ?, currency = ?, duration_days = ?, max_devices = ?, status = ? WHERE id = ?`,
  DELETE_PLAN: `DELETE FROM plans WHERE id = ?`,
  INSERT_FEATURE: `INSERT OR IGNORE INTO features(name, description) VALUES(?, ?)`,
  SELECT_FEATURE_ID: `SELECT id FROM features WHERE name = ?`,
  INSERT_PLAN_FEATURE: `INSERT INTO plan_features(plan_id, feature_id) VALUES(?, ?)`,
};

const processPlanResults = (rows: any[]) => {
  const plansMap = new Map<number, any>();

  rows.forEach((row) => {
    if (!plansMap.has(row.id)) {
      const plan = { ...row, features: [] as any[] };
      plansMap.set(row.id, plan);
    }

    if (row.feature_id) {
      const plan = plansMap.get(row.id)!;
      plan.features.push({
        id: row.feature_id,
        name: row.feature_name,
        description: row.feature_description,
      });
    }

    const plan = plansMap.get(row.id)!;
    delete plan.feature_id;
    delete plan.feature_name;
    delete plan.feature_description;
  });

  return Array.from(plansMap.values());
};

export class PlanService {
  private DB: D1Database;

  constructor(DB: D1Database) {
    this.DB = DB;
  }

  async getById(id: number) {
    const query = `${PLAN_QUERIES.BASE_SELECT} WHERE plans.id = ?`;
    const response = await this.DB.prepare(query).bind(id).all();
    if (response.success) {
      const [plan] = processPlanResults(response.results);
      return plan || null;
    }
    return null;
  }

  async getAll(status?: string) {
    let query = `${PLAN_QUERIES.BASE_SELECT} ORDER BY plans.id ASC`;
    const binds: any[] = [];
    if (status) {
      query += ` WHERE plans.status = ?`;
      binds.push(status);
    }
    const response = await this.DB.prepare(query).bind(...binds).all();
    if (response.success) {
      return processPlanResults(response.results);
    }
    return [];
  }

  async create(planData: {
    name: string;
    description?: string;
    price: number;
    currency?: string;
    duration_days?: number;
    max_devices?: number;
    status?: string;
    features?: { name: string; description?: string }[];
  }) {
    const { name, description, price, currency, duration_days, max_devices, status, features } = planData;

    const planResponse = await this.DB.prepare(PLAN_QUERIES.INSERT_PLAN)
      .bind(
        name,
        description || null,
        price,
        currency || "IRR",
        duration_days || 30,
        max_devices || 1,
        status || "active",
      )
      .run();

    if (!planResponse.success) {
      throw new Error("Failed to create plan");
    }

    const planId = planResponse.meta.last_row_id;

    if (features?.length) {
      for (const feature of features) {
        await this.DB.prepare(PLAN_QUERIES.INSERT_FEATURE)
          .bind(feature.name, feature.description || null)
          .run();

        const featureIdResponse = await this.DB.prepare(PLAN_QUERIES.SELECT_FEATURE_ID)
          .bind(feature.name)
          .all<{ id: number }>();

        if (!featureIdResponse.success || !featureIdResponse.results.length) {
          continue;
        }
        await this.DB.prepare(PLAN_QUERIES.INSERT_PLAN_FEATURE)
          .bind(planId, featureIdResponse.results[0].id)
          .run();
      }
    }

    return { success: true, planId };
  }

  async update(planData: {
    id: number;
    name: string;
    description?: string;
    price: number;
    currency?: string;
    duration_days?: number;
    max_devices?: number;
    status?: string;
  }) {
    const { id, name, description, price, currency, duration_days, max_devices, status } = planData;
    const response = await this.DB.prepare(PLAN_QUERIES.UPDATE_PLAN)
      .bind(name, description || "", price, currency || "IRR", duration_days || 30, max_devices || 1, status || "active", id)
      .run();
    if (!response.success) {
      throw new Error("Failed to update plan");
    }
    return { success: true };
  }

  async delete(id: number) {
    const response = await this.DB.prepare(PLAN_QUERIES.DELETE_PLAN).bind(id).run();
    if (!response.success) {
      throw new Error("Failed to delete plan");
    }
    return { success: true };
  }

  async getDistribution() {
    const response = await this.DB.prepare(
      `SELECT plans.name, COUNT(licenses.id) as license_count
       FROM plans
       LEFT JOIN licenses ON plans.id = licenses.plan_id AND licenses.status = 'active'
       GROUP BY plans.id
       ORDER BY license_count DESC`,
    ).all<{ name: string; license_count: number }>();
    if (response.success) {
      return response.results;
    }
    return [];
  }
}

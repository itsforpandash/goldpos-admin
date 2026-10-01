/**
 * Signup requests — public lead capture (email OR Iranian mobile) with
 * admin review. Public-facing, therefore validation is the only gate.
 *
 * Convention follows the other services: a `*_QUERIES` const object plus a
 * service class bound to a D1Database.
 */
import { generateUniqueLicenseCodes } from "@/lib/services/license";

export const SIGNUP_QUERIES = {
  BASE_SELECT: `
    SELECT
      sr.*,
      plans.name as plan_name,
      plans.price as plan_price,
      plans.duration_days as plan_duration_days,
      plans.max_devices as plan_max_devices,
      licenses.code as license_code,
      reviewers.username as reviewer_username,
      reviewers.full_name as reviewer_name
    FROM signup_requests sr
    LEFT JOIN plans ON sr.plan_id = plans.id
    LEFT JOIN licenses ON sr.approved_license_id = licenses.id
    LEFT JOIN admin_users reviewers ON sr.reviewed_by = reviewers.id
  `,
  INSERT_SIGNUP: `
    INSERT INTO signup_requests (contact, contact_type, full_name, plan_id, status, note, ip_address)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)
  `,
  GET_BY_ID: `WHERE sr.id = ?`,
  GET_OPEN_BY_CONTACT: `WHERE sr.contact = ? AND sr.status IN ('pending', 'approved')`,
  APPROVE: `
    UPDATE signup_requests
    SET status = 'approved', approved_license_id = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'pending'
  `,
  REJECT: `
    UPDATE signup_requests
    SET status = 'rejected', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'pending'
  `,
  // Pending first, then the most recent of each group.
  ORDER: `ORDER BY CASE sr.status WHEN 'pending' THEN 0 ELSE 1 END ASC, sr.created_at DESC, sr.id DESC LIMIT 500`,
  COUNTS: `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
    FROM signup_requests
  `,
  USERS_BY_PHONE: `SELECT * FROM users WHERE phone IN`,
  USERS_BY_EMAIL: `SELECT * FROM users WHERE lower(email) = ?`,
  USERNAME_EXISTS: `SELECT id FROM users WHERE username = ?`,
  ACTIVE_PLAN: `SELECT * FROM plans WHERE id = ? AND status = 'active'`,
  DEFAULT_ACTIVE_PLAN: `SELECT * FROM plans WHERE status = 'active' ORDER BY id ASC LIMIT 1`,
  SETTING: `SELECT value FROM app_settings WHERE key = ?`,
  /* A signup applicant normally has no `users` row yet. Matching rules:
     - phone contact  -> match on any accepted spelling of the same number
     - email contact  -> match on lowercased email                        */
  USER_EMAIL_CANDIDATES: `SELECT * FROM users WHERE lower(email) = ?`,
};

export const SIGNUP_ERRORS = {
  REQUIRED: "لطفاً ایمیل یا شماره موبایل خود را وارد کنید.",
  TOO_LONG: "ورودی ارسالی بیش از حد طولانی است.",
  INVALID_EMAIL: "ایمیل واردشده معتبر نیست. نمونه درست: name@example.com",
  INVALID_PHONE: "شماره موبایل معتبر نیست. نمونه درست: 09121234567 یا +989121234567",
  NEITHER: "ورودی معتبر نیست. ایمیل (مثل name@example.com) یا شماره موبایل ایرانی (مثل 09121234567) وارد کنید.",
  NAME_TOO_LONG: "نام و نام خانوادگی بیش از حد طولانی است.",
  NOTE_TOO_LONG: "توضیحات بیش از حد طولانی است.",
  DUPLICATE: "قبلاً برای همین ایمیل یا شماره موبایل درخواستی ثبت شده است. تکرار ثبت ممکن نیست.",
  PLAN_INVALID: "پلن انتخاب‌شده معتبر نیست.",
};

export type ContactType = "email" | "phone";

export type ContactValidation =
  | { ok: true; contact: string; contactType: ContactType }
  | { ok: false; message: string };

export type SignupInputError = { code: string; message: string };

/** Thrown by SignupService so callers can map to an HTTP status. */
export class SignupError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SignupError";
    this.code = code;
  }
}

/* ------------------------------------------------------------------ *
 * Pure validators — no I/O, table-driven testable.
 * ------------------------------------------------------------------ */

const EMAIL_MAX = 254;
const EMAIL_LOCAL_MAX = 64;

/** Local part must start with a letter; TLD must be alphabetic (>= 2). */
const EMAIL_RE =
  /^[a-z][a-z0-9!#$%&'*+/=?^_`{|}~-]*(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/** The three accepted spellings only: 09…, +989…, 00989…. Separators already stripped. */
const PHONE_RE = /^(?:\+98|0098|0)(9\d{9})$/;

const PHONE_SEPARATORS = /[\s\-()._‌‏‎]/g;

const IRAN_CODE = "+98";

/** Persian (۰-۹ U+06F0) and Arabic-Indic (٠-٩ U+0660) digits -> ASCII. */
export function toAsciiDigits(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x06f0 && code <= 0x06f9) {
      out += String.fromCodePoint(code - 0x06f0 + 0x30);
    } else if (code >= 0x0660 && code <= 0x0669) {
      out += String.fromCodePoint(code - 0x0660 + 0x30);
    } else {
      out += ch;
    }
  }
  return out;
}

/** Every accepted spelling of an Iranian mobile, for DB matching. */
export function phoneCandidateForms(contact: string): string[] {
  const bare = contact.replace(/^\+/, "");
  if (!/^989\d{9}$/.test(bare)) return [contact];
  const national = `0${bare.slice(2)}`;
  const forms = [
    contact,
    `${IRAN_CODE}${bare.slice(2)}`,
    `98${bare.slice(2)}`,
    `0098${bare.slice(2)}`,
    national,
    toPersianDigitsLocal(national),
  ];
  return Array.from(new Set(forms));
}

function toPersianDigitsLocal(value: string): string {
  const digits = "۰۱۲۳۴۵۶۷۸۹";
  return value.replace(/[0-9]/g, (d) => digits[Number(d)]);
}

/**
 * Canonical stored form of an email (trimmed + lowercased) or null.
 */
export function normalizeEmail(raw: string): string | null {
  const candidate = toAsciiDigits(String(raw ?? "")).trim();
  if (!candidate) return null;
  if (candidate.length > EMAIL_MAX) return null;
  const lower = candidate.toLowerCase();
  const local = lower.slice(0, lower.lastIndexOf("@"));
  if (local.length === 0 || local.length > EMAIL_LOCAL_MAX) return null;
  return EMAIL_RE.test(lower) ? lower : null;
}

/**
 * Canonical stored form of an Iranian mobile — always `+989xxxxxxxxx` — or null.
 */
export function normalizePhone(raw: string): string | null {
  const stripped = toAsciiDigits(String(raw ?? "")).replace(PHONE_SEPARATORS, "").trim();
  if (!stripped) return null;
  const match = PHONE_RE.exec(stripped);
  if (!match) return null;
  // match[1] is the national number `9xxxxxxxxx` (no leading 0).
  return `${IRAN_CODE}${match[1]}`;
}

/**
 * Type a single free-text contact field as exactly one of email/phone.
 * A value containing "@" is only ever judged as an email, so a malformed
 * email is rejected instead of being silently coerced into something else.
 */
export function normalizeContact(raw: string): ContactValidation {
  const value = toAsciiDigits(String(raw ?? "")).trim();
  if (!value) return { ok: false, message: SIGNUP_ERRORS.REQUIRED };
  if (value.length > EMAIL_MAX) return { ok: false, message: SIGNUP_ERRORS.TOO_LONG };

  if (value.includes("@")) {
    const email = normalizeEmail(value);
    if (!email) return { ok: false, message: SIGNUP_ERRORS.INVALID_EMAIL };
    return { ok: true, contact: email, contactType: "email" };
  }

  const phone = normalizePhone(value);
  if (phone) return { ok: true, contact: phone, contactType: "phone" };

  if (/^[+\-\d()\s._‌‏‎]{6,}$/.test(value)) {
    return { ok: false, message: SIGNUP_ERRORS.INVALID_PHONE };
  }
  return { ok: false, message: SIGNUP_ERRORS.NEITHER };
}

export type SignupPayload = {
  contact: string;
  fullName?: string | null;
  planId?: number | null;
  note?: string | null;
  ipAddress?: string | null;
};

export type ValidatedSignup = {
  contact: string;
  contactType: ContactType;
  fullName: string | null;
  planId: number | null;
  note: string | null;
  ipAddress: string | null;
};

/** Full server-side validation of one public submission. */
export function validateSignupPayload(payload: SignupPayload): ValidatedSignup | SignupInputError {
  const contactResult = normalizeContact(payload.contact);
  if (!contactResult.ok) {
    return { code: "invalid_contact", message: contactResult.message };
  }

  const fullNameRaw = String(payload.fullName ?? "").trim();
  if (fullNameRaw.length > 120) {
    return { code: "name_too_long", message: SIGNUP_ERRORS.NAME_TOO_LONG };
  }

  const noteRaw = String(payload.note ?? "").trim();
  if (noteRaw.length > 1000) {
    return { code: "note_too_long", message: SIGNUP_ERRORS.NOTE_TOO_LONG };
  }

  let planId: number | null = null;
  if (payload.planId !== undefined && payload.planId !== null && payload.planId !== 0) {
    const n = Number(payload.planId);
    if (!Number.isInteger(n) || n <= 0) {
      return { code: "invalid_plan", message: SIGNUP_ERRORS.PLAN_INVALID };
    }
    planId = n;
  }

  return {
    contact: contactResult.contact,
    contactType: contactResult.contactType,
    fullName: fullNameRaw || null,
    planId,
    note: noteRaw || null,
    ipAddress: payload.ipAddress ? String(payload.ipAddress).slice(0, 64) : null,
  };
}

export function isSignupInputError(value: unknown): value is SignupInputError {
  return !!value && typeof value === "object" && "code" in (value as object) && !("contact" in (value as object));
}

/* ------------------------------------------------------------------ *
 * Service
 * ------------------------------------------------------------------ */

const processSignupResults = (rows: any[]) => rows.map((row: any) => ({ ...row }));

export class SignupService {
  private DB: D1Database;

  constructor(DB: D1Database) {
    this.DB = DB;
  }

  async create(payload: SignupPayload) {
    const validated = validateSignupPayload(payload);
    if (isSignupInputError(validated)) {
      throw new SignupError(validated.code, validated.message);
    }

    const open = await this.findOpenByContact(validated.contact);
    if (open) {
      throw new SignupError("duplicate", SIGNUP_ERRORS.DUPLICATE);
    }

    try {
      const response = await this.DB.prepare(SIGNUP_QUERIES.INSERT_SIGNUP)
        .bind(
          validated.contact,
          validated.contactType,
          validated.fullName,
          validated.planId,
          validated.note,
          validated.ipAddress,
        )
        .run();

      if (!response.success) {
        throw new SignupError("insert_failed", "ثبت درخواست ناموفق بود.");
      }
      return { success: true, id: response.meta.last_row_id as number, contact: validated.contact };
    } catch (err: any) {
      if (err instanceof SignupError) throw err;
      // The partial unique index is the race-proof backstop for concurrent submits.
      if (/UNIQUE constraint/i.test(String(err?.message ?? ""))) {
        throw new SignupError("duplicate", SIGNUP_ERRORS.DUPLICATE);
      }
      throw new SignupError("insert_failed", "ثبت درخواست ناموفق بود.");
    }
  }

  async findOpenByContact(contact: string) {
    const response = await this.DB.prepare(
      `${SIGNUP_QUERIES.BASE_SELECT} ${SIGNUP_QUERIES.GET_OPEN_BY_CONTACT} LIMIT 1`,
    )
      .bind(contact)
      .all();
    if (response.success && response.results.length) return response.results[0];
    return null;
  }

  async getById(id: number) {
    const response = await this.DB.prepare(
      `${SIGNUP_QUERIES.BASE_SELECT} ${SIGNUP_QUERIES.GET_BY_ID}`,
    )
      .bind(id)
      .all<any>();
    if (response.success && response.results.length) {
      return processSignupResults(response.results)[0];
    }
    return null;
  }

  async getAll(status?: string | null, search?: string | null) {
    let query = SIGNUP_QUERIES.BASE_SELECT;
    const binds: any[] = [];
    const filters: string[] = [];

    if (status && ["pending", "approved", "rejected"].includes(status)) {
      filters.push(`sr.status = ?`);
      binds.push(status);
    }
    if (search) {
      const term = String(search).trim();
      if (term) {
        filters.push(`(sr.contact LIKE ? OR sr.full_name LIKE ? OR sr.note LIKE ?)`);
        const like = `%${term}%`;
        binds.push(like, like, like);
      }
    }
    if (filters.length) {
      query += ` WHERE ${filters.join(" AND ")}`;
    }
    query += ` ${SIGNUP_QUERIES.ORDER}`;

    const response = await this.DB.prepare(query).bind(...binds).all<any>();
    if (response.success) return processSignupResults(response.results);
    return [];
  }

  async getCounts() {
    const response = await this.DB.prepare(SIGNUP_QUERIES.COUNTS).first<{
      total: number;
      pending: number;
      approved: number;
      rejected: number;
    }>();
    return {
      total: response?.total ?? 0,
      pending: response?.pending ?? 0,
      approved: response?.approved ?? 0,
      rejected: response?.rejected ?? 0,
    };
  }

  /** Plans offered to the public form — active plans only, marketing fields only. */
  async getPublicPlans() {
    const response = await this.DB.prepare(
      `SELECT id, name, description, price, currency, duration_days FROM plans WHERE status = 'active' ORDER BY id ASC`,
    ).all<{
      id: number;
      name: string;
      description: string | null;
      price: number;
      currency: string;
      duration_days: number;
    }>();
    if (response.success) return response.results;
    return [];
  }

  async getPlanById(id: number) {
    const plan = await this.DB.prepare(SIGNUP_QUERIES.ACTIVE_PLAN)
      .bind(id)
      .first<any>();
    return plan ?? null;
  }

  async getDefaultPlan() {
    return this.DB.prepare(SIGNUP_QUERIES.DEFAULT_ACTIVE_PLAN).first<any>();
  }

  async getSetting(key: string): Promise<string | null> {
    const row = await this.DB.prepare(SIGNUP_QUERIES.SETTING).bind(key).first<{ value: string }>();
    return row?.value ?? null;
  }

  /* ----- review actions ----- */

  /**
   * Approve a pending request: resolve (or create) the customer, generate one
   * license for the chosen plan, and record the review.
   */
  async approve(input: {
    id: number;
    adminId: number;
    planId?: number | null;
    /** Only used for an email-only applicant when no user matches: the admin
     *  supplies the customer's real mobile so a `users` row can be created.
     *  Never invented by the server. */
    userPhone?: string | null;
  }) {
    const { id, adminId, userPhone } = input;

    const request = await this.getById(id);
    if (!request) throw new SignupError("not_found", "درخواست یافت نشد.");
    if (request.status !== "pending") {
      throw new SignupError("already_reviewed", "این درخواست قبلاً بررسی شده است.");
    }

    const planId = Number(input.planId ?? request.plan_id ?? 0);
    if (!planId) {
      throw new SignupError("no_plan", "برای صدور لایسنس باید یک پلن انتخاب شود.");
    }
    const plan = await this.DB.prepare(SIGNUP_QUERIES.ACTIVE_PLAN).bind(planId).first<any>();
    if (!plan) throw new SignupError("plan_invalid", SIGNUP_ERRORS.PLAN_INVALID);

    const customer = await this.resolveCustomer(request, userPhone);

    const daysSetting = Number((await this.getSetting("default_license_days")) ?? plan.duration_days ?? 30);
    const days = Number.isFinite(daysSetting) && daysSetting > 0 ? daysSetting : Number(plan.duration_days) || 30;
    const maxDevices = Number(plan.max_devices) || 1;
    const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();

    const code = generateUniqueLicenseCodes(1)[0];
    const licenseResult = await this.DB.prepare(
      `INSERT INTO licenses (code, user_id, plan_id, status, max_devices, expires_at) VALUES (?, ?, ?, 'unused', ?, ?)`,
    )
      .bind(code, customer.userId, plan.id, maxDevices, expiresAt)
      .run();

    if (!licenseResult.success) {
      throw new SignupError("license_failed", "تولید لایسنس ناموفق بود.");
    }
    const licenseId = licenseResult.meta.last_row_id as number;
    await this.DB.prepare(`INSERT INTO license_events (license_id, event_type, details) VALUES (?, 'created', ?)`)
      .bind(licenseId, `License ${code} issued for signup request #${id}`)
      .run();

    const update = await this.DB.prepare(SIGNUP_QUERIES.APPROVE)
      .bind(licenseId, adminId, id)
      .run();
    if (!update.success || update.meta.changes !== 1) {
      throw new SignupError("already_reviewed", "این درخواست قبلاً بررسی شده است.");
    }

    return {
      success: true,
      code,
      licenseId,
      userId: customer.userId,
      userCreated: customer.created,
      userFullName: customer.fullName,
      userPhone: customer.phone,
      planName: plan.name,
      days,
      expiresAt,
    };
  }

  async reject(id: number, adminId: number) {
    const update = await this.DB.prepare(SIGNUP_QUERIES.REJECT).bind(adminId, id).run();
    if (!update.success) throw new SignupError("reject_failed", "رد درخواست ناموفق بود.");
    if (update.meta.changes !== 1) {
      const existing = await this.getById(id);
      if (!existing) throw new SignupError("not_found", "درخواست یافت نشد.");
      throw new SignupError("already_reviewed", "این درخواست قبلاً بررسی شده است.");
    }
    return { success: true };
  }

  /* ----- customer resolution ----- */

  private async findUserByPhone(contact: string) {
    const forms = phoneCandidateForms(contact);
    const placeholders = forms.map(() => "?").join(", ");
    const response = await this.DB.prepare(
      `${SIGNUP_QUERIES.USERS_BY_PHONE} (${placeholders})`,
    )
      .bind(...forms)
      .all<any>();
    if (response.success && response.results.length) return response.results[0];
    return null;
  }

  private async findUserByEmail(email: string) {
    const response = await this.DB.prepare(SIGNUP_QUERIES.USER_EMAIL_CANDIDATES)
      .bind(email)
      .all<any>();
    if (response.success && response.results.length) return response.results[0];
    return null;
  }

  private async resolveCustomer(
    request: any,
    userPhone: string | null | undefined,
  ): Promise<{ userId: number; created: boolean; fullName: string; phone: string }> {
    const existing =
      request.contact_type === "phone"
        ? await this.findUserByPhone(request.contact)
        : await this.findUserByEmail(request.contact);

    if (existing) {
      return {
        userId: existing.id,
        created: false,
        fullName: existing.full_name,
        phone: existing.phone,
      };
    }

    const name = String(request.full_name ?? "").trim() || "کاربر GoldPos";

    if (request.contact_type === "phone") {
      const national = `0${request.contact.slice(3)}`;
      return this.createUser(
        { fullName: name, phone: national, email: null },
        `g${national}`,
      );
    }

    // Email-only applicant: `users.phone` is NOT NULL UNIQUE and inventing one
    // would hand the customer a number that is not theirs. The admin must
    // supply the real mobile collected out-of-band.
    const supplied = String(userPhone ?? "").trim();
    if (!supplied) {
      throw new SignupError(
        "needs_phone",
        "برای این درخواست (فقط ایمیل) هیچ کاربری با این ایمیل وجود ندارد. شماره موبایل واقعی مشتری را در کادر کنار دکمه تأیید وارد کنید تا حسابش ساخته شود.",
      );
    }
    const phone = normalizePhone(supplied);
    if (!phone) throw new SignupError("phone_invalid", SIGNUP_ERRORS.INVALID_PHONE);

    const national = `0${phone.slice(3)}`;
    const clash = await this.findUserByPhone(phone);
    if (clash) {
      return { userId: clash.id, created: false, fullName: clash.full_name, phone: clash.phone };
    }
    return this.createUser(
      { fullName: name, phone: national, email: request.contact },
      `g${national}`,
    );
  }

  private async createUser(
    data: { fullName: string; phone: string; email: string | null },
    usernameSeed: string,
  ): Promise<{ userId: number; created: boolean; fullName: string; phone: string }> {
    const username = await this.uniqueUsername(usernameSeed);
    try {
      const response = await this.DB.prepare(
        `INSERT INTO users (username, full_name, phone, email, password_hash, status, role, notes) VALUES (?, ?, ?, ?, '', 'active', 'customer', ?)`,
      )
        .bind(username, data.fullName, data.phone, data.email, "ایجاد شده از فرم ثبت‌نام سایت")
        .run();
      if (!response.success) throw new SignupError("user_failed", "ساخت حساب کاربری ناموفق بود.");
      return {
        userId: response.meta.last_row_id as number,
        created: true,
        fullName: data.fullName,
        phone: data.phone,
      };
    } catch (err: any) {
      if (err instanceof SignupError) throw err;
      if (/UNIQUE constraint/i.test(String(err?.message ?? ""))) {
        // Someone created the account between the lookup and the insert.
        const clash = await this.findUserByPhone(data.phone);
        if (clash) {
          return { userId: clash.id, created: false, fullName: clash.full_name, phone: clash.phone };
        }
        const again = await this.uniqueUsername(usernameSeed);
        const retry = await this.DB.prepare(
          `INSERT INTO users (username, full_name, phone, email, password_hash, status, role, notes) VALUES (?, ?, ?, ?, '', 'active', 'customer', ?)`,
        )
          .bind(again, data.fullName, data.phone, data.email, "ایجاد شده از فرم ثبت‌نام سایت")
          .run();
        return {
          userId: retry.meta.last_row_id as number,
          created: true,
          fullName: data.fullName,
          phone: data.phone,
        };
      }
      throw new SignupError("user_failed", "ساخت حساب کاربری ناموفق بود.");
    }
  }

  private async uniqueUsername(seed: string) {
    const base = seed.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 60) || `g${Date.now()}`;
    let candidate = base;
    for (let i = 2; i <= 100; i++) {
      const existing = await this.DB.prepare(SIGNUP_QUERIES.USERNAME_EXISTS)
        .bind(candidate)
        .first<{ id: number }>();
      if (!existing) return candidate;
      candidate = `${base.slice(0, 55)}-${i}`;
    }
    return `${base.slice(0, 50)}-${Date.now()}`;
  }
}

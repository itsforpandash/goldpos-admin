import type { APIContext } from "astro";
import { SignupError, SignupService } from "@/lib/services/signup";
import { ActivityService } from "@/lib/services/activity";
import { getClientIp } from "@/lib/session-helpers";

/* ------------------------------------------------------------------ *
 * Rate limiting — module-local sliding window.
 *
 * Deliberately NOT in src/lib/security.ts (that file is owned elsewhere) and
 * NOT in KV: a KV write budget is exactly the resource a spam flood drains.
 * Per-isolate in-memory, like the other limiters in the app.
 * ------------------------------------------------------------------ */

type WindowRecord = { count: number; windowStart: number };

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_HITS = 5;
const RATE_LIMIT_MAX_TRACKED_IPS = 10_000;

const rateBuckets = new Map<string, WindowRecord>();

/** Sliding window per client IP. Returns true when the request may proceed. */
function allowByIp(ip: string): boolean {
  const now = Date.now();
  const record = rateBuckets.get(ip);

  if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(ip, { count: 1, windowStart: now });
    if (rateBuckets.size > RATE_LIMIT_MAX_TRACKED_IPS) {
      for (const [key, rec] of rateBuckets) {
        if (now - rec.windowStart > RATE_LIMIT_WINDOW_MS) rateBuckets.delete(key);
      }
    }
    return true;
  }

  record.count++;
  return record.count <= RATE_LIMIT_MAX_HITS;
}

/* ------------------------------------------------------------------ *
 * Cloudflare Turnstile — only for the browser page at /signup.
 *
 * Native-app endpoints (/activate, mobile API) deliberately have no Turnstile:
 * a widget token there would be trivially forgeable — security theater.
 *
 * Both env vars are OPTIONAL. With TURNSTILE_SECRET unset the endpoint stays
 * fully functional and simply unprotected, so a missing secret can never brick
 * a deploy.
 * ------------------------------------------------------------------ */

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SITEVERIFY_TIMEOUT_MS = 5_000;

type TurnstileVerdict = { ok: true } | { ok: false; message: string };

/**
 * Successful-verdict cache. Turnstile tokens are SINGLE-USE, so this is a
 * replay shield plus an outbound-fetch saver — NOT a correctness mechanism.
 * Failures are never cached: caching a rejection would let an attacker probe
 * which tokens are in the map and keep a good verdict alive past its window.
 */
const VERDICT_TTL_MS = 5 * 60 * 1000;
const VERDICT_MAX_ENTRIES = 500;
const verdictCache = new Map<string, number>(); // token -> expiry epoch ms

function cacheVerdict(token: string): void {
  const now = Date.now();
  // Oldest-first eviction, plus a cheap expired-entry sweep.
  for (const [key, expiry] of verdictCache) {
    if (expiry <= now) verdictCache.delete(key);
  }
  while (verdictCache.size >= VERDICT_MAX_ENTRIES) {
    const oldest = verdictCache.keys().next();
    if (oldest.done) break;
    verdictCache.delete(oldest.value);
  }
  verdictCache.set(token, now + VERDICT_TTL_MS);
}

async function verifyTurnstile(
  token: string,
  secret: string,
  ipAddress: string,
): Promise<TurnstileVerdict> {
  const trimmed = String(token ?? "").trim();
  if (!trimmed) {
    return { ok: false, message: "اعتبارسنجی امنیتی انجام نشد. لطفاً صفحه را تازه‌سازی کرده و دوباره تلاش کنید." };
  }

  const cachedExpiry = verdictCache.get(trimmed);
  if (cachedExpiry !== undefined) {
    if (cachedExpiry > Date.now()) return { ok: true };
    verdictCache.delete(trimmed);
  }

  // siteverify expects application/x-www-form-urlencoded, NOT JSON.
  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", trimmed);
  if (ipAddress && ipAddress !== "unknown") {
    body.set("remoteip", ipAddress);
  }

  let payload: any;
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
    if (!response.ok) {
      // Fail closed — a secret IS configured, so a broken upstream is a failure.
      return {
        ok: false,
        message: "سرویس تأیید امنیتی در دسترس نیست. چند دقیقه دیگر دوباره تلاش کنید.",
      };
    }
    payload = await response.json();
  } catch {
    // Unreachable or slow: surface a Persian message, never a stack trace, and
    // never hang the request.
    return {
      ok: false,
      message: "اتصال به سرویس تأیید امنیتی برقرار نشد. چند دقیقه دیگر دوباره تلاش کنید.",
    };
  }

  if (payload?.success === true) {
    cacheVerdict(trimmed);
    return { ok: true };
  }

  const codes: string[] = Array.isArray(payload?.["error-codes"]) ? payload["error-codes"] : [];
  if (codes.includes("timeout-or-duplicate")) {
    return {
      ok: false,
      message: "اعتبارسنجی امنیتی منقضی شده است. لطفاً دوباره تلاش کنید.",
    };
  }
  return { ok: false, message: "اعتبارسنجی امنیتی ناموفق بود. لطفاً دوباره تلاش کنید." };
}

/* ------------------------------------------------------------------ */

const json = (body: unknown, status: number) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

export async function POST({ locals, request }: APIContext) {
  const { DB } = locals.runtime.env;
  // TURNSTILE_SECRET is an optional secret; it is intentionally absent from the
  // generated Env type (wrangler.jsonc is owned elsewhere) and from wrangler.jsonc.
  const rawSecret = (locals.runtime.env as Record<string, unknown>).TURNSTILE_SECRET;
  const TURNSTILE_SECRET = typeof rawSecret === "string" ? rawSecret : "";
  const ipAddress = getClientIp(request);
  const activityService = new ActivityService(DB);

  // --- 1. parse body -------------------------------------------------
  let payload: any;
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      payload = await request.json();
    } else {
      const form = await request.formData();
      payload = {
        contact: form.get("contact"),
        fullName: form.get("fullName"),
        planId: form.get("planId"),
        note: form.get("note"),
        turnstileToken: form.get("turnstileToken"),
      };
    }
  } catch {
    return json({ success: false, message: "داده‌های ارسالی نامعتبر است." }, 400);
  }

  // --- 2. rate limit (before Turnstile, so a flood never reaches Cloudflare)
  if (!allowByIp(ipAddress)) {
    return json(
      {
        success: false,
        code: "rate_limited",
        message: "تعداد درخواست‌ها زیاد است. لطفاً چند دقیقه دیگر دوباره تلاش کنید.",
      },
      429,
    );
  }

  // --- 3. Turnstile (before ANY D1 write) ----------------------------
  const secret = TURNSTILE_SECRET;
  if (secret) {
    const verdict = await verifyTurnstile(
      String(payload?.turnstileToken ?? ""),
      secret,
      ipAddress,
    );
    if (!verdict.ok) {
      await activityService.log({
        action: "signup_turnstile_rejected",
        targetType: "signup_request",
        metadata: { ip: ipAddress },
        ipAddress,
        result: "fail",
      });
      return json(
        { success: false, code: "turnstile_failed", message: verdict.message },
        403,
      );
    }
  } else {
    // Graceful degradation — logged, never fatal.
    console.warn("TURNSTILE_SECRET not set — signup is unprotected");
  }

  // --- 4. validate + insert (first D1 write of the request path) -----
  const signupService = new SignupService(DB);
  try {
    const result = await signupService.create({
      contact: String(payload?.contact ?? ""),
      fullName: payload?.fullName ?? null,
      planId: payload?.planId ? Number(payload.planId) : null,
      note: payload?.note ?? null,
      ipAddress,
    });

    await activityService.log({
      action: "signup_requested",
      targetType: "signup_request",
      targetId: result.id,
      metadata: { contact: result.contact, planId: payload?.planId ?? null },
      ipAddress,
      result: "success",
    });

    return json(
      {
        success: true,
        id: result.id,
        message: "درخواست شما ثبت شد. کارشناسان ما در اولین فرصت با شما تماس می‌گیرند.",
      },
      201,
    );
  } catch (err: any) {
    const isSignupError = err instanceof SignupError;
    const status = isSignupError && err.code === "duplicate" ? 409 : 400;

    await activityService.log({
      action: "signup_request_failed",
      targetType: "signup_request",
      metadata: { reason: isSignupError ? err.code : "unexpected" },
      ipAddress,
      result: "fail",
    });

    return json(
      {
        success: false,
        code: isSignupError ? err.code : "invalid_request",
        message: isSignupError ? err.message : "ثبت درخواست ناموفق بود. لطفاً دوباره تلاش کنید.",
      },
      status,
    );
  }
}

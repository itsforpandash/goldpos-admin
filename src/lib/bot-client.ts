/**
 * Panel → bot Worker control client.
 *
 * The panel never holds TELEGRAM_BOT_TOKEN. It holds BOT_SETUP_TOKEN, which
 * only authorises it to ASK the bot Worker to do something. So this client can
 * register a webhook and read webhook health, and by construction cannot read
 * the token back — there is no endpoint that returns it, and none should ever
 * be added.
 *
 * Failure handling: this is an outbound call to another Worker on a different
 * account's edge, so a timeout, a 502 from a cold start, or a missing
 * deployment are all ordinary outcomes, not bugs. Every one of them resolves
 * to a typed result the page can render, never an exception.
 */

/** Must match SETUP_TOKEN_HEADER in the bot''s src/admin-api.ts. */
const SETUP_TOKEN_HEADER = "x-bot-setup-token";

export interface BotWebhookState {
  url: string | null;
  pendingUpdates: number;
  lastError: string | null;
}

export interface BotStatus {
  /** False when the bot Worker could not be reached or refused the key. */
  reachable: boolean;
  /** True when the Worker holds a bot token (it never reveals the value). */
  botTokenConfigured: boolean;
  /** True when the Worker can authenticate Telegram's deliveries. */
  webhookSecretConfigured: boolean;
  webhook: BotWebhookState | null;
  activeAdmins: number | null;
  /** Human-readable Persian reason, ready to show in the panel. */
  error: string | null;
}

export interface BotSetupResult {
  ok: boolean;
  url: string | null;
  pendingUpdates: number;
  lastError: string | null;
  error: string | null;
}

interface RawStatus {
  ok?: boolean;
  botTokenConfigured?: boolean;
  webhookSecretConfigured?: boolean;
  webhook?: { url?: string | null; pendingUpdates?: number; lastError?: string | null } | null;
  activeAdmins?: number | null;
  error?: string | null;
}

const UNREACHABLE = "ارتباط با ورکر ربات برقرار نشد.";

/**
 * Calls the bot Worker's control API.
 *
 * `env` is the panel's own runtime env. The key comes from a Worker secret
 * (never wrangler.jsonc, never the bundle) — see session-helpers.ts for the
 * rules that apply to SESSION_SECRET; this key needs no strength policy of its
 * own because it only authorises a command, never a session.
 */
async function call<T>(
  path: string,
  env: { BOT_SETUP_TOKEN?: string; BOT_WORKER_URL?: string },
  init: RequestInit = {},
): Promise<{ status: number; body: T | null }> {
  const key = env.BOT_SETUP_TOKEN?.trim();
  if (!key) return { status: 0, body: null };

  const base = (env.BOT_WORKER_URL ?? "").trim().replace(/\/+$/, "");
  if (!base) return { status: 0, body: null };

  const headers = new Headers(init.headers);
  headers.set(SETUP_TOKEN_HEADER, key);
  if (init.body) headers.set("content-type", "application/json");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${base}${path}`, { ...init, headers, signal: controller.signal });
    const body = (await res.json().catch(() => null)) as T | null;
    return { status: res.status, body };
  } catch {
    return { status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}

/** Reads the bot's webhook state. Never throws. */
export async function fetchBotStatus(env: {
  BOT_SETUP_TOKEN?: string;
  BOT_WORKER_URL?: string;
}): Promise<BotStatus> {
  const { status, body } = await call<RawStatus>("/admin/status", env);
  if (status === 0 || !body) {
    return {
      reachable: false,
      botTokenConfigured: false,
      webhookSecretConfigured: false,
      webhook: null,
      activeAdmins: null,
      error: UNREACHABLE,
    };
  }
  if (status === 403) {
    return {
      reachable: true,
      botTokenConfigured: false,
      webhookSecretConfigured: false,
      webhook: null,
      activeAdmins: null,
      error: "کلید اتصال پنل و ورکر ربات یکی نیست (BOT_SETUP_TOKEN).",
    };
  }
  if (status === 405) {
    return {
      reachable: true,
      botTokenConfigured: false,
      webhookSecretConfigured: false,
      webhook: null,
      activeAdmins: null,
      error: "ورکر ربات نسخهٔ قدیمی است و این مسیر را نمی‌شناسد. یک‌بار دیپلوی کنید.",
    };
  }

  return {
    reachable: status === 200,
    botTokenConfigured: Boolean(body.botTokenConfigured),
    webhookSecretConfigured: Boolean(body.webhookSecretConfigured),
    webhook: body.webhook
      ? {
          url: body.webhook.url ?? null,
          pendingUpdates: body.webhook.pendingUpdates ?? 0,
          lastError: body.webhook.lastError ?? null,
        }
      : null,
    activeAdmins: typeof body.activeAdmins === "number" ? body.activeAdmins : null,
    error: body.error ?? null,
  };
}

/** Registers (or re-points) the webhook. Never throws. */
export async function setupBotWebhook(
  env: { BOT_SETUP_TOKEN?: string; BOT_WORKER_URL?: string },
  webhookUrl: string,
): Promise<BotSetupResult> {
  const { status, body } = await call<{ ok?: boolean; url?: string | null; pendingUpdates?: number; lastError?: string | null; error?: string | null }>(
    "/admin/setup",
    env,
    { method: "POST", body: JSON.stringify({ webhookUrl }) },
  );

  if (status === 0 || !body) {
    return { ok: false, url: null, pendingUpdates: 0, lastError: null, error: UNREACHABLE };
  }
  return {
    ok: status === 200 && body.ok === true,
    url: body.url ?? null,
    pendingUpdates: body.pendingUpdates ?? 0,
    lastError: body.lastError ?? null,
    error: status === 200 ? (body.error ?? null) : (body.error ?? "ثبت نشد."),
  };
}

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

import { SETTING_KEYS } from "@/lib/services/settings";

/** Must match SETUP_TOKEN_HEADER in the bot''s src/admin-api.ts. */
const SETUP_TOKEN_HEADER = "x-bot-setup-token";

/** The two panel Worker vars this client reads (env, then the settings table). */
export type BotEnv = {
  BOT_SETUP_TOKEN?: string;
  BOT_WORKER_URL?: string;
  /**
   * Service binding to the bot Worker (`services` in wrangler.jsonc).
   *
   * Cloudflare refuses Worker→Worker requests that go over `*.workers.dev`
   * (error 1042, answered locally in milliseconds), so the binding is the
   * transport that actually works inside this account. When it is absent the
   * plain fetch remains — that path only succeeds for a non-workers.dev domain.
   */
  BOT_WORKER?: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
};

/**
 * Pre-fetched `settings` rows, keyed exactly like `BotEnv` because
 * SETTING_KEYS.BOT_WORKER_URL / .BOT_SETUP_TOKEN carry the env var names.
 * Fetched ONCE per page operation by the caller and passed in — this module
 * never touches D1, so one status check costs one round trip, not one per key.
 */
export type BotSettings = Readonly<Record<string, string | undefined>>;

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
 * Effective connection values: **env first, then the panel's saved rows**.
 *
 * The env var stays the source of truth — a value saved from the settings page
 * only takes over when the Worker var is absent or empty, so an operator can
 * connect the panel without touching wrangler, and a deployment that already
 * sets env behaves exactly as before. Both inputs are plain strings, so the
 * caller passes pre-fetched `settings` rows and this stays a pure function.
 */
export function resolveBotConnection(
  env: BotEnv,
  settings?: BotSettings | null,
): { setupToken: string; workerUrl: string } {
  const setupToken =
    env.BOT_SETUP_TOKEN?.trim() || settings?.[SETTING_KEYS.BOT_SETUP_TOKEN]?.trim() || "";
  const stripSlash = (value: string | undefined) => (value ?? "").trim().replace(/\/+$/, "");
  const workerUrl = stripSlash(env.BOT_WORKER_URL) || stripSlash(settings?.[SETTING_KEYS.BOT_WORKER_URL]);
  return { setupToken, workerUrl };
}

/**
 * Calls the bot Worker's control API.
 *
 * `env` is the panel's own runtime env; `settings` is the caller's pre-fetched
 * copy of the two `settings` rows, used only where env is empty (see
 * resolveBotConnection). The key comes from a Worker secret or that row (never
 * wrangler.jsonc, never the bundle) — see session-helpers.ts for the rules
 * that apply to SESSION_SECRET; this key needs no strength policy of its own
 * because it only authorises a command, never a session.
 */
async function call<T>(
  path: string,
  env: BotEnv,
  init: RequestInit = {},
  settings?: BotSettings | null,
): Promise<{ status: number; body: T | null }> {
  const { setupToken: key, workerUrl: base } = resolveBotConnection(env, settings);
  // Warn only when BOTH sources are empty: with env unset and a row saved, the
  // fallback is the designed behaviour, not a misconfiguration.
  if (!key) {
    console.warn("[bot-client] BOT_SETUP_TOKEN is missing");
    return { status: 0, body: null };
  }

  if (!base) {
    console.warn("[bot-client] BOT_WORKER_URL is missing");
    return { status: 0, body: null };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    // Inside the try on purpose: Headers.set throws (TypeError) on a value that
    // is not a ByteString, and an exception escaping here would take the calling
    // page down instead of rendering the unreachable badge it exists to show.
    const headers = new Headers(init.headers);
    headers.set(SETUP_TOKEN_HEADER, key);
    if (init.body) headers.set("content-type", "application/json");

    const url = `${base}${path}`;
    const request = new Request(url, { ...init, headers, signal: controller.signal });
    // Binding first: a plain fetch to *.workers.dev from inside a Worker comes
    // back as 404 "error code: 1042" (see BotEnv.BOT_WORKER), so the public URL
    // is only a fallback for a non-workers.dev domain.
    const res = env.BOT_WORKER ? await env.BOT_WORKER.fetch(request) : await fetch(request);
    const raw = await res.text().catch(() => "");
    let body: T | null = null;
    if (raw) {
      try {
        body = JSON.parse(raw) as T;
      } catch {
        // falls through to the diagnostic below
      }
    }
    if (!body) {
      const transport = env.BOT_WORKER ? "binding" : "https";
      console.warn(`[bot-client] non-JSON reply from ${url} (transport=${transport}): HTTP ${res.status} body=${raw.slice(0, 120)}`);
    }
    return { status: res.status, body };
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.warn(`[bot-client] fetch to ${path} failed: ${reason}`);
    return { status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}

/** Reads the bot's webhook state. Never throws. `settings` = pre-fetched rows. */
export async function fetchBotStatus(env: BotEnv, settings?: BotSettings | null): Promise<BotStatus> {
  const { status, body } = await call<RawStatus>("/admin/status", env, {}, settings);
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

/** Registers (or re-points) the webhook. Never throws. `settings` = pre-fetched rows. */
export async function setupBotWebhook(
  env: BotEnv,
  webhookUrl: string,
  settings?: BotSettings | null,
): Promise<BotSetupResult> {
  const { status, body } = await call<{ ok?: boolean; url?: string | null; pendingUpdates?: number; lastError?: string | null; error?: string | null }>(
    "/admin/setup",
    env,
    { method: "POST", body: JSON.stringify({ webhookUrl }) },
    settings,
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

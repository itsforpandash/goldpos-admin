import type { APIContext } from "astro";
import {
  MIN_PASSWORD_LENGTH,
  MIN_SETUP_TOKEN_LENGTH,
  BOT_CONNECTION_KEYS,
  SETTING_KEYS,
  SettingsError,
  SettingsService,
  generateWebhookSecret,
} from "@/lib/services/settings";
import { AdminUserService } from "@/lib/services/admin";
import { ActivityService } from "@/lib/services/activity";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { getClientIp } from "@/lib/session-helpers";
import { resolveBotConnection, setupBotWebhook } from "@/lib/bot-client";
import type { BotEnv, BotSettings } from "@/lib/bot-client";
import { RateLimiter } from "@/lib/security";

const redirect = (to: string) =>
  new Response(null, { status: 303, headers: { Location: to } });

/** Carry a Persian detail message through the redirect without a raw query dump. */
const errUrl = (key: string, detail?: string) => {
  const url = new URL("/admin/settings", "https://placeholder.invalid");
  url.searchParams.set("err", key);
  if (detail) url.searchParams.set("msg", detail);
  return `/admin/settings?${url.searchParams.toString()}`;
};

const okUrl = (key: string, extra?: Record<string, string>) => {
  const url = new URL("/admin/settings", "https://placeholder.invalid");
  url.searchParams.set("ok", key);
  for (const [name, value] of Object.entries(extra ?? {})) {
    url.searchParams.set(name, value);
  }
  return `/admin/settings?${url.searchParams.toString()}`;
};

// Brute-force guard on the current-password check (per IP + admin, in-memory
// per isolate — same model as change-password/submit.ts).
const passwordLimiter = new RateLimiter(5 * 60 * 1000, 20);

/** Ceiling for any one pasted setting (token, URL, key) — a paste accident, not a policy. */
const MAX_SETTING_LENGTH = 512;

/**
 * The bot Worker is expected on Cloudflare's shared *.workers.dev host (the
 * only host the panel is allowed to call). Anything else — an IP, a typo'd
 * domain, plain http:// — is a paste error the operator can fix, so it gets
 * its own Persian message instead of a silent connect failure later.
 */
const WORKERS_DEV_SUFFIX = ".workers.dev";

export async function POST({ locals, request }: APIContext) {
  const { DB } = locals.runtime.env;
  const env = locals.runtime.env as unknown as BotEnv;
  const admin = locals.SESSION;
  const ipAddress = getClientIp(request);

  // Middleware already guards /admin/*, but never mutate without a session.
  if (!admin?.id) return redirect("/admin/login");

  const form = await request.formData();
  const action = String(form.get("action") || "");
  if (!action) return redirect("/admin/settings?err=fields");

  const settingsService = new SettingsService(DB);
  const adminService = new AdminUserService(DB);
  const activityService = new ActivityService(DB);

  /**
   * The two connection rows, read ONCE per request and handed to bot-client:
   * a status check or a connect then costs a single pair of reads instead of
   * one per call site. Lazily fetched, so the account actions stay D1-light.
   */
  let connectionSettings: Record<string, string> | undefined;
  const getConnectionSettings = async (): Promise<BotSettings> => {
    connectionSettings ??= await settingsService.getMany(BOT_CONNECTION_KEYS);
    return connectionSettings;
  };

  /**
   * One paste = connected: when BOTH settings hold a value, register the
   * webhook in the same request. Failure is always a flash message with the
   * Persian wording bot-client already produced — never a 500, never the key.
   * Returns null when there is nothing to connect yet.
   */
  const maybeConnect = async (
    token: string,
    secret: string,
  ): Promise<{ ok: boolean; pending: number; error: string | null } | null> => {
    if (!token.trim() || !secret.trim()) return null;
    const conn = await getConnectionSettings();
    // env first, then the row saved on this page — the same order the client uses.
    const { workerUrl } = resolveBotConnection(env, conn);
    if (!workerUrl) {
      return {
        ok: false,
        pending: 0,
        error:
          "آدرس ورکر ربات تنظیم نشده است؛ ابتدا آن را در بخش «اتصال با ورکر ربات» ذخیره کنید.",
      };
    }
    const result = await setupBotWebhook(env, `${workerUrl}/webhook`, conn);
    return { ok: result.ok, pending: result.pendingUpdates ?? 0, error: result.error };
  };

  /** A save that succeeded but whose auto-connect failed: say both, in order. */
  const saveConnectFailed = (error: string | null) =>
    errUrl(
      "save_connect_failed",
      `ذخیره شد، اما ثبت وب‌هوک ناموفق بود: ${error || "خطای ناشناخته"}`,
    );

  /** Log the connect attempt. Metadata stays booleans/counts — never a secret. */
  const logConnect = async (outcome: { ok: boolean; pending: number }) => {
    await activityService.log({
      actorId: admin.id,
      action: "settings_webhook_connected",
      targetType: "settings",
      metadata: { connected: outcome.ok, pending: outcome.pending },
      ipAddress,
      result: outcome.ok ? "success" : "fail",
    });
  };

  try {
    // ── a. account: username ────────────────────────────────────────────────
    if (action === "username") {
      const username = String(form.get("username") || "");

      let next: string;
      try {
        next = await settingsService.updateUsername(admin.id, username);
      } catch (err) {
        if (err instanceof SettingsError) {
          await activityService.log({
            actorId: admin.id,
            action: "settings_username_changed",
            targetType: "admin",
            targetId: admin.id,
            metadata: { reason: err.code },
            ipAddress,
            result: "fail",
          });
          return redirect(errUrl(err.code, err.message));
        }
        throw err;
      }

      await activityService.log({
        actorId: admin.id,
        action: "settings_username_changed",
        targetType: "admin",
        targetId: admin.id,
        // Lengths only — no username, no password, no token in the audit trail.
        metadata: { length: next.length },
        ipAddress,
        result: "success",
      });
      return redirect(okUrl("username"));
    }

    // ── a. account: password ────────────────────────────────────────────────
    if (action === "password") {
      const ip = ipAddress;
      if (!passwordLimiter.allow(`settings_pw_${ip}_${admin.id}`)) {
        return redirect(errUrl("rate_limit"));
      }

      const current = String(form.get("current_password") ?? "");
      const next = String(form.get("new_password") ?? "");
      const confirm = String(form.get("confirm_password") ?? "");

      const logFailure = async (code: string) => {
        // Codes only — the passwords are never written to the audit log or the URL.
        await activityService.log({
          actorId: admin.id,
          action: "settings_password_changed",
          targetType: "admin",
          targetId: admin.id,
          metadata: { reason: code },
          ipAddress,
          result: "fail",
        });
        return redirect(errUrl(code));
      };

      // Most specific reason first: a typo'd confirmation or "the same
      // password again" must not be masked by a generic strength complaint.
      if (!current || !next || !confirm) return await logFailure("fields");
      if (next !== confirm) return await logFailure("confirm");

      const row = await adminService.getWithHash(admin.id);
      if (!row) return redirect("/admin/login");

      // The current password must be proven before anything changes.
      if (!(await verifyPassword(current, row.password_hash))) return await logFailure("current");
      // Reject changing to the current password (same secret, new hash = no-op).
      if (next === current || (await verifyPassword(next, row.password_hash))) {
        return await logFailure("same_password");
      }
      if (next.length < MIN_PASSWORD_LENGTH) return await logFailure("weak");

      const newHash = await hashPassword(next);
      // must_change_password = 0 in the same UPDATE as the hash: a chosen
      // password is exactly what clears migration 0009's forced-change flag.
      await adminService.changePassword(admin.id, newHash, false);

      await activityService.log({
        actorId: admin.id,
        action: "settings_password_changed",
        targetType: "admin",
        targetId: admin.id,
        metadata: { length: next.length, mustChange: false },
        ipAddress,
        result: "success",
      });
      return redirect(okUrl("password"));
    }

    // ── b. bot: token (write-only) ──────────────────────────────────────────
    if (action === "bot_token") {
      const value = String(form.get("bot_token") || "").trim();
      if (!value || value.length > MAX_SETTING_LENGTH) return redirect("/admin/settings?err=fields");

      await settingsService.set(SETTING_KEYS.BOT_TOKEN, value, admin.id);
      await activityService.log({
        actorId: admin.id,
        action: "settings_bot_token_changed",
        targetType: "settings",
        metadata: { length: value.length, configured: true },
        ipAddress,
        result: "success",
      });

      const connect = await maybeConnect(value, await settingsService.get(SETTING_KEYS.BOT_WEBHOOK_SECRET));
      if (connect) {
        await logConnect(connect);
        return connect.ok
          ? redirect(okUrl("token_connected", { pending: String(connect.pending) }))
          : redirect(saveConnectFailed(connect.error));
      }
      return redirect(okUrl("token_saved"));
    }

    // ── b. bot: Worker URL (editable; env first, this row as fallback) ─────
    if (action === "bot_url") {
      const raw = String(form.get("bot_url") || "").trim();

      // Empty = clear the row: the client then falls back to the env var.
      if (!raw) {
        await settingsService.set(SETTING_KEYS.BOT_WORKER_URL, "", admin.id);
        await activityService.log({
          actorId: admin.id,
          action: "settings_bot_url_changed",
          targetType: "settings",
          // Whether anything is configured — never the address itself.
          metadata: { configured: false },
          ipAddress,
          result: "success",
        });
        return redirect(okUrl("bot_url_cleared"));
      }

      if (raw.length > MAX_SETTING_LENGTH) return redirect(errUrl("bot_url_invalid"));
      if (!/^https:\/\//i.test(raw)) return redirect(errUrl("bot_url_scheme"));

      let parsed: URL;
      try {
        parsed = new URL(raw);
      } catch {
        return redirect(errUrl("bot_url_invalid"));
      }
      if (parsed.protocol !== "https:") return redirect(errUrl("bot_url_scheme"));
      // Credentials in a URL are never what the operator means to paste.
      if (parsed.username || parsed.password) return redirect(errUrl("bot_url_invalid"));

      const host = parsed.hostname.toLowerCase();
      if (host === "workers.dev" || !host.endsWith(WORKERS_DEV_SUFFIX)) {
        return redirect(errUrl("bot_url_host"));
      }

      const value = raw.replace(/\/+$/, "");
      await settingsService.set(SETTING_KEYS.BOT_WORKER_URL, value, admin.id);
      await activityService.log({
        actorId: admin.id,
        action: "settings_bot_url_changed",
        targetType: "settings",
        // Length only — the audit trail never carries the address.
        metadata: { configured: true, length: value.length },
        ipAddress,
        result: "success",
      });
      return redirect(okUrl("bot_url_saved"));
    }

    // ── b. bot: setup key shared with the bot Worker (write-only) ──────────
    if (action === "bot_setup_token") {
      const value = String(form.get("bot_setup_token") || "").trim();
      // Empty = leave the stored key untouched (same contract as bot_token),
      // so the form reports what is missing instead of silently doing nothing.
      if (!value || value.length > MAX_SETTING_LENGTH) {
        return redirect("/admin/settings?err=fields");
      }
      // A random key, not a password: length floor only.
      if (value.length < MIN_SETUP_TOKEN_LENGTH) return redirect(errUrl("setup_token_length"));
      // It is sent as an HTTP header value, so it must stay printable ASCII
      // with no space: a non-Latin1 or control character would make the very
      // call this key authorises throw instead of fail politely.
      if (!/^[\x21-\x7e]+$/.test(value)) return redirect(errUrl("setup_token_charset"));

      await settingsService.set(SETTING_KEYS.BOT_SETUP_TOKEN, value, admin.id);
      await activityService.log({
        actorId: admin.id,
        action: "settings_setup_token_changed",
        targetType: "settings",
        // Length only — the key itself never reaches the audit log.
        metadata: { length: value.length, configured: true },
        ipAddress,
        result: "success",
      });
      return redirect(okUrl("setup_token_saved"));
    }

    // ── b. bot: rotate webhook secret (server-side, 64 hex chars) ───────────
    if (action === "rotate_secret") {
      const value = generateWebhookSecret();
      await settingsService.set(SETTING_KEYS.BOT_WEBHOOK_SECRET, value, admin.id);
      await activityService.log({
        actorId: admin.id,
        action: "settings_webhook_secret_rotated",
        targetType: "settings",
        // The secret itself never reaches the log — only its length.
        metadata: { length: value.length },
        ipAddress,
        result: "success",
      });

      const connect = await maybeConnect(await settingsService.get(SETTING_KEYS.BOT_TOKEN), value);
      if (connect) {
        await logConnect(connect);
        return connect.ok
          ? redirect(okUrl("secret_connected", { pending: String(connect.pending) }))
          : redirect(saveConnectFailed(connect.error));
      }
      return redirect(okUrl("secret_rotated"));
    }

    // ── b. bot: one-click webhook connect ───────────────────────────────────
    if (action === "connect") {
      const token = await settingsService.get(SETTING_KEYS.BOT_TOKEN);
      const secret = await settingsService.get(SETTING_KEYS.BOT_WEBHOOK_SECRET);
      if (!token.trim() || !secret.trim()) {
        return redirect(errUrl("need_settings", "ابتدا توکن ربات و کلید وب‌هوک را ذخیره کنید."));
      }

      const connect = await maybeConnect(token, secret);
      if (!connect) return redirect(errUrl("need_settings"));
      await logConnect(connect);
      return connect.ok
        ? redirect(okUrl("connected", { pending: String(connect.pending) }))
        : redirect(errUrl("connect", connect.error || undefined));
    }

    return redirect("/admin/settings?err=unknown_action");
  } catch {
    // Anything unexpected (D1 failure, audit write failure) is a flash, not a stack trace.
    return redirect("/admin/settings?err=action");
  }
}

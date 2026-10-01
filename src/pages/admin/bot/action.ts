import type { APIContext } from "astro";
import { ActivityService } from "@/lib/services/activity";
import { getClientIp } from "@/lib/session-helpers";
import { setupBotWebhook } from "@/lib/bot-client";

const redirect = (to: string) =>
  new Response(null, { status: 303, headers: { Location: to } });

/** Carry a Persian detail message through the redirect without a raw query dump. */
const errUrl = (key: string, detail?: string) => {
  const url = new URL("/admin/bot", "https://placeholder.invalid");
  url.searchParams.set("err", key);
  if (detail) url.searchParams.set("msg", detail);
  return `/admin/bot?${url.searchParams.toString()}`;
};

const okUrl = (key: string, extra?: Record<string, string>) => {
  const url = new URL("/admin/bot", "https://placeholder.invalid");
  url.searchParams.set("ok", key);
  for (const [name, value] of Object.entries(extra ?? {})) {
    url.searchParams.set(name, value);
  }
  return `/admin/bot?${url.searchParams.toString()}`;
};

// Telegram chat ids are 64-bit and often negative; anything else is not an id.
const CHAT_ID = /^-?\d{1,20}$/;
const ROLES = ["super_admin", "admin", "read_only"] as const;

export async function POST({ locals, request }: APIContext) {
  const { DB } = locals.runtime.env;
  // Two vars the generated Env type does not declare yet; bot-client reads them itself.
  const env = locals.runtime.env as unknown as {
    BOT_SETUP_TOKEN?: string;
    BOT_WORKER_URL?: string;
  };
  const admin = locals.SESSION;
  const ipAddress = getClientIp(request);

  if (!admin) {
    return redirect("/admin/login");
  }

  const form = await request.formData();
  const action = String(form.get("action") || "");
  const chatIdRaw = String(form.get("chat_id") || "").trim();

  if (!action) {
    return redirect("/admin/bot?err=fields");
  }

  const activityService = new ActivityService(DB);

  try {
    if (action === "add") {
      const fullName = String(form.get("full_name") || "").trim();
      const role = String(form.get("role") || "").trim();

      if (!CHAT_ID.test(chatIdRaw) || !ROLES.includes(role as (typeof ROLES)[number])) {
        // A bad role is its own error key; a bad id falls back to the generic wording.
        return redirect(CHAT_ID.test(chatIdRaw) ? errUrl("role") : "/admin/bot?err=fields");
      }

      const chatId = Number(chatIdRaw);

      try {
        await DB.prepare(
          `INSERT INTO bot_admins (chat_id, full_name, role, is_active) VALUES (?, ?, ?, 1)`,
        )
          .bind(chatId, fullName || null, role)
          .run();
      } catch (insertErr: any) {
        const message = String(insertErr?.message ?? insertErr ?? "");
        if (/UNIQUE|PRIMARY KEY|constraint/i.test(message)) {
          return redirect(errUrl("exists"));
        }
        throw insertErr;
      }

      await activityService.log({
        actorId: admin.id,
        action: "bot_admin_added",
        targetType: "bot_admin",
        targetId: chatId,
        metadata: { chatId, role },
        ipAddress,
        result: "success",
      });

      return redirect(okUrl("added"));
    }

    if (!CHAT_ID.test(chatIdRaw)) {
      return redirect("/admin/bot?err=fields");
    }
    const chatId = Number(chatIdRaw);

    if (action === "toggle") {
      const result = await DB.prepare(
        `UPDATE bot_admins SET is_active = CASE WHEN is_active THEN 0 ELSE 1 END WHERE chat_id = ?`,
      )
        .bind(chatId)
        .run();

      if (!result.meta.changes) {
        return redirect(errUrl("missing"));
      }

      await activityService.log({
        actorId: admin.id,
        action: "bot_admin_toggled",
        targetType: "bot_admin",
        targetId: chatId,
        metadata: { chatId },
        ipAddress,
        result: "success",
      });

      return redirect(okUrl("toggled"));
    }

    if (action === "remove") {
      const result = await DB.prepare(`DELETE FROM bot_admins WHERE chat_id = ?`)
        .bind(chatId)
        .run();

      if (!result.meta.changes) {
        return redirect(errUrl("missing"));
      }

      await activityService.log({
        actorId: admin.id,
        action: "bot_admin_removed",
        targetType: "bot_admin",
        targetId: chatId,
        metadata: { chatId },
        ipAddress,
        result: "success",
      });

      return redirect(okUrl("removed"));
    }

    if (action === "connect") {
      const base = (env.BOT_WORKER_URL ?? "").trim().replace(/\/+$/, "");
      const result = await setupBotWebhook(env, `${base}/webhook`);

      if (!result.ok) {
        // The client already words every failure in Persian; never echo the key.
        await activityService.log({
          actorId: admin.id,
          action: "bot_webhook_connect_failed",
          targetType: "bot_webhook",
          metadata: { reason: result.error || "unknown" },
          ipAddress,
          result: "fail",
        });
        return redirect(errUrl("connect", result.error || undefined));
      }

      await activityService.log({
        actorId: admin.id,
        action: "bot_webhook_connected",
        targetType: "bot_webhook",
        metadata: { url: result.url, pendingUpdates: result.pendingUpdates },
        ipAddress,
        result: "success",
      });

      return redirect(okUrl("connected", { pending: String(result.pendingUpdates ?? 0) }));
    }

    return redirect("/admin/bot?err=unknown_action");
  } catch {
    // Anything unexpected (D1 failure, audit write failure) is a flash, not a stack trace.
    return redirect("/admin/bot?err=action");
  }
}

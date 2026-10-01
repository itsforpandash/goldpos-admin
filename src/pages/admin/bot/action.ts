import type { APIContext } from "astro";
import { ActivityService } from "@/lib/services/activity";
import { getClientIp } from "@/lib/session-helpers";
import { resolveBotConnection, type BotEnv } from "@/lib/bot-client";
import { BOT_CONNECTION_KEYS, SETTING_KEYS, SettingsService } from "@/lib/services/settings";
import { TelegramBotApi } from "@/lib/telegram/bot-api";
import { resolveBotToken } from "@/lib/telegram/bot-notifications";
import { getMainMenuKeyboard } from "@/lib/telegram/bot-dispatcher";

const redirect = (to: string) =>
  new Response(null, { status: 303, headers: { Location: to } });

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

const CHAT_ID = /^-?\d{1,20}$/;
const ROLES = ["super_admin", "admin", "read_only"] as const;

export async function POST({ locals, request }: APIContext) {
  const { DB } = locals.runtime.env;
  const env = locals.runtime.env as unknown as BotEnv;
  const admin = locals.SESSION;
  const ipAddress = getClientIp(request);

  if (!admin) {
    return redirect("/admin/login");
  }

  const form = await request.formData();
  const action = String(form.get("action") || "");
  const settingsService = new SettingsService(DB);
  const activityService = new ActivityService(DB);

  if (!action) {
    return redirect("/admin/bot?err=fields");
  }

  try {
    // ---------------------------------------------------------------
    // 1. ONE-CLICK SETUP & CONNECT (توکن + شناسه عددی + اتصال خودکار)
    // ---------------------------------------------------------------
    if (action === "quick_setup" || action === "connect") {
      const tokenInput = String(form.get("bot_token") || "").trim();
      const chatIdRaw = String(form.get("chat_id") || "").trim();
      const adminName = String(form.get("admin_name") || "").trim() || "مدیر اصلی";

      // Save token if provided
      if (tokenInput) {
        if (!tokenInput.includes(":") || tokenInput.length < 15) {
          return redirect(
            errUrl(
              "invalid_token",
              "فرمت توکن وارد شده معتبر نیست. توکن تلگرام باید شامل علامت : و ارقام باشد (مثال: 123456789:ABCdefGhI...).",
            ),
          );
        }
        await settingsService.set(SETTING_KEYS.BOT_TOKEN, tokenInput, admin.id);
      }

      // Check effective token
      const token = await resolveBotToken(DB, env);
      if (!token) {
        return redirect(
          errUrl(
            "no_token",
            "توکن ربات تلگرام وارد نشده است. لطفاً توکن دریافتی از @BotFather را در کادر زیر وارد فرمایید.",
          ),
        );
      }

      // Save admin chat_id if provided
      let registeredChatId: number | null = null;
      if (chatIdRaw) {
        if (!CHAT_ID.test(chatIdRaw)) {
          return redirect(
            errUrl(
              "invalid_chat_id",
              "شناسه عددی تلگرام باید فقط شامل عدد باشد (مثال: 123456789). برای دریافت آن به ربات @userinfobot مراجعه کنید.",
            ),
          );
        }
        registeredChatId = Number(chatIdRaw);
        await DB.prepare(
          `INSERT INTO bot_admins (chat_id, full_name, role, is_active)
           VALUES (?, ?, 'super_admin', 1)
           ON CONFLICT(chat_id) DO UPDATE SET
             full_name = excluded.full_name,
             is_active = 1,
             role = 'super_admin',
             updated_at = CURRENT_TIMESTAMP`,
        )
          .bind(registeredChatId, adminName)
          .run();
      }

      // Register Webhook to current server
      const bot = new TelegramBotApi(token);
      const url = new URL(request.url);
      const webhookUrl = `${url.origin}/api/bot/webhook`;

      const secretToken = (await settingsService.get(SETTING_KEYS.BOT_WEBHOOK_SECRET)) || undefined;
      const setRes = await bot.setWebhook(webhookUrl, secretToken);

      if (!setRes.ok) {
        await activityService.log({
          actorId: admin.id,
          action: "bot_webhook_connect_failed",
          targetType: "bot_webhook",
          metadata: { reason: setRes.description || "unknown" },
          ipAddress,
          result: "fail",
        });
        return redirect(
          errUrl(
            "connect_failed",
            `خطا در ثبت وب‌هوک در سرور تلگرام: ${setRes.description || "توکن نامعتبر است"}`,
          ),
        );
      }

      // If chat_id is known, send immediate welcome message to verify!
      let welcomeSent = false;
      const targetChat = registeredChatId || (await DB.prepare(`SELECT chat_id FROM bot_admins WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1`).first<{ chat_id: number }>())?.chat_id;

      if (targetChat) {
        try {
          const welcomeText = `
🎉 <b>تبریک! ربات هوشمند GoldPOS با موفقیت فعال و متصل شد.</b>
━━━━━━━━━━━━━━━━━━━━
👋 درود بر شما، ارتباط سیستم با حساب تلگرام شما برقرار شد.

از این پس ناتیفیکیشن درخواست‌های ثبت‌نام مشتریان به این چت ارسال می‌شود و با کلیدهای شیشه‌ای زیر می‌توانید به سرعت سامانه را مدیریت فرمایید:
`.trim();

          const sendRes = await bot.sendMessage(targetChat, welcomeText, {
            parse_mode: "HTML",
            reply_markup: getMainMenuKeyboard(),
          });
          if (sendRes.ok) welcomeSent = true;
        } catch (msgErr) {
          console.warn("[bot-action] Welcome message error:", msgErr);
        }
      }

      await activityService.log({
        actorId: admin.id,
        action: "bot_webhook_connected",
        targetType: "bot_webhook",
        metadata: { url: webhookUrl, welcomeSent },
        ipAddress,
        result: "success",
      });

      return redirect(
        okUrl(welcomeSent ? "connected_and_verified" : "connected"),
      );
    }

    // ---------------------------------------------------------------
    // 2. SEND TEST MESSAGE
    // ---------------------------------------------------------------
    if (action === "test_message") {
      const token = await resolveBotToken(DB, env);
      if (!token) return redirect(errUrl("no_token", "توکن ربات تنظیم نشده است."));

      const bot = new TelegramBotApi(token);
      const adminRow = await DB.prepare(
        `SELECT chat_id, full_name FROM bot_admins WHERE is_active = 1 ORDER BY is_active DESC LIMIT 1`,
      ).first<{ chat_id: number; full_name?: string }>();

      if (!adminRow?.chat_id) {
        return redirect(
          errUrl("no_admin", "هنوز هیچ شناسه عددی تلگرامی در لیست مدیران ثبت نشده است."),
        );
      }

      const res = await bot.sendMessage(
        adminRow.chat_id,
        `
⚡ <b>پیام تست ارتباط ربات GoldPOS</b>
━━━━━━━━━━━━━━━━━━━━
این پیام جهت بررسی ارتباط موفق بین پنل وب و حساب تلگرام شما ارسال شده است.
⏰ <b>زمان تست:</b> ${new Date().toLocaleTimeString("fa-IR")}
━━━━━━━━━━━━━━━━━━━━
<i>دکمه‌های شیشه‌ای زیر آماده استفاده هستند:</i>
`.trim(),
        {
          parse_mode: "HTML",
          reply_markup: getMainMenuKeyboard(),
        },
      );

      if (!res.ok) {
        return redirect(
          errUrl(
            "test_failed",
            `ارسال پیام به شناسه ${adminRow.chat_id} ناموفق بود: ${res.description || "ربات استارت نشده است"}`,
          ),
        );
      }

      return redirect(okUrl("test_sent"));
    }

    // ---------------------------------------------------------------
    // 3. DISCONNECT WEBHOOK
    // ---------------------------------------------------------------
    if (action === "disconnect") {
      const token = await resolveBotToken(DB, env);
      if (token) {
        const bot = new TelegramBotApi(token);
        await bot.deleteWebhook(false);
      }
      return redirect(okUrl("disconnected"));
    }

    // ---------------------------------------------------------------
    // 4. ADD / TOGGLE / REMOVE ADMINS
    // ---------------------------------------------------------------
    const chatIdRaw = String(form.get("chat_id") || "").trim();

    if (action === "add") {
      const fullName = String(form.get("full_name") || "").trim();
      const role = String(form.get("role") || "").trim();

      if (!CHAT_ID.test(chatIdRaw) || !ROLES.includes(role as (typeof ROLES)[number])) {
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

    return redirect("/admin/bot?err=unknown_action");
  } catch {
    return redirect("/admin/bot?err=action");
  }
}

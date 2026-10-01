import { TelegramBotApi } from "./bot-api";
import { SETTING_KEYS } from "@/lib/services/settings";

export async function resolveBotToken(DB: D1Database, env?: any): Promise<string> {
  const envToken = env?.TELEGRAM_BOT_TOKEN || env?.BOT_TOKEN;
  if (envToken && typeof envToken === "string" && envToken.trim().length > 10) {
    return envToken.trim();
  }

  try {
    const row = await DB.prepare(`SELECT value FROM settings WHERE key = ?`).bind(SETTING_KEYS.BOT_TOKEN).first<{ value: string }>();
    if (row?.value && row.value.trim().length > 10) {
      return row.value.trim();
    }
  } catch (err) {
    console.warn("[bot-token] Failed reading token from settings:", err);
  }

  return "";
}

export interface SignupNotificationData {
  id: number;
  contact: string;
  contactType?: string;
  fullName?: string | null;
  planName?: string | null;
  planId?: number | null;
  note?: string | null;
  createdAt?: string;
}

export async function notifyAdminsOfSignup(
  DB: D1Database,
  env: any,
  signup: SignupNotificationData,
): Promise<{ sent: number; errors: number }> {
  const token = await resolveBotToken(DB, env);
  if (!token) {
    return { sent: 0, errors: 0 };
  }

  const bot = new TelegramBotApi(token);
  if (!bot.isConfigured()) return { sent: 0, errors: 0 };

  // Fetch all active bot admins
  let admins: { chat_id: number; full_name?: string }[] = [];
  try {
    const result = await DB.prepare(
      `SELECT chat_id, full_name FROM bot_admins WHERE is_active = 1`,
    ).all<any>();
    if (result.success && result.results.length) {
      admins = result.results;
    }
  } catch (err) {
    console.warn("[bot-notify] Failed querying bot admins:", err);
  }

  if (admins.length === 0) {
    return { sent: 0, errors: 0 };
  }

  const messageText = `
🔔 <b>درخواست ثبت‌نام و کد اشتراک جدید!</b>
━━━━━━━━━━━━━━━━━━━━
👤 <b>نام مشتری:</b> ${signup.fullName || "کاربر جدید"}
📞 <b>شماره تماس / ارتباط:</b> <code>${signup.contact}</code>
📦 <b>پلن درخواستی:</b> ${signup.planName || "پلن پیش‌فرض"}
${signup.note ? `📝 <b>توضیحات:</b> ${signup.note}\n` : ""}⏰ <b>زمان ثبت:</b> ${new Date().toLocaleTimeString("fa-IR")}
━━━━━━━━━━━━━━━━━━━━
<i>جهت رسیدگی سریع، روی یکی از گزینه‌های شیشه‌ای زیر کلیک نمایید:</i>
`.trim();

  const inlineKeyboard = {
    inline_keyboard: [
      [
        {
          text: "✅ تایید و صدور آنی لایسنس",
          callback_data: `cb:signup:approve:${signup.id}`,
        },
        {
          text: "❌ رد درخواست",
          callback_data: `cb:signup:reject:${signup.id}`,
        },
      ],
      [
        {
          text: "🔍 مشاهده جزئیات در پنل وب",
          callback_data: `cb:pending:page:1`,
        },
      ],
    ],
  };

  let sent = 0;
  let errors = 0;

  for (const admin of admins) {
    try {
      const res = await bot.sendMessage(admin.chat_id, messageText, {
        parse_mode: "HTML",
        reply_markup: inlineKeyboard,
      });
      if (res.ok) sent++;
      else errors++;
    } catch {
      errors++;
    }
  }

  return { sent, errors };
}

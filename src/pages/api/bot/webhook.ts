import type { APIContext } from "astro";
import { handleTelegramUpdate } from "@/lib/telegram/bot-dispatcher";
import { TelegramBotApi } from "@/lib/telegram/bot-api";
import { resolveBotToken } from "@/lib/telegram/bot-notifications";
import { SETTING_KEYS, SettingsService } from "@/lib/services/settings";

export async function POST({ locals, request }: APIContext) {
  const env = locals?.runtime?.env || process.env;
  const DB = env?.DB;

  if (!DB) {
    return Response.json({ ok: false, message: "Database unavailable" }, { status: 500 });
  }

  // Optional: Verify telegram webhook secret token header
  const secretHeader = request.headers.get("x-telegram-bot-api-secret-token");
  if (secretHeader) {
    try {
      const settingsService = new SettingsService(DB);
      const configuredSecret = await settingsService.get(SETTING_KEYS.BOT_WEBHOOK_SECRET);
      if (configuredSecret && secretHeader !== configuredSecret) {
        console.warn("[bot-webhook] Invalid secret token header received");
        return Response.json({ ok: false, message: "Unauthorized" }, { status: 403 });
      }
    } catch (err) {
      console.warn("[bot-webhook] Secret check failed:", err);
    }
  }

  let update: any;
  try {
    update = await request.json();
  } catch {
    return Response.json({ ok: false, message: "Invalid JSON" }, { status: 400 });
  }

  try {
    await handleTelegramUpdate(update, DB, env);
  } catch (err: any) {
    console.error("[bot-webhook] Handler error:", err?.message || err);
  }

  // Telegram expects 200 OK
  return Response.json({ ok: true }, { status: 200 });
}

export async function GET({ locals }: APIContext) {
  const env = locals?.runtime?.env || process.env;
  const DB = env?.DB;

  if (!DB) {
    return Response.json({ ok: false, message: "Database unavailable" }, { status: 500 });
  }

  const token = await resolveBotToken(DB, env);
  if (!token) {
    return Response.json({
      ok: false,
      configured: false,
      message: "توکن ربات تلگرام هنوز تنظیم نشده است. می‌توانید آن را در بخش تنظیمات پنل وب وارد فرمایید.",
    });
  }

  const bot = new TelegramBotApi(token);
  const [me, webhookInfo] = await Promise.all([
    bot.getMe(),
    bot.getWebhookInfo(),
  ]);

  return Response.json({
    ok: true,
    configured: true,
    bot: me.result || null,
    webhook: webhookInfo.result || null,
  });
}

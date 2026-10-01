import type { APIContext } from "astro";
import { TelegramBotApi } from "@/lib/telegram/bot-api";
import { resolveBotToken } from "@/lib/telegram/bot-notifications";
import { handleTelegramUpdate } from "@/lib/telegram/bot-dispatcher";

export async function GET({ locals, request }: APIContext) {
  const env = locals?.runtime?.env || process.env;
  const DB = env?.DB;

  if (!DB) {
    return Response.json({ ok: false, error: "Database unavailable" }, { status: 500 });
  }

  const token = await resolveBotToken(DB, env);
  if (!token) {
    return Response.json({ ok: false, error: "No bot token configured" }, { status: 400 });
  }

  const bot = new TelegramBotApi(token);
  const updatesRes = await bot.getUpdates();

  if (!updatesRes.ok || !updatesRes.result) {
    return Response.json({
      ok: false,
      error: updatesRes.description || "Failed to fetch updates",
    });
  }

  const updates = updatesRes.result;
  let processedCount = 0;
  let lastUpdateId = 0;

  for (const update of updates) {
    try {
      await handleTelegramUpdate(update, DB, env);
      processedCount++;
      if (update.update_id) {
        lastUpdateId = Math.max(lastUpdateId, update.update_id);
      }
    } catch (err) {
      console.warn("[bot-poll] Error processing update:", err);
    }
  }

  // Acknowledge updates by setting offset to lastUpdateId + 1
  if (lastUpdateId > 0) {
    await bot.getUpdates(lastUpdateId + 1, 1, 0);
  }

  const url = new URL(request.url);
  if (url.searchParams.get("redirect") === "1") {
    return new Response(null, {
      status: 303,
      headers: {
        Location: `/admin/bot?ok=polled&count=${processedCount}`,
      },
    });
  }

  return Response.json({
    ok: true,
    processed: processedCount,
    total: updates.length,
  });
}

export const POST = GET;

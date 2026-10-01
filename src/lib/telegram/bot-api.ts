/**
 * Telegram Bot API client for Cloudflare Workers & Astro.
 * Strictly dependency-free, uses native fetch and FormData.
 */

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export type InlineKeyboardMarkup = {
  inline_keyboard: InlineKeyboardButton[][];
};

export interface SendMessageOptions {
  parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
  reply_markup?: InlineKeyboardMarkup | { remove_keyboard: true } | any;
  disable_web_page_preview?: boolean;
}

export interface TelegramApiResponse<T = any> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

const TELEGRAM_API_BASE = "https://api.telegram.org";

export class TelegramBotApi {
  private token: string;

  constructor(token: string) {
    this.token = token.trim();
  }

  isConfigured(): boolean {
    return Boolean(this.token && this.token.length > 10 && this.token.includes(":"));
  }

  private async call<T = any>(method: string, payload: any): Promise<TelegramApiResponse<T>> {
    if (!this.isConfigured()) {
      return { ok: false, description: "Telegram bot token is not configured" };
    }

    try {
      const url = `${TELEGRAM_API_BASE}/bot${this.token}/${method}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await response.json().catch(() => ({}))) as TelegramApiResponse<T>;
      return data;
    } catch (err: any) {
      console.warn(`[telegram-bot-api] ${method} failed:`, err?.message || err);
      return { ok: false, description: err?.message || "Network error" };
    }
  }

  async getMe(): Promise<TelegramApiResponse<any>> {
    return this.call("getMe", {});
  }

  async getWebhookInfo(): Promise<TelegramApiResponse<any>> {
    return this.call("getWebhookInfo", {});
  }

  async setWebhook(url: string, secretToken?: string): Promise<TelegramApiResponse<any>> {
    return this.call("setWebhook", {
      url,
      secret_token: secretToken || undefined,
      drop_pending_updates: false,
      allowed_updates: ["message", "callback_query"],
    });
  }

  async deleteWebhook(dropPending = false): Promise<TelegramApiResponse<any>> {
    return this.call("deleteWebhook", { drop_pending_updates: dropPending });
  }

  async sendMessage(
    chatId: number | string,
    text: string,
    options: SendMessageOptions = {},
  ): Promise<TelegramApiResponse<any>> {
    return this.call("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: options.parse_mode ?? "HTML",
      disable_web_page_preview: options.disable_web_page_preview ?? true,
      reply_markup: options.reply_markup,
    });
  }

  async editMessageText(
    chatId: number | string,
    messageId: number,
    text: string,
    options: SendMessageOptions = {},
  ): Promise<TelegramApiResponse<any>> {
    return this.call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: options.parse_mode ?? "HTML",
      disable_web_page_preview: options.disable_web_page_preview ?? true,
      reply_markup: options.reply_markup,
    });
  }

  async answerCallbackQuery(
    callbackQueryId: string,
    options: { text?: string; show_alert?: boolean; url?: string } = {},
  ): Promise<TelegramApiResponse<any>> {
    return this.call("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text: options.text,
      show_alert: options.show_alert,
      url: options.url,
    });
  }

  async sendDocument(
    chatId: number | string,
    content: string | Uint8Array,
    filename: string,
    caption?: string,
  ): Promise<TelegramApiResponse<any>> {
    if (!this.isConfigured()) {
      return { ok: false, description: "Telegram bot token is not configured" };
    }

    try {
      const formData = new FormData();
      formData.set("chat_id", String(chatId));
      if (caption) {
        formData.set("caption", caption);
        formData.set("parse_mode", "HTML");
      }

      const blob =
        typeof content === "string"
          ? new Blob([content], { type: "application/json;charset=utf-8" })
          : new Blob([content], { type: "application/octet-stream" });

      formData.set("document", blob, filename);

      const url = `${TELEGRAM_API_BASE}/bot${this.token}/sendDocument`;
      const response = await fetch(url, {
        method: "POST",
        body: formData,
      });

      return (await response.json().catch(() => ({}))) as TelegramApiResponse<any>;
    } catch (err: any) {
      console.warn("[telegram-bot-api] sendDocument failed:", err?.message || err);
      return { ok: false, description: err?.message || "Network error" };
    }
  }
}

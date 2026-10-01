import { TelegramBotApi, type InlineKeyboardButton } from "./bot-api";
import { resolveBotToken } from "./bot-notifications";
import { UserService } from "@/lib/services/user";
import { PlanService } from "@/lib/services/plan";
import { LicenseService } from "@/lib/services/license";
import { DeviceService } from "@/lib/services/device";
import { GalleryService } from "@/lib/services/gallery";
import { SignupService } from "@/lib/services/signup";
import { BackupService } from "@/lib/services/backup";
import { toPersianDigits, formatPersianDate } from "@/lib/i18n";

interface BotContext {
  bot: TelegramBotApi;
  DB: D1Database;
  env: any;
  chatId: number;
  messageId?: number;
  admin: { chat_id: number; full_name?: string; role: string };
}

// ------------------------------------------------------------------
// Main Menu Markup
// ------------------------------------------------------------------
export function getMainMenuKeyboard(): { inline_keyboard: InlineKeyboardButton[][] } {
  return {
    inline_keyboard: [
      [
        { text: "📊 آمار و وضعیت سیستم", callback_data: "cb:stats" },
        { text: "👑 لیست لایسنس‌ها", callback_data: "cb:licenses:1" },
      ],
      [
        { text: "👥 مدیریت کاربران", callback_data: "cb:users:1" },
        { text: "📱 دستگاه‌های متصل", callback_data: "cb:devices:1" },
      ],
      [
        { text: "➕ صدور لایسنس جدید", callback_data: "cb:new_license:start" },
        { text: "➕ افزودن کاربر جدید", callback_data: "cb:new_user:start" },
      ],
      [
        { text: "🏛 گالری‌های طلا", callback_data: "cb:galleries:1" },
        { text: "📥 درخواست‌های اشتراک", callback_data: "cb:pending:1" },
      ],
      [
        { text: "💾 دانلود فایل پشتیبان دیتابیس", callback_data: "cb:backup:export" },
      ],
      [
        { text: "🔄 بروزرسانی منو", callback_data: "cb:main_menu" },
      ],
    ],
  };
}

export function getBackToMenuButton(): InlineKeyboardButton[] {
  return [{ text: "🔙 بازگشت به منوی اصلی", callback_data: "cb:main_menu" }];
}

// ------------------------------------------------------------------
// Session Helpers (bot_sessions table)
// ------------------------------------------------------------------
async function getSession(DB: D1Database, chatId: number): Promise<{ flow: string; state: any } | null> {
  try {
    const row = await DB.prepare(
      `SELECT flow, state FROM bot_sessions WHERE chat_id = ? AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1`,
    )
      .bind(chatId)
      .first<{ flow: string; state: string }>();

    if (row && row.state) {
      return { flow: row.flow, state: JSON.parse(row.state) };
    }
  } catch (err) {
    console.warn("[bot-session] getSession error:", err);
  }
  return null;
}

async function setSession(DB: D1Database, chatId: number, flow: string, state: any, ttlMinutes = 20): Promise<void> {
  try {
    await clearSession(DB, chatId);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
    await DB.prepare(
      `INSERT INTO bot_sessions (chat_id, flow, state, expires_at) VALUES (?, ?, ?, ?)`,
    )
      .bind(chatId, flow, JSON.stringify(state), expiresAt)
      .run();
  } catch (err) {
    console.warn("[bot-session] setSession error:", err);
  }
}

async function clearSession(DB: D1Database, chatId: number): Promise<void> {
  try {
    await DB.prepare(`DELETE FROM bot_sessions WHERE chat_id = ?`).bind(chatId).run();
  } catch (err) {
    console.warn("[bot-session] clearSession error:", err);
  }
}

// ------------------------------------------------------------------
// Auth & Whitelist Check
// ------------------------------------------------------------------
async function checkAuth(
  DB: D1Database,
  chatId: number,
  sender: { first_name?: string; last_name?: string; username?: string },
): Promise<{ authorized: boolean; admin?: any }> {
  try {
    // 1. Check if chat_id is in bot_admins
    const admin = await DB.prepare(
      `SELECT chat_id, full_name, telegram_username, role, is_active FROM bot_admins WHERE chat_id = ?`,
    )
      .bind(chatId)
      .first<any>();

    if (admin) {
      if (admin.is_active) {
        // Touch last_command_at
        await DB.prepare(
          `UPDATE bot_admins SET last_command_at = CURRENT_TIMESTAMP WHERE chat_id = ?`,
        )
          .bind(chatId)
          .run();
        return { authorized: true, admin };
      }
      return { authorized: false };
    }

    // 2. If table is empty, auto-bootstrap the FIRST user as super_admin!
    const countRow = await DB.prepare(`SELECT COUNT(*) as count FROM bot_admins`).first<{ count: number }>();
    if ((countRow?.count ?? 0) === 0) {
      const fullName = [sender.first_name, sender.last_name].filter(Boolean).join(" ") || "مدیر اصلی";
      await DB.prepare(
        `INSERT INTO bot_admins (chat_id, telegram_username, full_name, role, is_active) VALUES (?, ?, ?, 'super_admin', 1)`,
      )
        .bind(chatId, sender.username || null, fullName)
        .run();

      const newAdmin = { chat_id: chatId, full_name: fullName, role: "super_admin", is_active: 1 };
      return { authorized: true, admin: newAdmin };
    }
  } catch (err) {
    console.warn("[bot-auth] Error checking auth:", err);
  }

  return { authorized: false };
}

// ------------------------------------------------------------------
// Core Dispatcher
// ------------------------------------------------------------------
export async function handleTelegramUpdate(update: any, DB: D1Database, env: any): Promise<void> {
  const token = await resolveBotToken(DB, env);
  if (!token) {
    console.warn("[bot-dispatcher] No bot token configured.");
    return;
  }

  const bot = new TelegramBotApi(token);

  // 1. Handle incoming message
  if (update.message) {
    const msg = update.message;
    const chatId = msg.chat?.id;
    if (!chatId) return;

    const auth = await checkAuth(DB, chatId, msg.from || {});
    if (!auth.authorized) {
      const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || "کاربر";
      await bot.sendMessage(
        chatId,
        `
⛔ <b>دسترسی غیرمجاز به پنل مدیریت</b>
━━━━━━━━━━━━━━━━━━━━
سلام ${name} عزیز؛
شناسه کاربری شما در فهرست مدیران مجاز سیستم ثبت نشده است.

🆔 <b>شناسه عددی شما:</b> <code>${chatId}</code>
${msg.from?.username ? `👤 <b>نام کاربری:</b> @${msg.from.username}\n` : ""}
<i>جهت دسترسی، شناسه بالا را در پنل وب به آدرس مدیریت ربات اضافه فرمایید.</i>
`.trim(),
        {
          parse_mode: "HTML",
        },
      );
      return;
    }

    const ctx: BotContext = { bot, DB, env, chatId, admin: auth.admin! };
    const text = String(msg.text || "").trim();

    // Check wizard state
    const session = await getSession(DB, chatId);
    if (session && text && !text.startsWith("/")) {
      const handled = await handleWizardTextInput(ctx, session, text);
      if (handled) return;
    }

    // Commands router
    if (text === "/start" || text === "/menu") {
      await clearSession(DB, chatId);
      await sendMainMenu(ctx, true);
    } else if (text === "/stats") {
      await sendStats(ctx);
    } else if (text === "/licenses") {
      await sendLicensesList(ctx, 1);
    } else if (text === "/users") {
      await sendUsersList(ctx, 1);
    } else if (text === "/new_license") {
      await startNewLicenseWizard(ctx);
    } else if (text === "/new_user") {
      await startNewUserWizard(ctx);
    } else if (text === "/devices") {
      await sendDevicesList(ctx, 1);
    } else if (text === "/galleries") {
      await sendGalleriesList(ctx, 1);
    } else if (text === "/pending") {
      await sendPendingSignups(ctx, 1);
    } else if (text === "/backup") {
      await sendBackupDocument(ctx);
    } else if (text === "/cancel") {
      await clearSession(DB, chatId);
      await bot.sendMessage(chatId, "✅ فرآیند لغو شد و به حالت عادی بازگشتید.", {
        reply_markup: getMainMenuKeyboard(),
      });
    } else {
      await sendMainMenu(ctx, false);
    }
    return;
  }

  // 2. Handle callback queries (inline buttons)
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message?.chat?.id;
    const messageId = cb.message?.message_id;
    const data = String(cb.data || "");

    if (!chatId) return;

    await bot.answerCallbackQuery(cb.id);

    const auth = await checkAuth(DB, chatId, cb.from || {});
    if (!auth.authorized) {
      await bot.sendMessage(chatId, "⛔ دسترسی شما غیرمجاز است.");
      return;
    }

    const ctx: BotContext = { bot, DB, env, chatId, messageId, admin: auth.admin! };

    await handleCallbackAction(ctx, data);
  }
}

// ------------------------------------------------------------------
// Callback Queries Router
// ------------------------------------------------------------------
async function handleCallbackAction(ctx: BotContext, data: string): Promise<void> {
  const parts = data.split(":");
  const action = parts[1] || "";

  if (action === "main_menu") {
    await clearSession(ctx.DB, ctx.chatId);
    await sendMainMenu(ctx, true);
  } else if (action === "stats") {
    await sendStats(ctx);
  } else if (action === "licenses") {
    const page = Number(parts[2]) || 1;
    await sendLicensesList(ctx, page);
  } else if (action === "license_view") {
    const id = Number(parts[2]);
    await sendLicenseDetails(ctx, id);
  } else if (action === "license_extend") {
    const id = Number(parts[2]);
    await extendLicense(ctx, id);
  } else if (action === "license_revoke") {
    const id = Number(parts[2]);
    await revokeLicense(ctx, id);
  } else if (action === "users") {
    const page = Number(parts[2]) || 1;
    await sendUsersList(ctx, page);
  } else if (action === "user_view") {
    const id = Number(parts[2]);
    await sendUserDetails(ctx, id);
  } else if (action === "devices") {
    const page = Number(parts[2]) || 1;
    await sendDevicesList(ctx, page);
  } else if (action === "device_toggle") {
    const id = Number(parts[2]);
    await toggleDevice(ctx, id);
  } else if (action === "galleries") {
    const page = Number(parts[2]) || 1;
    await sendGalleriesList(ctx, page);
  } else if (action === "pending") {
    const page = Number(parts[2]) || 1;
    await sendPendingSignups(ctx, page);
  } else if (action === "signup") {
    const subAction = parts[2];
    const signupId = Number(parts[3]);
    if (subAction === "approve") {
      await approveSignup(ctx, signupId);
    } else if (subAction === "reject") {
      await rejectSignup(ctx, signupId);
    }
  } else if (action === "backup" && parts[2] === "export") {
    await sendBackupDocument(ctx);
  } else if (action === "new_user" && parts[2] === "start") {
    await startNewUserWizard(ctx);
  } else if (action === "new_license") {
    await handleNewLicenseWizardSteps(ctx, parts);
  } else if (action === "cancel_wizard") {
    await clearSession(ctx.DB, ctx.chatId);
    await sendMainMenu(ctx, true);
  }
}

// ------------------------------------------------------------------
// View: Main Menu
// ------------------------------------------------------------------
async function sendMainMenu(ctx: BotContext, isEdit = false): Promise<void> {
  const text = `
👑 <b>سامانه مدیریت هوشمند گلد پوز (GoldPOS)</b>
━━━━━━━━━━━━━━━━━━━━
👋 درود، <b>${ctx.admin.full_name || "مدیر گرامی"}</b>!

از طریق کلیدهای شیشه‌ای زیر می‌توانید تمام عملیات لایسنس، کاربران، درخواست‌های ثبت‌نام و پشتیبان‌گیری را به صورت منظم مدیریت فرمایید:
`.trim();

  const keyboard = getMainMenuKeyboard();

  if (isEdit && ctx.messageId) {
    await ctx.bot.editMessageText(ctx.chatId, ctx.messageId, text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  } else {
    await ctx.bot.sendMessage(ctx.chatId, text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  }
}

// ------------------------------------------------------------------
// View: System Stats
// ------------------------------------------------------------------
async function sendStats(ctx: BotContext): Promise<void> {
  const licenseService = new LicenseService(ctx.DB);
  const userService = new UserService(ctx.DB);
  const deviceService = new DeviceService(ctx.DB);
  const galleryService = new GalleryService(ctx.DB);
  const signupService = new SignupService(ctx.DB);

  const [licenses, users, devices, galleries, signupsCount] = await Promise.all([
    licenseService.getAll(),
    userService.getAll(),
    deviceService.getAll(),
    galleryService.getAll(),
    signupService.getCounts(),
  ]);

  const activeLicenses = licenses.filter((l: any) => l.status === "active").length;
  const unusedLicenses = licenses.filter((l: any) => l.status === "unused").length;
  const expiredLicenses = licenses.filter((l: any) => l.status === "expired").length;
  const activeDevices = devices.filter((d: any) => d.status === "active").length;

  const text = `
📊 <b>گزارش و آمار وضعیت سیستم</b>
━━━━━━━━━━━━━━━━━━━━
👥 <b>کل کاربران:</b> ${toPersianDigits(users.length)} نفر
👑 <b>کل لایسنس‌ها:</b> ${toPersianDigits(licenses.length)} عدد
  ├ 🟢 فعال: ${toPersianDigits(activeLicenses)}
  ├ 🔵 استفاده‌نشده: ${toPersianDigits(unusedLicenses)}
  └ 🔴 منقضی / لغو: ${toPersianDigits(expiredLicenses)}

📱 <b>دستگاه‌های ثبت‌شده:</b> ${toPersianDigits(devices.length)} عدد (${toPersianDigits(activeDevices)} فعال)
🏛 <b>گالری‌های طلا:</b> ${toPersianDigits(galleries.length)} گالری
📥 <b>درخواست‌های در انتظار بررسی:</b> ${toPersianDigits(signupsCount.pending)} درخواست
━━━━━━━━━━━━━━━━━━━━
<i>زمان آخرین استعلام: ${new Date().toLocaleTimeString("fa-IR")}</i>
`.trim();

  const keyboard = {
    inline_keyboard: [
      [
        { text: "🔄 بروزرسانی آمار", callback_data: "cb:stats" },
        { text: "📥 بررسی درخواست‌ها", callback_data: "cb:pending:1" },
      ],
      getBackToMenuButton(),
    ],
  };

  if (ctx.messageId) {
    await ctx.bot.editMessageText(ctx.chatId, ctx.messageId, text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  } else {
    await ctx.bot.sendMessage(ctx.chatId, text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  }
}

// ------------------------------------------------------------------
// View: Licenses List & Actions
// ------------------------------------------------------------------
async function sendLicensesList(ctx: BotContext, page: number): Promise<void> {
  const licenseService = new LicenseService(ctx.DB);
  const allLicenses = await licenseService.getAll();

  const pageSize = 5;
  const totalPages = Math.ceil(allLicenses.length / pageSize) || 1;
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const start = (currentPage - 1) * pageSize;
  const items = allLicenses.slice(start, start + pageSize);

  let text = `👑 <b>فهرست لایسنس‌ها (صفحه ${toPersianDigits(currentPage)} از ${toPersianDigits(totalPages)})</b>\n━━━━━━━━━━━━━━━━━━━━\n`;

  if (allLicenses.length === 0) {
    text += "<i>هنوز هیچ لایسنسی در سیستم ثبت نشده است. از منو گزینه «صدور لایسنس جدید» را انتخاب کنید.</i>";
  }

  const buttons: InlineKeyboardButton[][] = [];

  for (const item of items) {
    const statusEmoji = item.status === "active" ? "🟢" : item.status === "unused" ? "🔵" : "🔴";
    text += `${statusEmoji} <code>${item.code}</code>\n`;
    text += `  👤 کاربر: ${item.user_name || "—"} | پلن: ${item.plan_name || "طلایی"}\n`;
    text += `  ⏳ انقضا: ${formatPersianDate(item.expires_at)}\n\n`;

    buttons.push([
      {
        text: `🔍 مدیریت لایسنس ${item.code}`,
        callback_data: `cb:license_view:${item.id}`,
      },
    ]);
  }

  // Pagination row
  const navRow: InlineKeyboardButton[] = [];
  if (currentPage > 1) {
    navRow.push({ text: "◀️ قبلی", callback_data: `cb:licenses:${currentPage - 1}` });
  }
  if (currentPage < totalPages) {
    navRow.push({ text: "بعدی ▶️", callback_data: `cb:licenses:${currentPage + 1}` });
  }
  if (navRow.length) buttons.push(navRow);

  buttons.push([
    { text: "➕ صدور لایسنس جدید", callback_data: "cb:new_license:start" },
  ]);
  buttons.push(getBackToMenuButton());

  if (ctx.messageId) {
    await ctx.bot.editMessageText(ctx.chatId, ctx.messageId, text.trim(), {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buttons },
    });
  } else {
    await ctx.bot.sendMessage(ctx.chatId, text.trim(), {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buttons },
    });
  }
}

async function sendLicenseDetails(ctx: BotContext, id: number): Promise<void> {
  const licenseService = new LicenseService(ctx.DB);
  const license = await licenseService.getById(id);

  if (!license) {
    await ctx.bot.sendMessage(ctx.chatId, "❌ لایسنس مورد نظر یافت نشد.");
    return;
  }

  const statusText =
    license.status === "active"
      ? "🟢 فعال"
      : license.status === "unused"
      ? "🔵 استفاده نشده"
      : license.status === "expired"
      ? "🔴 منقضی"
      : "⚪ لغو شده";

  const text = `
👑 <b>اطلاعات لایسنس ${license.code}</b>
━━━━━━━━━━━━━━━━━━━━
🔑 <b>کد لایسنس:</b> <code>${license.code}</code>
📊 <b>وضعیت:</b> ${statusText}
👤 <b>کاربر:</b> ${license.user_name || "—"}
📦 <b>پلن:</b> ${license.plan_name || "طلایی"}
📱 <b>سقف دستگاه:</b> ${toPersianDigits(license.max_devices)} دستگاه
⏳ <b>تاریخ انقضا:</b> ${formatPersianDate(license.expires_at)}
━━━━━━━━━━━━━━━━━━━━
<i>جهت اعمال تغییرات از دکمه‌های زیر استفاده نمایید:</i>
`.trim();

  const keyboard = {
    inline_keyboard: [
      [
        { text: "➕ تمدید ۳۰ روزه", callback_data: `cb:license_extend:${license.id}` },
        { text: license.status === "revoked" ? "🟢 فعال‌سازی مجدد" : "🚫 لغو لایسنس", callback_data: `cb:license_revoke:${license.id}` },
      ],
      [
        { text: "📋 کپی کد لایسنس", callback_data: `cb:license_view:${license.id}` },
        { text: "◀️ بازگشت به لیست", callback_data: "cb:licenses:1" },
      ],
      getBackToMenuButton(),
    ],
  };

  if (ctx.messageId) {
    await ctx.bot.editMessageText(ctx.chatId, ctx.messageId, text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  } else {
    await ctx.bot.sendMessage(ctx.chatId, text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  }
}

async function extendLicense(ctx: BotContext, id: number): Promise<void> {
  const licenseService = new LicenseService(ctx.DB);
  await licenseService.extend(id, 30);
  await sendLicenseDetails(ctx, id);
}

async function revokeLicense(ctx: BotContext, id: number): Promise<void> {
  const licenseService = new LicenseService(ctx.DB);
  const license = await licenseService.getById(id);
  if (!license) return;

  if (license.status === "revoked") {
    await ctx.DB.prepare(`UPDATE licenses SET status = 'active' WHERE id = ?`).bind(id).run();
  } else {
    await licenseService.revoke(id);
  }
  await sendLicenseDetails(ctx, id);
}

// ------------------------------------------------------------------
// View: Users List & Details
// ------------------------------------------------------------------
async function sendUsersList(ctx: BotContext, page: number): Promise<void> {
  const userService = new UserService(ctx.DB);
  const allUsers = await userService.getAll();

  const pageSize = 5;
  const totalPages = Math.ceil(allUsers.length / pageSize) || 1;
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const start = (currentPage - 1) * pageSize;
  const items = allUsers.slice(start, start + pageSize);

  let text = `👥 <b>فهرست کاربران سامانه (صفحه ${toPersianDigits(currentPage)} از ${toPersianDigits(totalPages)})</b>\n━━━━━━━━━━━━━━━━━━━━\n`;

  if (allUsers.length === 0) {
    text += "<i>هنوز هیچ کاربری در سیستم ثبت نشده است.</i>";
  }

  const buttons: InlineKeyboardButton[][] = [];

  for (const u of items) {
    text += `👤 <b>${u.full_name}</b>\n`;
    text += `  📞 تماس: <code>${u.phone}</code> | شناسه: ${u.username}\n\n`;

    buttons.push([
      { text: `👤 مشاهده ${u.full_name}`, callback_data: `cb:user_view:${u.id}` },
      { text: "➕ صدور لایسنس", callback_data: `cb:new_license:user:${u.id}` },
    ]);
  }

  // Pagination row
  const navRow: InlineKeyboardButton[] = [];
  if (currentPage > 1) {
    navRow.push({ text: "◀️ قبلی", callback_data: `cb:users:${currentPage - 1}` });
  }
  if (currentPage < totalPages) {
    navRow.push({ text: "بعدی ▶️", callback_data: `cb:users:${currentPage + 1}` });
  }
  if (navRow.length) buttons.push(navRow);

  buttons.push([
    { text: "➕ افزودن کاربر جدید", callback_data: "cb:new_user:start" },
  ]);
  buttons.push(getBackToMenuButton());

  if (ctx.messageId) {
    await ctx.bot.editMessageText(ctx.chatId, ctx.messageId, text.trim(), {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buttons },
    });
  } else {
    await ctx.bot.sendMessage(ctx.chatId, text.trim(), {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buttons },
    });
  }
}

async function sendUserDetails(ctx: BotContext, id: number): Promise<void> {
  const userService = new UserService(ctx.DB);
  const licenseService = new LicenseService(ctx.DB);
  const user = await userService.getById(id);

  if (!user) {
    await ctx.bot.sendMessage(ctx.chatId, "❌ کاربر یافت نشد.");
    return;
  }

  const allLicenses = await licenseService.getAll();
  const userLicenses = allLicenses.filter((l: any) => l.user_id === user.id);

  const text = `
👤 <b>مشخصات کاربر: ${user.full_name}</b>
━━━━━━━━━━━━━━━━━━━━
🆔 <b>شناسه کاربری:</b> <code>${user.username}</code>
📞 <b>شماره تماس:</b> <code>${user.phone}</code>
${user.email ? `📧 <b>ایمیل:</b> ${user.email}\n` : ""}📊 <b>وضعیت:</b> ${user.status === "active" ? "🟢 فعال" : "🔴 غیرفعال"}
👑 <b>تعداد لایسنس‌ها:</b> ${toPersianDigits(userLicenses.length)} عدد
📅 <b>تاریخ عضویت:</b> ${formatPersianDate(user.created_at)}
`.trim();

  const keyboard = {
    inline_keyboard: [
      [
        { text: "➕ صدور لایسنس برای این کاربر", callback_data: `cb:new_license:user:${user.id}` },
      ],
      [
        { text: "◀️ بازگشت به فهرست کاربران", callback_data: "cb:users:1" },
      ],
      getBackToMenuButton(),
    ],
  };

  if (ctx.messageId) {
    await ctx.bot.editMessageText(ctx.chatId, ctx.messageId, text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  } else {
    await ctx.bot.sendMessage(ctx.chatId, text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  }
}

// ------------------------------------------------------------------
// View: Connected Devices List
// ------------------------------------------------------------------
async function sendDevicesList(ctx: BotContext, page: number): Promise<void> {
  const deviceService = new DeviceService(ctx.DB);
  const allDevices = await deviceService.getAll();

  const pageSize = 5;
  const totalPages = Math.ceil(allDevices.length / pageSize) || 1;
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const start = (currentPage - 1) * pageSize;
  const items = allDevices.slice(start, start + pageSize);

  let text = `📱 <b>دستگاه‌های متصل به سیستم (صفحه ${toPersianDigits(currentPage)} از ${toPersianDigits(totalPages)})</b>\n━━━━━━━━━━━━━━━━━━━━\n`;

  if (allDevices.length === 0) {
    text += "<i>هنوز هیچ دستگاهی به سیستم متصل نشده است.</i>";
  }

  const buttons: InlineKeyboardButton[][] = [];

  for (const d of items) {
    const isAct = d.status === "active";
    text += `${isAct ? "🟢" : "🔴"} <b>${d.device_model || "دستگاه اندروید"}</b>\n`;
    text += `  👤 کاربر: ${d.user_name || "—"}\n`;
    text += `  🔑 لایسنس: <code>${d.license_code || "—"}</code>\n`;
    text += `  🕒 آخرین اتصال: ${formatPersianDate(d.last_connected_at)}\n\n`;

    buttons.push([
      {
        text: isAct ? `🚫 مسدودسازی این دستگاه` : `🟢 رفع مسدودی دستگاه`,
        callback_data: `cb:device_toggle:${d.id}`,
      },
    ]);
  }

  const navRow: InlineKeyboardButton[] = [];
  if (currentPage > 1) {
    navRow.push({ text: "◀️ قبلی", callback_data: `cb:devices:${currentPage - 1}` });
  }
  if (currentPage < totalPages) {
    navRow.push({ text: "بعدی ▶️", callback_data: `cb:devices:${currentPage + 1}` });
  }
  if (navRow.length) buttons.push(navRow);

  buttons.push(getBackToMenuButton());

  if (ctx.messageId) {
    await ctx.bot.editMessageText(ctx.chatId, ctx.messageId, text.trim(), {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buttons },
    });
  } else {
    await ctx.bot.sendMessage(ctx.chatId, text.trim(), {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buttons },
    });
  }
}

async function toggleDevice(ctx: BotContext, id: number): Promise<void> {
  const deviceService = new DeviceService(ctx.DB);
  const device = await deviceService.getById(id);
  if (!device) return;

  if (device.status === "active") {
    await deviceService.block(id);
  } else {
    await deviceService.unblock(id);
  }
  await sendDevicesList(ctx, 1);
}

// ------------------------------------------------------------------
// View: Gold Galleries List
// ------------------------------------------------------------------
async function sendGalleriesList(ctx: BotContext, page: number): Promise<void> {
  const galleryService = new GalleryService(ctx.DB);
  const allGalleries = await galleryService.getAll();

  const pageSize = 5;
  const totalPages = Math.ceil(allGalleries.length / pageSize) || 1;
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const start = (currentPage - 1) * pageSize;
  const items = allGalleries.slice(start, start + pageSize);

  let text = `🏛 <b>فهرست گالری‌های طلا و جواهر (صفحه ${toPersianDigits(currentPage)} از ${toPersianDigits(totalPages)})</b>\n━━━━━━━━━━━━━━━━━━━━\n`;

  if (allGalleries.length === 0) {
    text += "<i>هنوز اطلاعات گالری ثبت نشده است.</i>";
  }

  for (const g of items) {
    text += `👑 <b>${g.gallery_name}</b>\n`;
    text += `  👤 مدیریت: ${g.owner_name || "—"} | 📞 تماس: <code>${g.phone || "—"}</code>\n`;
    text += `  📍 آدرس: ${g.address || "—"}\n\n`;
  }

  const buttons: InlineKeyboardButton[][] = [];
  const navRow: InlineKeyboardButton[] = [];
  if (currentPage > 1) {
    navRow.push({ text: "◀️ قبلی", callback_data: `cb:galleries:${currentPage - 1}` });
  }
  if (currentPage < totalPages) {
    navRow.push({ text: "بعدی ▶️", callback_data: `cb:galleries:${currentPage + 1}` });
  }
  if (navRow.length) buttons.push(navRow);
  buttons.push(getBackToMenuButton());

  if (ctx.messageId) {
    await ctx.bot.editMessageText(ctx.chatId, ctx.messageId, text.trim(), {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buttons },
    });
  } else {
    await ctx.bot.sendMessage(ctx.chatId, text.trim(), {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buttons },
    });
  }
}

// ------------------------------------------------------------------
// View: Pending Signups & Instant Approval
// ------------------------------------------------------------------
async function sendPendingSignups(ctx: BotContext, page: number): Promise<void> {
  const signupService = new SignupService(ctx.DB);
  const allRequests = await signupService.getAll("pending");

  const pageSize = 4;
  const totalPages = Math.ceil(allRequests.length / pageSize) || 1;
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const start = (currentPage - 1) * pageSize;
  const items = allRequests.slice(start, start + pageSize);

  let text = `📥 <b>درخواست‌های ثبت‌نام در انتظار بررسی (${toPersianDigits(allRequests.length)} مورد)</b>\n━━━━━━━━━━━━━━━━━━━━\n`;

  if (allRequests.length === 0) {
    text += "<i>در حال حاضر هیچ درخواست جدیدی در صف انتظار نیست.</i>\n";
  }

  const buttons: InlineKeyboardButton[][] = [];

  for (const req of items) {
    text += `👤 <b>${req.full_name || "کاربر جدید"}</b>\n`;
    text += `  📞 تماس: <code>${req.contact}</code>\n`;
    text += `  📦 پلن درخواستی: ${req.plan_name || "پیش‌فرض"}\n`;
    if (req.note) text += `  📝 توضیح: ${req.note}\n`;
    text += "\n";

    buttons.push([
      { text: `✅ تایید و صدور لایسنس`, callback_data: `cb:signup:approve:${req.id}` },
      { text: `❌ رد درخواست`, callback_data: `cb:signup:reject:${req.id}` },
    ]);
  }

  const navRow: InlineKeyboardButton[] = [];
  if (currentPage > 1) {
    navRow.push({ text: "◀️ قبلی", callback_data: `cb:pending:${currentPage - 1}` });
  }
  if (currentPage < totalPages) {
    navRow.push({ text: "بعدی ▶️", callback_data: `cb:pending:${currentPage + 1}` });
  }
  if (navRow.length) buttons.push(navRow);
  buttons.push(getBackToMenuButton());

  if (ctx.messageId) {
    await ctx.bot.editMessageText(ctx.chatId, ctx.messageId, text.trim(), {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buttons },
    });
  } else {
    await ctx.bot.sendMessage(ctx.chatId, text.trim(), {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buttons },
    });
  }
}

async function approveSignup(ctx: BotContext, signupId: number): Promise<void> {
  const signupService = new SignupService(ctx.DB);
  try {
    const adminUserRow = await ctx.DB.prepare(`SELECT id FROM admin_users ORDER BY id ASC LIMIT 1`).first<{ id: number }>();
    const adminId = adminUserRow?.id || 1;

    const result = await signupService.approve({
      id: signupId,
      adminId,
    });

    const successText = `
🎉 <b>درخواست با موفقیت تایید و لایسنس صادر شد!</b>
━━━━━━━━━━━━━━━━━━━━
🔑 <b>کد لایسنس:</b> <code>${result.code}</code>
👤 <b>نام مشتری:</b> ${result.userFullName}
📞 <b>شماره تماس:</b> <code>${result.userPhone}</code>
📦 <b>پلن:</b> ${result.planName}
⏳ <b>مدت اعتبار:</b> ${toPersianDigits(result.days)} روز
━━━━━━━━━━━━━━━━━━━━
<i>کد لایسنس به صورت اختصاصی برای مشتری صادر شد.</i>
`.trim();

    await ctx.bot.sendMessage(ctx.chatId, successText, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📥 بررسی سایر درخواست‌ها", callback_data: "cb:pending:1" }],
          getBackToMenuButton(),
        ],
      },
    });
  } catch (err: any) {
    await ctx.bot.sendMessage(ctx.chatId, `❌ خطا در تایید درخواست: ${err?.message || "خطای نامشخص"}`);
  }
}

async function rejectSignup(ctx: BotContext, signupId: number): Promise<void> {
  const signupService = new SignupService(ctx.DB);
  try {
    const adminUserRow = await ctx.DB.prepare(`SELECT id FROM admin_users ORDER BY id ASC LIMIT 1`).first<{ id: number }>();
    const adminId = adminUserRow?.id || 1;
    await signupService.reject(signupId, adminId);
    await ctx.bot.sendMessage(ctx.chatId, `❌ درخواست شماره #${signupId} رد شد.`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📥 بازگشت به لیست درخواست‌ها", callback_data: "cb:pending:1" }],
          getBackToMenuButton(),
        ],
      },
    });
  } catch (err: any) {
    await ctx.bot.sendMessage(ctx.chatId, `❌ خطا در رد درخواست: ${err?.message || "خطای نامشخص"}`);
  }
}

// ------------------------------------------------------------------
// Backup Document Sender
// ------------------------------------------------------------------
async function sendBackupDocument(ctx: BotContext): Promise<void> {
  await ctx.bot.sendMessage(ctx.chatId, "⏳ در حال استخراج و ایجاد فایل پشتیبان دیتابیس...");
  try {
    const backupService = new BackupService(ctx.DB);
    const backupData = await backupService.exportAll();
    const jsonStr = JSON.stringify(backupData, null, 2);
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `goldpos-backup-${dateStr}.json`;

    const caption = `
💾 <b>پشتیبان‌گیری کامل پایگاه‌داده GoldPOS</b>
━━━━━━━━━━━━━━━━━━━━
📊 <b>تعداد کاربران:</b> ${toPersianDigits(backupData.summary.total_users)}
👑 <b>تعداد لایسنس‌ها:</b> ${toPersianDigits(backupData.summary.total_licenses)}
📱 <b>دستگاه‌ها:</b> ${toPersianDigits(backupData.summary.total_devices)}
🏛 <b>گالری‌ها:</b> ${toPersianDigits(backupData.summary.total_galleries)}
━━━━━━━━━━━━━━━━━━━━
<i>فایل JSON بالا را می‌توانید در پنل وب از بخش «پشتیبان‌گیری و بازیابی» ایمپورت نمایید.</i>
`.trim();

    await ctx.bot.sendDocument(ctx.chatId, jsonStr, filename, caption);
  } catch (err: any) {
    await ctx.bot.sendMessage(ctx.chatId, `❌ خطا در استخراج فایل پشتیبان: ${err?.message || "خطای نامشخص"}`);
  }
}

// ------------------------------------------------------------------
// Step-by-Step Wizard: Add New User
// ------------------------------------------------------------------
async function startNewUserWizard(ctx: BotContext): Promise<void> {
  await setSession(ctx.DB, ctx.chatId, "new_user_name", {});

  const text = `
➕ <b>مرحله اول: افزودن کاربر جدید</b>
━━━━━━━━━━━━━━━━━━━━
لطفاً <b>نام و نام خانوادگی مشتری یا نام گالری طلا</b> را در چت ارسال فرمایید:

<i>(جهت انصراف، عبارت /cancel را ارسال کنید یا دکمه انصراف را لمس نمایید)</i>
`.trim();

  const keyboard = {
    inline_keyboard: [[{ text: "❌ انصراف", callback_data: "cb:cancel_wizard" }]],
  };

  if (ctx.messageId) {
    await ctx.bot.editMessageText(ctx.chatId, ctx.messageId, text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  } else {
    await ctx.bot.sendMessage(ctx.chatId, text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  }
}

// ------------------------------------------------------------------
// Step-by-Step Wizard: Generate New License
// ------------------------------------------------------------------
async function startNewLicenseWizard(ctx: BotContext): Promise<void> {
  const userService = new UserService(ctx.DB);
  const users = await userService.getAll();

  if (users.length === 0) {
    await ctx.bot.sendMessage(
      ctx.chatId,
      "⚠️ هنوز هیچ کاربری در سیستم وجود ندارد. لطفاً ابتدا کاربر جدید ایجاد فرمایید.",
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "➕ افزودن کاربر جدید", callback_data: "cb:new_user:start" }],
            getBackToMenuButton(),
          ],
        },
      },
    );
    return;
  }

  // Step 1: Select User
  let text = `
👑 <b>مرحله ۱ از ۴: انتخاب کاربر برای صدور لایسنس</b>
━━━━━━━━━━━━━━━━━━━━
لطفاً کاربر مورد نظر خود را از میان گزینه‌های زیر انتخاب نمایید:
`.trim();

  const buttons: InlineKeyboardButton[][] = [];
  for (const u of users.slice(0, 8)) {
    buttons.push([
      {
        text: `👤 ${u.full_name} (${u.phone})`,
        callback_data: `cb:new_license:user:${u.id}`,
      },
    ]);
  }

  buttons.push([
    { text: "➕ ایجاد کاربر جدید برای لایسنس", callback_data: "cb:new_user:start" },
  ]);
  buttons.push([
    { text: "❌ انصراف", callback_data: "cb:cancel_wizard" },
  ]);

  if (ctx.messageId) {
    await ctx.bot.editMessageText(ctx.chatId, ctx.messageId, text, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buttons },
    });
  } else {
    await ctx.bot.sendMessage(ctx.chatId, text, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buttons },
    });
  }
}

async function handleNewLicenseWizardSteps(ctx: BotContext, parts: string[]): Promise<void> {
  const step = parts[2];
  const param = parts[3];

  if (step === "start") {
    await startNewLicenseWizard(ctx);
    return;
  }

  if (step === "user") {
    const userId = Number(param);
    const planService = new PlanService(ctx.DB);
    const plans = await planService.getAll();

    await setSession(ctx.DB, ctx.chatId, "new_license_wizard", { userId });

    const text = `
📦 <b>مرحله ۲ از ۴: انتخاب پلن اشتراک</b>
━━━━━━━━━━━━━━━━━━━━
پلن مورد نظر برای صدور لایسنس را انتخاب فرمایید:
`.trim();

    const buttons: InlineKeyboardButton[][] = [];
    for (const p of plans.filter((p: any) => p.status === "active")) {
      buttons.push([
        {
          text: `💎 ${p.name} (${toPersianDigits(p.duration_days)} روزه - ${p.price > 0 ? toPersianDigits(p.price.toLocaleString("fa-IR")) + " ریال" : "رایگان"})`,
          callback_data: `cb:new_license:plan:${p.id}`,
        },
      ]);
    }
    buttons.push([{ text: "❌ انصراف", callback_data: "cb:cancel_wizard" }]);

    await ctx.bot.editMessageText(ctx.chatId, ctx.messageId!, text, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buttons },
    });
    return;
  }

  if (step === "plan") {
    const planId = Number(param);
    const session = await getSession(ctx.DB, ctx.chatId);
    const state = session?.state || {};
    state.planId = planId;
    await setSession(ctx.DB, ctx.chatId, "new_license_wizard", state);

    const text = `
⏳ <b>مرحله ۳ از ۴: مدت زمان اعتبار لایسنس</b>
━━━━━━━━━━━━━━━━━━━━
مدت زمان اعتبار لایسنس را مشخص کنید:
`.trim();

    const buttons: InlineKeyboardButton[][] = [
      [
        { text: "۳۰ روزه (۱ ماهه)", callback_data: `cb:new_license:days:30` },
        { text: "۹۰ روزه (۳ ماهه)", callback_data: `cb:new_license:days:90` },
      ],
      [
        { text: "۱۸۰ روزه (۶ ماهه)", callback_data: `cb:new_license:days:180` },
        { text: "۳۶۵ روزه (۱ ساله VIP)", callback_data: `cb:new_license:days:365` },
      ],
      [{ text: "❌ انصراف", callback_data: "cb:cancel_wizard" }],
    ];

    await ctx.bot.editMessageText(ctx.chatId, ctx.messageId!, text, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buttons },
    });
    return;
  }

  if (step === "days") {
    const days = Number(param);
    const session = await getSession(ctx.DB, ctx.chatId);
    const state = session?.state || {};
    state.days = days;
    await setSession(ctx.DB, ctx.chatId, "new_license_wizard", state);

    const text = `
📱 <b>مرحله ۴ از ۴: سقف مجاز دستگاه‌ها</b>
━━━━━━━━━━━━━━━━━━━━
حداکثر تعداد دستگاه‌های مجاز برای اتصال همزمان با این لایسنس:
`.trim();

    const buttons: InlineKeyboardButton[][] = [
      [
        { text: "۱ دستگاه (تک صندوق)", callback_data: `cb:new_license:devices:1` },
        { text: "۲ دستگاه", callback_data: `cb:new_license:devices:2` },
      ],
      [
        { text: "۳ دستگاه", callback_data: `cb:new_license:devices:3` },
        { text: "۵ دستگاه (سازمانی)", callback_data: `cb:new_license:devices:5` },
      ],
      [{ text: "❌ انصراف", callback_data: "cb:cancel_wizard" }],
    ];

    await ctx.bot.editMessageText(ctx.chatId, ctx.messageId!, text, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buttons },
    });
    return;
  }

  if (step === "devices") {
    const devices = Number(param);
    const session = await getSession(ctx.DB, ctx.chatId);
    const state = session?.state || {};
    state.maxDevices = devices;
    await setSession(ctx.DB, ctx.chatId, "new_license_confirm", state);

    const userService = new UserService(ctx.DB);
    const planService = new PlanService(ctx.DB);

    const user = await userService.getById(state.userId);
    const plan = await planService.getById(state.planId);

    const text = `
📋 <b>پیش‌نمایش و تایید نهایی صدور لایسنس</b>
━━━━━━━━━━━━━━━━━━━━
👤 <b>کاربر گیرنده:</b> ${user?.full_name || "—"} (${user?.phone || "—"})
📦 <b>پلن انتخابی:</b> ${plan?.name || "طلایی"}
⏳ <b>مدت اعتبار:</b> ${toPersianDigits(state.days)} روز
📱 <b>سقف دستگاه‌ها:</b> ${toPersianDigits(state.maxDevices)} دستگاه
━━━━━━━━━━━━━━━━━━━━
آیا از صدور این لایسنس اطمینان دارید؟
`.trim();

    const buttons: InlineKeyboardButton[][] = [
      [
        { text: "✅ تایید نهایی و صدور آنی لایسنس", callback_data: "cb:new_license:confirm:yes" },
      ],
      [
        { text: "❌ انصراف و بازگشت", callback_data: "cb:cancel_wizard" },
      ],
    ];

    await ctx.bot.editMessageText(ctx.chatId, ctx.messageId!, text, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buttons },
    });
    return;
  }

  if (step === "confirm") {
    const session = await getSession(ctx.DB, ctx.chatId);
    const state = session?.state || {};
    await clearSession(ctx.DB, ctx.chatId);

    if (!state.userId || !state.planId) {
      await ctx.bot.sendMessage(ctx.chatId, "❌ جلسه صدور لایسنس منقضی شده است. لطفاً مجدداً اقدام فرمایید.", {
        reply_markup: getMainMenuKeyboard(),
      });
      return;
    }

    const licenseService = new LicenseService(ctx.DB);
    const result = await licenseService.generate({
      userId: state.userId,
      planId: state.planId,
      quantity: 1,
      durationDays: state.days || 30,
      maxDevices: state.maxDevices || 1,
    });

    const code = result.codes[0];

    const userService = new UserService(ctx.DB);
    const user = await userService.getById(state.userId);

    const text = `
🎉 <b>لایسنس با موفقیت صادر گردید!</b>
━━━━━━━━━━━━━━━━━━━━
👑 <b>کد لایسنس:</b> <code>${code}</code>
👤 <b>کاربر:</b> ${user?.full_name || "—"}
⏳ <b>مدت اعتبار:</b> ${toPersianDigits(state.days || 30)} روز
📱 <b>سقف دستگاه‌ها:</b> ${toPersianDigits(state.maxDevices || 1)} دستگاه
━━━━━━━━━━━━━━━━━━━━
<i>کد بالا را با لمس کپی کرده و جهت فعال‌سازی در اپلیکیشن اندروید به مشتری تحویل دهید.</i>
`.trim();

    const buttons: InlineKeyboardButton[][] = [
      [
        { text: "➕ صدور یک لایسنس دیگر", callback_data: "cb:new_license:start" },
      ],
      getBackToMenuButton(),
    ];

    await ctx.bot.editMessageText(ctx.chatId, ctx.messageId!, text, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buttons },
    });
  }
}

// ------------------------------------------------------------------
// Wizard Text Input Handler
// ------------------------------------------------------------------
async function handleWizardTextInput(ctx: BotContext, session: { flow: string; state: any }, text: string): Promise<boolean> {
  if (session.flow === "new_user_name") {
    const name = text.trim();
    if (name.length < 2) {
      await ctx.bot.sendMessage(ctx.chatId, "⚠️ نام وارد شده بسیار کوتاه است. لطفاً نام و نام خانوادگی را کامل بنویسید:");
      return true;
    }

    await setSession(ctx.DB, ctx.chatId, "new_user_phone", { fullName: name });

    const reply = `
👤 نام ثبت شد: <b>${name}</b>
━━━━━━━━━━━━━━━━━━━━
📱 لطفاً <b>شماره موبایل مشتری</b> را ارسال نمایید (مثال: 09121234567):
`.trim();

    await ctx.bot.sendMessage(ctx.chatId, reply, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{ text: "❌ انصراف", callback_data: "cb:cancel_wizard" }]],
      },
    });
    return true;
  }

  if (session.flow === "new_user_phone") {
    const phone = text.replace(/[^0-9]/g, "").trim();
    if (phone.length < 10) {
      await ctx.bot.sendMessage(ctx.chatId, "⚠️ شماره موبایل نامعتبر است. لطفاً یک شماره موبایل صحیح (مانند 09121234567) ارسال نمایید:");
      return true;
    }

    const fullName = session.state?.fullName || "کاربر جدید";
    const username = `u_${phone.slice(-8)}`;

    const userService = new UserService(ctx.DB);
    try {
      const result = await userService.create({
        username,
        full_name: fullName,
        phone,
      });

      await clearSession(ctx.DB, ctx.chatId);

      const successText = `
🎉 <b>کاربر با موفقیت در سامانه ایجاد شد!</b>
━━━━━━━━━━━━━━━━━━━━
👤 <b>نام و نام خانوادگی:</b> ${fullName}
📞 <b>شماره تماس:</b> <code>${phone}</code>
🆔 <b>شناسه کاربری:</b> <code>${username}</code>
━━━━━━━━━━━━━━━━━━━━
<i>اکنون می‌توانید بلافاصله برای این کاربر لایسنس صادر نمایید:</i>
`.trim();

      await ctx.bot.sendMessage(ctx.chatId, successText, {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "👑 صدور لایسنس برای این کاربر", callback_data: `cb:new_license:user:${result.userId}` },
            ],
            getBackToMenuButton(),
          ],
        },
      });
    } catch (err: any) {
      await ctx.bot.sendMessage(ctx.chatId, `❌ خطا در ایجاد کاربر: ${err?.message || "احتمالاً شماره موبایل تکراری است."}`, {
        reply_markup: getMainMenuKeyboard(),
      });
      await clearSession(ctx.DB, ctx.chatId);
    }
    return true;
  }

  return false;
}

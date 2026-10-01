# GoldPos Admin

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/itsforpandash/goldpos-admin)

پنل مدیریت اشتراک، لایسنس و دستگاههای GoldPos — ساختهشده با Astro، shadcn/ui و Cloudflare D1.

## ویژگی‌ها

- 🇮🇷 **فارسی و RTL** — فونت وزیرمتن، اعداد فارسی، تاریخ شمسی
- 🌙 **Dark/Light Mode** — ذخیره‌سازی انتخاب در localStorage
- 📱 **PWA** — قابل نصب روی Android مانند اپلیکیشن
- 🔐 **احراز هویت مدیران** — PBKDF2 + session cookie امن
- 📊 **داشبورد** — KPI، نمودارها، آلرت‌ها， فعالیت‌های اخیر
- 👤 **مدیریت کاربران** — لیست، وضعیت، نقش‌ها
- 🔑 **مدیریت لایسنس‌ها** — تولید، لغو، تمدید，اعتبارسنجی
- 📱 **مدیریت دستگاه‌ها** — فعال، غیرفعال، مسدود، ریست
- 💳 **مدیریت پلن‌ها** — Free, Professional, Business, Enterprise
- 📋 **Audit Log** — ثبت تمام عملیات
- 📶 **API موبایل** — Endpoints مخصوص app اندro
- 🛡️ **Rate Limiting** — محافظت از login و activation

## ساختار دیتابیس (D1)

| جدول | توضیح |
|------|-------|
| `users` | کاربران اصلی سرویس |
| `plans` | پلن‌های اشتراک |
| `features` / `plan_features` | امکانات پلن‌ها (many-to-many) |
| `licenses` | لایسنس‌ها با code یکتا |
| `devices` | دستگاه‌های فعال‌شده |
| `activations` | تاریخچه اتصال/قطع دستگاه‌ها |
| `license_events` | رویدادهای لایسنس |
| `audit_logs` | لاگ فعالیت‌های مدیران |
| `admin_users` | حساب‌های پنل مدیریت (RBAC) |
| `app_settings` | تنظیمات کلیدی برنامه |

## API Endpoints

### احراز هویت
| Method | Endpoint | توضیح |
|--------|----------|-------|
| POST | `/api/auth/login` | ورود مدیر |
| GET | `/api/auth/me` | وضعیت session فعلی |
| POST | `/api/auth/logout` | خروج |

### داشبورد
| Method | Endpoint | توضیح |
|--------|----------|-------|
| GET | `/api/dashboard` | KPI، نمودارها، alerts |

### کاربران / پلن‌ها / لایسنس / دستگاه‌ها
`GET/POST /api/users`, `/api/plans`, `/api/licenses`, `/api/devices` و endpoint‌های جزئی با `?action=` برای revoke / extend / block / reset / deactivate.

### موبایل
| Method | Endpoint | توضیح |
|--------|----------|-------|
| POST | `/api/mobile/licenses/{id}/activate` | فعالسازی |
| POST | `/api/mobile/licenses/{id}/validate` | اعتبارسنجی |
| POST | `/api/mobile/licenses/{id}/deactivate` | غیرفعال‌سازی |
| GET | `/api/mobile/licenses/{device_hash}` | اعتبارسنجی بر اساس hash |

## صفحه‌های مدیریت

- `/admin/login` — ورود
- `/admin` — داشبورد
- `/admin/users` — کاربران
- `/admin/licenses` — لایسنس‌ها
- `/admin/devices` — دستگاه‌ها
- `/admin/plans` — پلن‌ها
- `/admin/activity` — audit log

## شروع کار

```bash
# ۱. نصب
npm install

# ۲. متغیرهای محیطی
cp .dev.vars.example .dev.vars
# داخل .dev.vars دو مقدار مجزا ست کنید (پایین توضیح داده شده):
#   SESSION_SECRET  — امضای session پنل مدیریت (فقط روی سرور)
#   API_TOKEN       — احراز هویت اپ موبایل (داخل APK قرار می‌گیرد)
# هر دو با: openssl rand -hex 32

# ۳. اجرای migrationها (لوکال)
npm run db:migrate

# ۴. اجرای سرور توسعه
npm run dev
# -> http://localhost:4321
```

### ورود پیش‌فرض
- نام کاربری: `admin`
- رمز عبور: `GoldPosAdmin123!`
- ⚠️ بلافاصله پس از اولین ورود رمز را تغییر دهید.

## دیپلوی به Cloudflare

```bash
npx wrangler d1 create admin-db   # یک‌بار، آدرس database_id را در wrangler.jsonc بگذارید
npm run build
npm run deploy
npm run db:migrate:remote         # apply migrationها روی D1
npx wrangler secret put SESSION_SECRET   # امضای session پنل مدیریت
npx wrangler secret put API_TOKEN        # توکن API موبایل
```

## Secretها (الزامی و مستقل از یکدیگر)

| متغیر | کاربرد | کجا می‌ماند |
|-------|--------|-------------|
| `SESSION_SECRET` | امضای cookie نشست پنل مدیریت (HMAC-SHA256) | فقط روی سرور — هرگز داخل اپ موبایل |
| `API_TOKEN` | احراز هویت درخواست‌های اپ موبایل (`X-API-Token`) | داخل APK توزیع‌شده |

این دو **نباید** یکی باشند. `API_TOKEN` داخل باینری APK قرار می‌گیرد و ذاتاً نیمه‌عمومی است؛ اگر همان کلید برای امضای session استفاده شود، هر کسی که APK را باز کند می‌تواند session با نقش `super_admin` جعل کند. به همین دلیل `getEnvSecret` فقط و فقط `SESSION_SECRET` را می‌خواند و هیچ fallbackای به `API_TOKEN` ندارد.

```bash
# ساخت مقدار قوی
openssl rand -hex 32

# تنظیم روی Worker
npx wrangler secret put SESSION_SECRET
npx wrangler secret put API_TOKEN
```

`SESSION_SECRET` حداقل ۳۲ کاراکتر و غیرplaceholder لازم دارد (مقادیر خالی، کوتاه، یا شامل `example_value` / `changeme` / `insecure` رد می‌شوند). اگر تنظیم نشده باشد، **هیچ sessionای معتبر نمی‌شود** و در هر درخواست این خط لاگ می‌شود:

```
FATAL: SESSION_SECRET is not configured (missing): ...
```

برای دیدن آن: `npx wrangler tail`.

## معماری

| لایه | تکنولوژی |
|------|-----------|
| Frontend | Astro 5 + React + Tailwind |
| UI Components | shadcn/ui |
| Database | Cloudflare D1 (SQLite) |
| Deployment | Cloudflare Workers |
| Auth | PBKDF2-SHA256 + HMAC-signed session token |
| i18n/RTL | Vazirmatn font + Jalali dates (dependency-free) |
| PWA | manifest.json + Service Worker |

## امنیت

- rate limiting روی `login` و موبایل-activation
- validation input با Zod (قابل توسعه در endpointها)
- cookie های `HttpOnly` + `SameSite=Lax`
- hash عبور با PBKDF2 (۱۰۰k iteration, SHA-256)
- audit logging تمام عملیات حساس
- جلوگیری از قرار دادن secret در frontend
- `SESSION_SECRET` و `API_TOKEN` کاملاً مستقل‌اند؛ `getEnvSecret` هیچ secret پیش‌فرض یا hardcoded ندارد و در نبود `SESSION_SECRET` هیچ sessionای معتبر نمی‌شود (fail closed)

## نکات تکمیلی / TODO

- [ ] صفحه Settings (appearance, license defaults, security)
- [ ] Global Search سراسری (کاربر/لایسنس/دستگاه)
- [ ] License Generator با batch + کپی چند کد
- [ ] License Detail page (`/admin/licenses/[code]`) با action buttons
- [ ] User Detail page با تب‌های licenses/devices/activity
- [ ] Report page و export CSV
- [ ] RBAC enforcement در UI (super_admin/admin/support/operator)
- [ ] E2E tests با Playwright + unit test سرویس‌ها
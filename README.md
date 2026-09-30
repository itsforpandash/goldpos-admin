# GoldPos Admin

پنل مدیریت اشتراک، لایسنس و دستگاه‌های GoldPos — ساخته‌شده با Astro، shadcn/ui و Cloudflare D1.

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
# داخل .dev.vars مقدار API_TOKEN را ست کنید

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
npx wrangler secret put API_TOKEN
```

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

## نکات تکمیلی / TODO

- [ ] صفحه Settings (appearance, license defaults, security)
- [ ] Global Search سراسری (کاربر/لایسنس/دستگاه)
- [ ] License Generator با batch + کپی چند کد
- [ ] License Detail page (`/admin/licenses/[code]`) با action buttons
- [ ] User Detail page با تب‌های licenses/devices/activity
- [ ] Report page و export CSV
- [ ] RBAC enforcement در UI (super_admin/admin/support/operator)
- [ ] E2E tests با Playwright + unit test سرویس‌ها
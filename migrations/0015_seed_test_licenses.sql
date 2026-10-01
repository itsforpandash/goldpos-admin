-- Migration 0015: Seed test user, quick test licenses and sample gallery
INSERT OR IGNORE INTO users (id, username, full_name, phone, password_hash, status, role, notes)
VALUES (1, 'gold_user_test', 'گالری طلای کیمیا (کاربر آزمایشی)', '09121112233', '', 'active', 'customer', 'کاربر نمونه جهت بررسی اپلیکیشن اندروید');

-- Test license 1: Demo (7 days)
INSERT OR IGNORE INTO licenses (id, code, user_id, plan_id, status, max_devices, expires_at)
VALUES (1, 'DEMO-7DAYS-TEST', 1, 1, 'unused', 1, datetime('now', '+7 days'));

-- Test license 2: 3 Months
INSERT OR IGNORE INTO licenses (id, code, user_id, plan_id, status, max_devices, expires_at)
VALUES (2, 'GOLD-3MONTHS-TEST', 1, 2, 'unused', 2, datetime('now', '+90 days'));

-- Test license 3: 1 Year VIP
INSERT OR IGNORE INTO licenses (id, code, user_id, plan_id, status, max_devices, expires_at)
VALUES (3, 'GOLD-1YEAR-TEST', 1, 3, 'unused', 5, datetime('now', '+365 days'));

-- Seed sample gallery information for first-time gallery verification
INSERT OR IGNORE INTO gallery_info (id, user_id, license_id, gallery_name, owner_name, phone, address)
VALUES (1, 1, 1, 'گالری طلای کیمیا', 'محمد احمدی', '09121112233', 'تهران، بازار بزرگ، راسته طلافروشان، سرای زرگرها، پلاک ۱۲');

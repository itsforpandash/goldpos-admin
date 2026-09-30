-- Migration 0007: Admin Users
DROP TABLE IF EXISTS admin_users;

CREATE TABLE admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username VARCHAR(100) NOT NULL UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('super_admin', 'admin', 'support', 'operator')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_admin_users_updated_at
    AFTER UPDATE ON admin_users
    BEGIN
        UPDATE admin_users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

CREATE INDEX idx_admin_users_username ON admin_users(username);
CREATE INDEX idx_admin_users_role ON admin_users(role);

-- Default super admin: username=admin, password=GoldPosAdmin123!
-- CHANGE THIS IMMEDIATELY AFTER FIRST LOGIN
INSERT INTO admin_users (username, full_name, password_hash, role)
VALUES ('admin', 'مدیر سیستم', 'pbkdf2$100000$aXQzQ2hhbmdlTWUvMjAyNg==$dzUqW5qbyW6kJPmppFa/YT+1EKo3knLpS90TutGCogA=', 'super_admin');

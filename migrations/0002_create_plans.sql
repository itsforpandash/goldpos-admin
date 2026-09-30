-- Migration 0002: Plans
DROP TABLE IF EXISTS plan_features;
DROP TABLE IF EXISTS features;
DROP TABLE IF EXISTS plans;

CREATE TABLE plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    price REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'IRR',
    duration_days INTEGER NOT NULL DEFAULT 30,
    max_devices INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE features (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE plan_features (
    plan_id INTEGER NOT NULL,
    feature_id INTEGER NOT NULL,
    PRIMARY KEY (plan_id, feature_id),
    FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE,
    FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE
);

CREATE TRIGGER update_plans_updated_at
    AFTER UPDATE ON plans
    BEGIN
        UPDATE plans SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

CREATE TRIGGER update_features_updated_at
    AFTER UPDATE ON features
    BEGIN
        UPDATE features SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

INSERT INTO plans (name, description, price, duration_days, max_devices, status) VALUES
('Free', 'پلن رایگان برای تست', 0, 30, 1, 'active'),
('Professional', 'پلن حرفه‌ای برای کسب‌وکارهای کوچک', 99000, 30, 3, 'active'),
('Business', 'پلن تجاری با امکانات کامل', 249000, 30, 5, 'active'),
('Enterprise', 'پلن سازمانی با پشتیبانی اختصاصی', 499000, 30, 10, 'active');

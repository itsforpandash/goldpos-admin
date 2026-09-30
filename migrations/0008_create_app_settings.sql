-- Migration 0008: App Settings
DROP TABLE IF EXISTS app_settings;

CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO app_settings (key, value) VALUES
('app_name', 'GoldPos'),
('default_license_days', '30'),
('grace_period_days', '7'),
('max_devices_default', '1'),
('session_hours', '8');

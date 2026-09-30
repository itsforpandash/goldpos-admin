-- Migration 0004: Devices
DROP TABLE IF EXISTS devices;

CREATE TABLE devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_hash VARCHAR(64) NOT NULL UNIQUE,
    license_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    device_model TEXT,
    android_version TEXT,
    app_version TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'blocked')),
    first_activated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_connected_at TIMESTAMP,
    last_ip TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_devices_hash ON devices(device_hash);
CREATE INDEX idx_devices_license ON devices(license_id);
CREATE INDEX idx_devices_user ON devices(user_id);
CREATE INDEX idx_devices_status ON devices(status);

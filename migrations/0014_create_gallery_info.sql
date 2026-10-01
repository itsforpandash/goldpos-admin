-- Migration 0014: Gallery Information for first-time setup
CREATE TABLE IF NOT EXISTS gallery_info (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    license_id INTEGER,
    device_hash TEXT,
    gallery_name TEXT NOT NULL,
    owner_name TEXT,
    phone TEXT,
    address TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_gallery_user ON gallery_info(user_id);
CREATE INDEX IF NOT EXISTS idx_gallery_license ON gallery_info(license_id);
CREATE INDEX IF NOT EXISTS idx_gallery_device ON gallery_info(device_hash);

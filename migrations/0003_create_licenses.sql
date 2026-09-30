-- Migration 0003: Licenses
DROP TABLE IF EXISTS licenses;

CREATE TABLE licenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code VARCHAR(50) NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    plan_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'unused' CHECK(status IN ('unused', 'active', 'expired', 'revoked')),
    max_devices INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    activated_at TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP,
    revoked_by INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE RESTRICT
);

CREATE INDEX idx_licenses_code ON licenses(code);
CREATE INDEX idx_licenses_user ON licenses(user_id);
CREATE INDEX idx_licenses_plan ON licenses(plan_id);
CREATE INDEX idx_licenses_status ON licenses(status);
CREATE INDEX idx_licenses_expires ON licenses(expires_at);

-- Prevent duplicate active licenses for same user+plan window
CREATE UNIQUE INDEX idx_unique_active_user_plan
ON licenses(user_id, plan_id)
WHERE status = 'active';

-- Migration 0005: Activations & License Events
DROP TABLE IF EXISTS activations;
DROP TABLE IF EXISTS license_events;

CREATE TABLE activations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_id INTEGER NOT NULL,
    device_id INTEGER NOT NULL,
    activated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deactivated_at TIMESTAMP,
    ip_address TEXT,
    FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE license_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_id INTEGER NOT NULL,
    event_type TEXT NOT NULL CHECK(event_type IN ('created', 'activated', 'expired', 'revoked', 'extended', 'renewed')),
    details TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE
);

CREATE INDEX idx_activations_license ON activations(license_id);
CREATE INDEX idx_license_events_license ON license_events(license_id);

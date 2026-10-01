-- Migration 0010: Signup Requests (public lead capture)
-- NOTE: no DROP TABLE — this table must never be wiped on a re-run.
CREATE TABLE signup_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- Either an email or an Iranian mobile, already normalized to its canonical
    -- form by the app (email -> lowercased, phone -> +989xxxxxxxxx) so the same
    -- person cannot create unlimited rows by typing the value three ways.
    contact TEXT NOT NULL CHECK(length(contact) BETWEEN 5 AND 254),
    contact_type TEXT NOT NULL CHECK(contact_type IN ('email', 'phone')),
    full_name TEXT,
    plan_id INTEGER REFERENCES plans(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    note TEXT,
    ip_address TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP,
    reviewed_by INTEGER REFERENCES admin_users(id),
    approved_license_id INTEGER REFERENCES licenses(id),
    -- Canonical-form guards: a phone is stored as +98..., an email is lowercased.
    CHECK(contact_type = 'phone' OR contact = lower(contact)),
    CHECK(contact_type = 'email' OR contact LIKE '+98%')
);

CREATE TRIGGER update_signup_requests_updated_at
    AFTER UPDATE ON signup_requests
    BEGIN
        UPDATE signup_requests SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

-- Only a pending request may be reviewed, and a review always terminates.
CREATE TRIGGER guard_signup_status_transition
    BEFORE UPDATE OF status ON signup_requests
    WHEN OLD.status <> NEW.status
     AND NOT (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected'))
    BEGIN
        SELECT RAISE(ABORT, 'INVALID_SIGNUP_STATUS_TRANSITION');
    END;

-- An approval must carry the generated license and the reviewing admin; a
-- rejection must carry the reviewing admin.
CREATE TRIGGER guard_signup_review_fields
    BEFORE UPDATE ON signup_requests
    WHEN NEW.status <> 'pending'
     AND (
            (NEW.status = 'approved' AND (NEW.approved_license_id IS NULL OR NEW.reviewed_by IS NULL))
         OR (NEW.status = 'rejected' AND NEW.reviewed_by IS NULL)
         )
    BEGIN
        SELECT RAISE(ABORT, 'INCOMPLETE_SIGNUP_REVIEW');
    END;

CREATE INDEX idx_signup_status ON signup_requests(status);
CREATE INDEX idx_signup_contact ON signup_requests(contact);
CREATE INDEX idx_signup_created ON signup_requests(created_at);

-- Race-proof duplicate guard: at most one open (pending/approved) request per
-- normalized contact. A rejected request does not block re-applying.
CREATE UNIQUE INDEX idx_signup_unique_open_contact
ON signup_requests(contact)
WHERE status IN ('pending', 'approved');

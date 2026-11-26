-- 013: offline attendance (decision 2026-11-26 after the supervisor's review).
-- A kiosk without internet stores encrypted face captures on the device; when the connection returns it sends them
-- here. The server verifies liveness + matches the face (face service), then writes a normal attendance event with the
-- ORIGINAL capture time. Captures that cannot be verified wait for the principal in a review queue.
-- Frames are encrypted at rest (AES-256-GCM, FACE_KEY) and deleted as soon as the capture is resolved (or after 7 days).
BEGIN;

CREATE TABLE offline_captures (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id bigint NOT NULL REFERENCES schools(id),
    kiosk_user_id bigint NOT NULL REFERENCES users(id),
    client_event_id uuid NOT NULL UNIQUE,            -- idempotency: the same capture is never processed twice
    challenge_nonce text NOT NULL UNIQUE,            -- a signed liveness challenge can be used for ONE capture only
    challenge jsonb NOT NULL,                        -- e.g. ["RIGHT","LEFT"]
    captured_at timestamptz NOT NULL,                -- time on the device, corrected by the clock drift measured at sync
    device_captured_at timestamptz NOT NULL,         -- raw device time (kept for audit)
    clock_skew_seconds integer NOT NULL DEFAULT 0,   -- server time − device time at sync
    received_at timestamptz NOT NULL DEFAULT now(),
    status varchar(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'ACCEPTED', 'NEEDS_REVIEW', 'RESOLVED', 'REJECTED', 'EXPIRED')),
    reason varchar(40),                              -- why it needs review / was rejected
    best_score numeric(5,4),
    matched_assignment_id bigint REFERENCES employee_assignments(id),
    event_id bigint REFERENCES attendance_events(id),
    frames_enc bytea,                                -- AES-256-GCM(JSON array of JPEG data URLs); NULL once resolved
    frames_iv bytea,
    frames_tag bytea,
    resolved_by bigint REFERENCES users(id),
    resolved_at timestamptz,
    CONSTRAINT chk_frames_present CHECK (status NOT IN ('PENDING', 'NEEDS_REVIEW') OR frames_enc IS NOT NULL)
);
CREATE INDEX idx_offline_captures_review ON offline_captures (school_id, received_at) WHERE status = 'NEEDS_REVIEW';

COMMIT;

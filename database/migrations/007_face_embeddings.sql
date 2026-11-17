-- 007: face enrollment — encrypted embeddings only, no images (FR-ATT-01, 02, 05, 24; NFR-06, NFR-07)
BEGIN;
INSERT INTO settings (key, value, description) VALUES
  ('face_match_threshold', '0.42', 'حد التطابق الوحيد (تشابه جيب التمام) لقبول التعرّف على الوجه (FR-ATT-05)')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS face_embeddings (
    employee_id   bigint PRIMARY KEY REFERENCES employees(id),
    ciphertext    bytea NOT NULL,      -- AES-256-GCM of the float32 vector; key only in backend env (FACE_KEY)
    iv            bytea NOT NULL,
    auth_tag      bytea NOT NULL,
    model         varchar(40) NOT NULL,
    quality       jsonb,
    enrolled_by   bigint NOT NULL REFERENCES users(id),
    enrolled_at   timestamptz NOT NULL DEFAULT now()
);
COMMIT;

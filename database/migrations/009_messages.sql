-- 009: messages & circulars (FR-MSG-01..12)
-- Mailboxes belong to organisations (ministry / directorate / school), not to individual users.
BEGIN;

CREATE TABLE IF NOT EXISTS messages (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind             varchar(20) NOT NULL,          -- CIRCULAR (ministry) / NOTICE (directorate) / MESSAGE (school ↔ directorate)
    sender_type      varchar(20) NOT NULL,          -- MINISTRY / DIRECTORATE / SCHOOL
    sender_ref_id    bigint NOT NULL,               -- ministries.id / directorates.id / schools.id
    sender_user_id   bigint NOT NULL REFERENCES users(id),
    subject          varchar(200) NOT NULL,
    body             text NOT NULL,
    requires_ack     boolean NOT NULL DEFAULT false, -- FR-MSG-10: recipient must confirm
    reply_to_id      bigint REFERENCES messages(id),
    status           varchar(10) NOT NULL DEFAULT 'DRAFT',
    target_summary   varchar(200),                   -- human-readable "to" line (e.g. "كل المدارس")
    created_at       timestamptz NOT NULL DEFAULT now(),
    sent_at          timestamptz,
    CONSTRAINT chk_message_kind CHECK (kind IN ('CIRCULAR', 'NOTICE', 'MESSAGE')),
    CONSTRAINT chk_message_sender CHECK (sender_type IN ('MINISTRY', 'DIRECTORATE', 'SCHOOL')),
    CONSTRAINT chk_message_status CHECK (status IN ('DRAFT', 'SENT')),
    CONSTRAINT chk_message_sent_at CHECK ((status = 'SENT') = (sent_at IS NOT NULL)),
    CONSTRAINT chk_message_text CHECK (length(trim(subject)) > 0 AND length(trim(body)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages (sender_type, sender_ref_id, created_at DESC);

CREATE TABLE IF NOT EXISTS message_recipients (
    message_id        bigint NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    recipient_type    varchar(20) NOT NULL,          -- DIRECTORATE / SCHOOL
    recipient_ref_id  bigint NOT NULL,
    opened_at         timestamptz,                   -- FR-MSG-10: first time anyone in that mailbox opened it
    opened_by         bigint REFERENCES users(id),
    acknowledged_at   timestamptz,
    acknowledged_by   bigint REFERENCES users(id),
    PRIMARY KEY (message_id, recipient_type, recipient_ref_id),
    CONSTRAINT chk_recipient_type CHECK (recipient_type IN ('DIRECTORATE', 'SCHOOL'))
);
CREATE INDEX IF NOT EXISTS idx_message_recipients_box ON message_recipients (recipient_type, recipient_ref_id);

CREATE TABLE IF NOT EXISTS message_attachments (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    message_id   bigint NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    file_name    varchar(255) NOT NULL,
    file_path    text NOT NULL,
    file_type    varchar(100) NOT NULL,
    file_size    bigint NOT NULL CHECK (file_size > 0),
    uploaded_at  timestamptz NOT NULL DEFAULT now()
);

-- FR-MSG-07: once sent, a message (and its attachments and recipient list) cannot be edited or deleted.
-- Only the read/acknowledge columns of recipients may change afterwards.
CREATE OR REPLACE FUNCTION protect_sent_message() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' AND OLD.status = 'SENT' THEN
        RAISE EXCEPTION 'لا يمكن حذف رسالة بعد إرسالها';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'SENT' THEN
        RAISE EXCEPTION 'لا يمكن تعديل رسالة بعد إرسالها';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_sent_message ON messages;
CREATE TRIGGER trg_protect_sent_message BEFORE UPDATE OR DELETE ON messages
    FOR EACH ROW EXECUTE FUNCTION protect_sent_message();

CREATE OR REPLACE FUNCTION protect_sent_message_children() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE v_status varchar(10);
BEGIN
    SELECT status INTO v_status FROM messages WHERE id = COALESCE(NEW.message_id, OLD.message_id);
    IF v_status = 'SENT' THEN
        IF TG_TABLE_NAME = 'message_recipients' AND TG_OP = 'UPDATE'
           AND NEW.message_id = OLD.message_id AND NEW.recipient_type = OLD.recipient_type
           AND NEW.recipient_ref_id = OLD.recipient_ref_id THEN
            RETURN NEW; -- read / acknowledge tracking is allowed
        END IF;
        RAISE EXCEPTION 'لا يمكن تعديل رسالة بعد إرسالها';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_recipients ON message_recipients;
CREATE TRIGGER trg_protect_recipients BEFORE INSERT OR UPDATE OR DELETE ON message_recipients
    FOR EACH ROW EXECUTE FUNCTION protect_sent_message_children();
DROP TRIGGER IF EXISTS trg_protect_msg_attachments ON message_attachments;
CREATE TRIGGER trg_protect_msg_attachments BEFORE INSERT OR UPDATE OR DELETE ON message_attachments
    FOR EACH ROW EXECUTE FUNCTION protect_sent_message_children();

-- Notifications can also point to a message (bell → inbox)
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS message_id bigint REFERENCES messages(id) ON DELETE CASCADE;

COMMIT;

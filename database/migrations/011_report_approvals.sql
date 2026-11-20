-- 011: monthly teacher report approval (FR-RPT-03).
-- The principal approves a teacher's monthly report after pending cases are reviewed.
-- The approved figures are frozen in `snapshot`; later corrections do not silently change an approved report.
BEGIN;

CREATE TABLE report_approvals (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_assignment_id bigint NOT NULL REFERENCES employee_assignments(id),
    month date NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
    approved_by bigint NOT NULL REFERENCES users(id),
    approved_at timestamptz NOT NULL DEFAULT now(),
    notes text,
    snapshot jsonb NOT NULL,
    UNIQUE (employee_assignment_id, month)
);

CREATE OR REPLACE FUNCTION prevent_report_approval_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'اعتماد التقرير غير قابل للتعديل أو الحذف';
END;
$$;
CREATE TRIGGER trg_report_approvals_immutable BEFORE UPDATE OR DELETE ON report_approvals
    FOR EACH ROW EXECUTE FUNCTION prevent_report_approval_change();

COMMIT;

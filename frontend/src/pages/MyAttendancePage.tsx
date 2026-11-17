import { useState } from "react";
import { useApi } from "../hooks/useApi";
import { Alert, Loading, PageHeader } from "../components/ui";
import { Stat } from "../components/schedule";
import { minutesLabel, todayIso } from "../utils/schedule";
import { DAY_LABELS } from "../config/labels";
import { StatusBadge, type DayRow } from "./AttendancePage";

// Own attendance for teachers / supervisors / staff (read-only)
function MyAttendancePage() {
  const mine = useApi<{ id: number; school_name: string }[]>("/attendance/my-assignments");
  const [picked, setPicked] = useState<number | null>(null);
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const ea = picked ?? mine.data?.[0]?.id ?? null;
  const lastDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const to = month === todayIso().slice(0, 7) ? todayIso() : `${month}-${String(lastDay).padStart(2, "0")}`;
  const days = useApi<{ rows: DayRow[] }>(ea ? `/attendance/assignments/${ea}/days?from=${month}-01&to=${to}` : null);

  const rows = days.data?.rows ?? [];
  const count = (s: string[]) => rows.filter((r) => s.includes(r.status)).length;
  const dayName = (iso: string) => DAY_LABELS[new Date(`${iso}T12:00:00`).getDay() + 1];

  return (
    <div className="container-fluid p-3 p-lg-4">
      <PageHeader title="حضوري" subtitle="للاطلاع فقط — لأي تصحيح راجع إدارة المدرسة" />
      <div className="d-flex flex-wrap gap-2 mb-3">
        {mine.data && mine.data.length > 1 && (
          <select className="form-select" style={{ maxWidth: 260 }} value={ea ?? ""} onChange={(e) => setPicked(Number(e.target.value))} aria-label="المدرسة">
            {mine.data.map((a) => <option key={a.id} value={a.id}>{a.school_name}</option>)}
          </select>
        )}
        <input type="month" className="form-control" style={{ maxWidth: 180 }} value={month} max={todayIso().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} aria-label="الشهر" />
      </div>
      <Alert kind="danger">{mine.error || days.error}</Alert>
      {mine.data?.length === 0 && <Alert kind="info">حسابك غير مرتبط بتكليف فعّال.</Alert>}

      {rows.length > 0 && (
        <div className="row g-3 mb-3">
          <Stat label="أيام حضور" value={count(["PRESENT", "CORRECTED"])} tone="success" />
          <Stat label="تأخر / خروج مبكر" value={count(["LATE", "EARLY_LEAVE", "LATE_EARLY_LEAVE"])} tone="warning" />
          <Stat label="تحتاج مراجعة" value={rows.filter((r) => r.needsReview).length} tone="danger" />
          <Stat label="مجموع الوجود" value={minutesLabel(rows.reduce((m, r) => m + r.presenceMinutes, 0))} tone="dark" />
        </div>
      )}

      <div className="card border-0 shadow-sm rounded-4">
        {days.loading && !days.data ? <Loading /> : (
          <div className="table-responsive">
            <table className="table align-middle small mb-0">
              <thead className="table-light"><tr><th>اليوم</th><th>الدوام المتوقع</th><th>دخول</th><th>خروج</th><th>الحالة</th><th>التفاصيل</th></tr></thead>
              <tbody>
                {rows.filter((r) => r.status !== "NO_DUTY").slice().reverse().map((r) => (
                  <tr key={r.date}>
                    <td className="fw-semibold">{dayName(r.date)}<div className="text-secondary fw-normal">{r.date}</div></td>
                    <td className="text-secondary">{r.expectedStart ? `${r.expectedStart} – ${r.expectedEnd}` : "—"}</td>
                    <td>{r.firstIn ?? "—"}</td>
                    <td>{r.lastOut ?? "—"}</td>
                    <td><StatusBadge row={r} /></td>
                    <td className="text-secondary">{r.reasons.join(" · ")}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={6} className="text-center text-secondary py-4">لا توجد أيام دوام بهذا الشهر</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default MyAttendancePage;

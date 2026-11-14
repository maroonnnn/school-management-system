import { useState } from "react";
import { useApi } from "../hooks/useApi";
import { Alert, Loading, PageHeader } from "../components/ui";
import { Stat, TimetableGrid, WeekPicker } from "../components/schedule";
import { minutesLabel, todayIso, useScheduleConfig } from "../utils/schedule";
import { EMPLOYMENT_LABELS, LESSON_STATUS } from "../config/labels";
import type { Lesson, QuotaRow } from "./QuotaPage";

// FR-SCH-11: the teacher sees their weekly timetable + required/executed quota, read-only
function MySchedulePage() {
  const config = useScheduleConfig();
  const mine = useApi<{ id: number; school_name: string }[]>("/schedule/my-assignments");
  const [picked, setPicked] = useState<number | null>(null);
  const [date, setDate] = useState(todayIso());
  const assignmentId = picked ?? mine.data?.[0]?.id ?? null;
  const week = useApi<{ week: { from: string; to: string }; lessons: Lesson[]; summary: QuotaRow | null }>(
    assignmentId ? `/schedule/assignments/${assignmentId}/week?date=${date}` : null,
  );

  const s = week.data?.summary;
  const lessonAt = (d: number, p: number) => week.data?.lessons.find((l) => l.day_of_week === d && l.period_number === p);

  return (
    <div className="container-fluid p-3 p-lg-4">
      <PageHeader title="جدولي ونصابي" subtitle="للاطلاع فقط — لأي خطأ راجع إدارة المدرسة" />
      <div className="d-flex flex-wrap gap-3 mb-3 align-items-center">
        {mine.data && mine.data.length > 1 && (
          <select className="form-select" style={{ maxWidth: 260 }} value={assignmentId ?? ""} onChange={(e) => setPicked(Number(e.target.value))} aria-label="المدرسة">
            {mine.data.map((a) => <option key={a.id} value={a.id}>{a.school_name}</option>)}
          </select>
        )}
        {mine.data?.length === 1 && <span className="fw-semibold">{mine.data[0].school_name}</span>}
        <WeekPicker date={date} onChange={setDate} range={week.data?.week} />
      </div>
      <Alert kind="danger">{mine.error || week.error}</Alert>
      {mine.data?.length === 0 && <Alert kind="info">لا يوجد تكليف تدريسي فعّال مرتبط بحسابك.</Alert>}

      {s && (
        <div className="row g-3 mb-3">
          <Stat label="النصاب المطلوب" value={s.required} hint={s.employment_type === "PERMANENT" ? `${EMPLOYMENT_LABELS.PERMANENT} · ${s.years_of_service} سنة خدمة` : EMPLOYMENT_LABELS.CONTRACT} />
          <Stat label="المنفّذ" value={s.executed} tone="success" hint={s.compensated ? `منها ${s.compensated} تعويض` : undefined} />
          <Stat label="لم يُنفّذ" value={s.not_executed} tone={s.not_executed ? "danger" : "secondary"} />
          <Stat label="المتبقي" value={s.remaining} tone={s.remaining ? "warning" : "success"} hint={s.excused ? `بعد خصم ${s.excused} حصة إجازة` : undefined} />
          <Stat label="وقت التدريس" value={minutesLabel(s.teaching_minutes)} tone="dark" />
          <Stat label="مدة الوجود" value={minutesLabel(s.presence_minutes)} tone="dark" />
        </div>
      )}

      <div className="card border-0 shadow-sm rounded-4">
        <div className="card-body">
          {!config.data || (week.loading && !week.data) ? <Loading /> : (
            <TimetableGrid
              config={config.data}
              cell={(d, p) => {
                const l = lessonAt(d, p);
                if (!l) return <div className="timetable-cell empty">—</div>;
                const st = LESSON_STATUS[l.status];
                return (
                  <div className="timetable-cell bg-body-tertiary">
                    <div className="fw-semibold">{l.subject_name}</div>
                    <div className="small text-secondary">{l.class_name} / {l.section_name}</div>
                    <span className={`badge ${st?.cls} mt-1`}>{st?.label}</span>
                  </div>
                );
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default MySchedulePage;

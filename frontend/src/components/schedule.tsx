import type { ReactNode } from "react";
import { shiftDate, type ScheduleConfig } from "../utils/schedule";
import { DAY_LABELS } from "../config/labels";

/** Week navigation: shows the server's week range; ‹ › move by 7 days. */
export function WeekPicker({ date, onChange, range }: { date: string; onChange: (d: string) => void; range?: { from: string; to: string } }) {
  return (
    <div className="d-flex align-items-center gap-2">
      <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => onChange(shiftDate(date, -7))} aria-label="الأسبوع السابق">
        <i className="bi bi-chevron-right"></i>
      </button>
      <input type="date" className="form-control form-control-sm" style={{ width: 160 }} value={date} onChange={(e) => e.target.value && onChange(e.target.value)} aria-label="الأسبوع" />
      <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => onChange(shiftDate(date, 7))} aria-label="الأسبوع التالي">
        <i className="bi bi-chevron-left"></i>
      </button>
      <button type="button" className="btn btn-link btn-sm" onClick={() => onChange(new Date().toLocaleDateString("en-CA"))}>هذا الأسبوع</button>
      {range && <span className="small text-secondary">{range.from} ← {range.to}</span>}
    </div>
  );
}

/** Days × periods grid. `cell(day, period)` renders each cell's content. */
export function TimetableGrid({ config, cell }: { config: ScheduleConfig; cell: (day: number, period: number) => ReactNode }) {
  const periods = Object.keys(config.periodTimes).map(Number).sort((a, b) => a - b);
  return (
    <div className="table-responsive">
      <table className="table table-bordered align-middle text-center mb-0 timetable-grid">
        <thead className="table-light">
          <tr>
            <th style={{ width: 90 }}>اليوم</th>
            {periods.map((p) => (
              <th key={p}>
                الحصة {p}
                <div className="small text-secondary fw-normal">{config.periodTimes[String(p)]}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {config.workDays.map((d) => (
            <tr key={d}>
              <th className="table-light">{DAY_LABELS[d]}</th>
              {periods.map((p) => <td key={p} className="p-1">{cell(d, p)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Stat({ label, value, hint, tone = "primary" }: { label: string; value: ReactNode; hint?: string; tone?: string }) {
  return (
    <div className="col-6 col-md-3 col-xl-2">
      <div className="card border-0 shadow-sm rounded-4 h-100">
        <div className="card-body py-3">
          <div className="small text-secondary">{label}</div>
          <div className={`fs-4 fw-bold text-${tone}`}>{value}</div>
          {hint && <div className="small text-secondary">{hint}</div>}
        </div>
      </div>
    </div>
  );
}

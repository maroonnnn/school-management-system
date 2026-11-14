import { useApi } from "../hooks/useApi";

export interface ScheduleConfig {
  periodTimes: Record<string, string>;
  workDays: number[];
  lessonMinutes: number;
}

export function useScheduleConfig() {
  return useApi<ScheduleConfig>("/schedule/config");
}

/** Today as YYYY-MM-DD in local time. */
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function minutesLabel(m: number) {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h} س ${r ? `${r} د` : ""}` : `${r} د`;
}

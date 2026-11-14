/** Arabic labels for codes stored in the DB (single place — reuse everywhere). */

export const STAGE_LABELS: Record<number, string> = {
  1: "حلقة أولى (1–6)",
  2: "حلقة ثانية (7–9)",
  3: "حلقة ثالثة (10–12)",
};

/** Grades allowed for each stage (mirrors DB function stage_allows_grade). */
export const STAGE_GRADES: Record<number, [number, number]> = { 1: [1, 6], 2: [7, 9], 3: [10, 12] };

export const TRACK_LABELS: Record<string, string> = {
  GENERAL_SCIENTIFIC: "عام — علمي",
  GENERAL_LITERARY: "عام — أدبي",
  COMMERCIAL: "تجاري",
  INDUSTRIAL: "صناعي",
};

export const EMPLOYMENT_LABELS: Record<string, string> = {
  PERMANENT: "مثبّت",
  CONTRACT: "وكيل",
};

export const DAY_LABELS: Record<number, string> = {
  1: "الأحد", 2: "الاثنين", 3: "الثلاثاء", 4: "الأربعاء", 5: "الخميس", 6: "الجمعة", 7: "السبت",
};

export const LESSON_STATUS: Record<string, { label: string; cls: string }> = {
  EXECUTED: { label: "نُفّذت", cls: "text-bg-success" },
  COMPENSATED: { label: "عُوّضت", cls: "text-bg-info" },
  NOT_EXECUTED: { label: "لم تُنفّذ", cls: "text-bg-danger" },
  EXCUSED: { label: "إجازة/تكليف", cls: "text-bg-warning" },
  UPCOMING: { label: "قادمة", cls: "text-bg-light border" },
};

export const LEAVE_LABELS: Record<string, string> = {
  ANNUAL: "إجازة إدارية", SICK: "إجازة مرضية", OFFICIAL_ASSIGNMENT: "تكليف رسمي", TRAINING: "دورة تدريبية", OTHER: "أخرى",
};

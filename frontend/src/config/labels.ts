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

/** Daily attendance classification (backend algorithms/attendanceClassifier.ts). */
export const DAY_STATUS: Record<string, { label: string; cls: string }> = {
  PRESENT: { label: "حاضر", cls: "text-bg-success" },
  LATE: { label: "متأخر", cls: "text-bg-warning" },
  EARLY_LEAVE: { label: "خروج مبكر", cls: "text-bg-warning" },
  LATE_EARLY_LEAVE: { label: "تأخر وخروج مبكر", cls: "text-bg-warning" },
  INCOMPLETE: { label: "تسجيل ناقص", cls: "text-bg-info" },
  POSSIBLE_ABSENCE: { label: "غياب محتمل", cls: "text-bg-danger" },
  EXCUSED: { label: "إجازة/تكليف", cls: "text-bg-secondary" },
  OUTAGE_EXEMPT: { label: "مستثنى (انقطاع)", cls: "text-bg-light border" },
  NO_DUTY: { label: "لا دوام", cls: "text-bg-light border" },
  CORRECTED: { label: "مُصحّح", cls: "text-bg-primary" },
};

/** Status a correction can set (attendance_corrections.corrected_status). */
export const CORRECTED_STATUS: Record<string, string> = {
  PRESENT: "حاضر", LATE: "متأخر", EARLY_LEAVE: "خروج مبكر", ABSENT: "غائب", EXCUSED: "معذور (إجازة/مهمة)",
};

export const CORRECTION_STATE: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "بانتظار الاعتماد", cls: "text-bg-warning" },
  APPROVED: { label: "معتمد", cls: "text-bg-success" },
  REJECTED: { label: "مرفوض", cls: "text-bg-danger" },
};

export const POSITION_LABELS: Record<string, string> = {
  TEACHER: "معلم", PRINCIPAL: "مدير", DEPUTY: "نائب مدير", ADMINISTRATIVE: "إداري", SUPERVISOR: "موجّه",
};

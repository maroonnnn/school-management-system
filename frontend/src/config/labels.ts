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

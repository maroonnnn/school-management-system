export type Role =
  | "MINISTRY_ADMIN"
  | "DIRECTORATE_ADMIN"
  | "SCHOOL_PRINCIPAL"
  | "SCHOOL_DEPUTY"
  | "SCHOOL_STAFF"
  | "TEACHER"
  | "SUPERVISOR";

export interface AuthUser {
  id: number;
  fullName: string;
  username: string;
  role: Role;
  employeeNumber: string | null;
  schoolId: number | null;
  directorateId: number | null;
}

export const roleLabels: Record<Role, string> = {
  MINISTRY_ADMIN: "مسؤول الوزارة",
  DIRECTORATE_ADMIN: "مسؤول مديرية التربية",
  SCHOOL_PRINCIPAL: "مدير المدرسة",
  SCHOOL_DEPUTY: "نائب مدير المدرسة",
  SCHOOL_STAFF: "موظف المدرسة",
  TEACHER: "معلم",
  SUPERVISOR: "موجّه",
};

import type { Role } from "../types/auth";

export interface NavItem {
  path: string;
  label: string;
  icon: string; // bootstrap-icons class
  description: string;
  roles: Role[] | "ALL";
}

/** Single source for sidebar links, home cards and route guards. Add new pages here. */
export const NAV_ITEMS: NavItem[] = [
  {
    path: "/",
    label: "الرئيسية",
    icon: "bi-house-door",
    description: "",
    roles: "ALL",
  },
  {
    path: "/schools",
    label: "المدارس",
    icon: "bi-building",
    description: "إضافة المدارس وربطها بالمديرية وتعديل بياناتها.",
    roles: ["MINISTRY_ADMIN", "DIRECTORATE_ADMIN"],
  },
  {
    path: "/staff",
    label: "الكادر",
    icon: "bi-people",
    description: "ملفات المعلمين والكادر الإداري: البيانات والتخصص والتكليف.",
    roles: ["DIRECTORATE_ADMIN", "SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY"],
  },
  {
    path: "/students",
    label: "الصفوف والطلاب",
    icon: "bi-mortarboard",
    description: "الصفوف والشعب وأسماء الطلاب في كل شعبة.",
    roles: ["DIRECTORATE_ADMIN", "SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY"],
  },
  {
    path: "/timetable",
    label: "جدول الحصص",
    icon: "bi-calendar3-week",
    description: "إدخال جدول حصص كل شعبة: اليوم والوقت والمادة والمعلم.",
    roles: ["DIRECTORATE_ADMIN", "SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY"],
  },
  {
    path: "/quota",
    label: "النصاب والحصص",
    icon: "bi-speedometer2",
    description: "النصاب المطلوب والمنفّذ والمتبقي لكل معلم، وسجل تنفيذ الحصص والإجازات.",
    roles: ["DIRECTORATE_ADMIN", "SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY"],
  },
  {
    path: "/my-schedule",
    label: "جدولي ونصابي",
    icon: "bi-calendar-check",
    description: "جدول حصصك الأسبوعي والنصاب المطلوب والمنفّذ.",
    roles: ["TEACHER"],
  },
  {
    path: "/settings",
    label: "إعدادات النصاب",
    icon: "bi-sliders",
    description: "شرائح نصاب المثبّت، أجر حصة الوكيل، أوقات الحصص.",
    roles: ["MINISTRY_ADMIN", "DIRECTORATE_ADMIN", "SCHOOL_PRINCIPAL"],
  },
  {
    path: "/grades",
    label: "النتائج",
    icon: "bi-journal-check",
    description: "إدخال علامات الطلاب من الموجّه واعتمادها من مدير المدرسة.",
    roles: ["SUPERVISOR", "SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY", "DIRECTORATE_ADMIN"],
  },
  {
    path: "/users",
    label: "الحسابات",
    icon: "bi-person-gear",
    description: "إنشاء حسابات المستخدمين وتعطيلها وتعيين الأدوار.",
    roles: ["MINISTRY_ADMIN", "DIRECTORATE_ADMIN", "SCHOOL_PRINCIPAL"],
  },
  {
    path: "/reports/monthly",
    label: "التقرير الشهري",
    icon: "bi-bar-chart-line",
    description: "عرض ملخص الحضور والتفاصيل الشهرية للمعلم وطباعتها.",
    roles: ["DIRECTORATE_ADMIN", "SCHOOL_PRINCIPAL", "SCHOOL_DEPUTY", "TEACHER"],
  },
  {
    path: "/requests/review",
    label: "طلبات المدارس",
    icon: "bi-file-earmark-check",
    description: "مراجعة الطلبات المقدمة إلى مديريتك وتحديث حالتها.",
    roles: ["DIRECTORATE_ADMIN"],
  },
];

export function canAccess(item: Pick<NavItem, "roles">, role: Role | undefined): boolean {
  return !!role && (item.roles === "ALL" || item.roles.includes(role));
}

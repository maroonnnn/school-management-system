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

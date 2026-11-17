import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { NAV_GROUPS, NAV_ITEMS, canAccess } from "../config/navigation";
import { roleLabels } from "../types/auth";
import NotificationBell from "../components/NotificationBell";

function MainLayout() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const items = NAV_ITEMS.filter((item) => canAccess(item, user?.role));

  const links = (
    <nav className="nav flex-column p-2" aria-label="القائمة الرئيسية">
      {NAV_GROUPS.map((g) => {
        const groupItems = items.filter((i) => i.group === g.id);
        if (groupItems.length === 0) return null;
        return (
          <div key={g.id} className="mb-1">
            {g.label && <div className="sidebar-section">{g.label}</div>}
            {groupItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === "/"}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) => `sidebar-link mb-1 ${isActive ? "active" : ""}`}
              >
                <i className={`bi ${item.icon}`}></i>
                <span>{item.label}</span>
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="app-shell" dir="rtl">
      <header className="app-topbar navbar navbar-dark shadow-sm no-print">
        <div className="container-fluid px-3">
          <div className="d-flex align-items-center gap-2">
            <button
              type="button"
              className="btn btn-link text-white d-lg-none p-1"
              aria-label="القائمة"
              onClick={() => setMenuOpen((o) => !o)}
            >
              <i className="bi bi-list fs-3"></i>
            </button>
            <img src="/brand/emblem.webp" alt="" className="topbar-emblem" />
            <div>
              <div className="topbar-title">نظام إدارة ومتابعة المدارس</div>
              <div className="topbar-subtitle d-none d-sm-block">الجمهورية العربية السورية — وزارة التربية والتعليم</div>
            </div>
          </div>
          <div className="d-flex align-items-center gap-3">
            {(user?.role === "SCHOOL_PRINCIPAL" || user?.role === "SCHOOL_DEPUTY" || user?.role === "DIRECTORATE_ADMIN") && <NotificationBell />}
            <div className="text-end d-none d-sm-block topbar-user">
              <div className="fw-semibold">{user?.fullName}</div>
              <small>{user && roleLabels[user.role]}</small>
            </div>
            <button type="button" className="btn btn-sm btn-outline-light" onClick={() => logout()}>
              <i className="bi bi-box-arrow-left ms-1"></i>
              خروج
            </button>
          </div>
        </div>
      </header>

      <div className="app-body">
        <aside className="app-sidebar d-none d-lg-flex flex-column no-print">
          <div className="flex-grow-1">{links}</div>
          <div className="sidebar-footer">مديرية تربية دمشق · النسخة التجريبية {new Date().getFullYear()}</div>
        </aside>

        {menuOpen && (
          <>
            <div className="sidebar-backdrop d-lg-none" onClick={() => setMenuOpen(false)} />
            <aside className="app-sidebar app-sidebar-mobile d-lg-none">{links}</aside>
          </>
        )}

        <main className="app-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default MainLayout;

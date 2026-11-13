import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { NAV_ITEMS, canAccess } from "../config/navigation";
import { roleLabels } from "../types/auth";

function MainLayout() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const items = NAV_ITEMS.filter((item) => canAccess(item, user?.role));

  const links = (
    <nav className="nav flex-column gap-1 p-3">
      {items.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.path === "/"}
          onClick={() => setMenuOpen(false)}
          className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
        >
          <i className={`bi ${item.icon}`}></i>
          <span>{item.label}</span>
        </NavLink>
      ))}
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
            <i className="bi bi-mortarboard-fill fs-4 text-white"></i>
            <span className="navbar-brand fw-bold m-0">نظام إدارة ومتابعة المدارس</span>
          </div>
          <div className="d-flex align-items-center gap-3">
            <div className="text-end d-none d-sm-block">
              <div className="text-white fw-semibold">{user?.fullName}</div>
              <small className="text-white-50">{user && roleLabels[user.role]}</small>
            </div>
            <button type="button" className="btn btn-sm btn-outline-light" onClick={() => logout()}>
              <i className="bi bi-box-arrow-left ms-1"></i>
              خروج
            </button>
          </div>
        </div>
      </header>

      <div className="app-body">
        <aside className="app-sidebar d-none d-lg-block no-print">{links}</aside>

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

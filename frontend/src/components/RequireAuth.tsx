import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import type { Role } from "../types/auth";

interface Props {
  children: ReactNode;
  roles?: Role[] | "ALL";
}

/** Redirects to /login when signed out; shows 403 when the role is not allowed. */
function RequireAuth({ children, roles = "ALL" }: Props) {
  const { user, logoutReason } = useAuth();
  const location = useLocation();

  // Visitors opening the site root see the public landing page; deep links go straight to sign-in
  if (!user) {
    // after a forced logout (idle/expired) go to /login, which shows the reason
    return location.pathname === "/" && !logoutReason
      ? <Navigate to="/welcome" replace />
      : <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (roles !== "ALL" && !roles.includes(user.role)) {
    return (
      <div className="container py-5 text-center">
        <i className="bi bi-shield-lock display-4 text-secondary"></i>
        <h1 className="h4 fw-bold mt-3">لا تملك صلاحية الوصول إلى هذه الصفحة</h1>
      </div>
    );
  }

  return <>{children}</>;
}

export default RequireAuth;

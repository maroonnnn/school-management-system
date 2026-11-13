import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { NAV_ITEMS, canAccess } from "../config/navigation";
import { roleLabels } from "../types/auth";

function HomePage() {
  const { user } = useAuth();
  const services = NAV_ITEMS.filter((item) => item.path !== "/" && canAccess(item, user?.role));

  return (
    <div className="container py-4 py-lg-5">
      <section
        className="rounded-4 p-4 p-lg-5 mb-4 text-white shadow-sm"
        style={{ background: "linear-gradient(120deg, #102a43 0%, #176b87 100%)" }}
      >
        <div className="text-white-50 mb-2">وزارة التربية والتعليم</div>
        <h1 className="h2 fw-bold mb-2">مرحباً، {user?.fullName || user?.username}</h1>
        <p className="mb-0">{user && roleLabels[user.role]} — اختر إحدى خدمات النظام للمتابعة.</p>
      </section>

      <h2 className="h5 fw-bold mb-3" style={{ color: "#102a43" }}>
        خدمات النظام
      </h2>
      <div className="row g-3">
        {services.map((item) => (
          <div className="col-md-6 col-xl-4" key={item.path}>
            <Link to={item.path} className="card h-100 border-0 shadow-sm rounded-4 text-decoration-none text-reset service-card">
              <div className="card-body p-4">
                <div className="d-flex align-items-center gap-3 mb-3">
                  <span className="text-primary fs-3">
                    <i className={`bi ${item.icon}`}></i>
                  </span>
                  <h3 className="h5 fw-bold mb-0">{item.label}</h3>
                </div>
                <p className="text-secondary mb-0">{item.description}</p>
              </div>
            </Link>
          </div>
        ))}
        {services.length === 0 && <p className="text-secondary">لا توجد خدمات متاحة لدورك حالياً.</p>}
      </div>
    </div>
  );
}

export default HomePage;

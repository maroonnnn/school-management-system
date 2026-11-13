import { useState } from "react";
import DirectorateRequests from "./DirectorateRequests";
import MonthlyReport from "./MonthlyReport";

interface AuthUser {
  id: number;
  fullName: string;
  username: string;
  role: string;
  schoolId: number | null;
  directorateId: number | null;
}

interface HomePageProps {
  token: string;
  user: AuthUser;
  onLogout: () => void;
}

type HomeSection = "home" | "report" | "requests";

const roleLabels: Record<string, string> = {
  MINISTRY_ADMIN: "مدير الوزارة",
  DIRECTORATE_ADMIN: "مدير مديرية التربية",
  SCHOOL_PRINCIPAL: "مدير المدرسة",
  SCHOOL_DEPUTY: "نائب مدير المدرسة",
  SCHOOL_STAFF: "موظف المدرسة",
};

function HomePage({ token, user, onLogout }: HomePageProps) {
  const [activeSection, setActiveSection] = useState<HomeSection>("home");
  const canReviewRequests = user.role === "DIRECTORATE_ADMIN";

  function navigateTo(section: HomeSection) {
    setActiveSection(section);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="min-vh-100 bg-light" dir="rtl">
      <nav
        className="navbar navbar-dark shadow-sm no-print"
        style={{ backgroundColor: "#102a43" }}
      >
        <div className="container-fluid px-3 px-lg-4">
          <button
            type="button"
            className="navbar-brand btn btn-link text-white text-decoration-none d-flex align-items-center gap-2 m-0 p-0"
            onClick={() => navigateTo("home")}
          >
            <i className="bi bi-mortarboard-fill fs-4"></i>
            <span className="fw-bold">نظام إدارة ومتابعة المدارس</span>
          </button>

          <div className="d-flex align-items-center gap-2 gap-md-3">
            <div className="text-end d-none d-sm-block">
              <div className="text-white fw-semibold">{user.fullName}</div>
              <small className="text-white-50">
                {roleLabels[user.role] || user.role}
              </small>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-outline-light"
              onClick={onLogout}
            >
              <i className="bi bi-box-arrow-left ms-1"></i>
              خروج
            </button>
          </div>
        </div>
      </nav>

      <div className="bg-white border-bottom no-print">
        <div className="container py-2 d-flex flex-wrap gap-2">
          <button
            type="button"
            className={`btn btn-sm ${
              activeSection === "home"
                ? "btn-primary"
                : "btn-outline-primary"
            }`}
            onClick={() => navigateTo("home")}
          >
            <i className="bi bi-house-door ms-1"></i>
            الرئيسية
          </button>
          <button
            type="button"
            className={`btn btn-sm ${
              activeSection === "report"
                ? "btn-primary"
                : "btn-outline-primary"
            }`}
            onClick={() => navigateTo("report")}
          >
            <i className="bi bi-bar-chart-line ms-1"></i>
            التقرير الشهري
          </button>
          {canReviewRequests && (
            <button
              type="button"
              className={`btn btn-sm ${
                activeSection === "requests"
                  ? "btn-primary"
                  : "btn-outline-primary"
              }`}
              onClick={() => navigateTo("requests")}
            >
              <i className="bi bi-file-earmark-text ms-1"></i>
              مراجعة طلبات المدارس
            </button>
          )}
        </div>
      </div>

      {activeSection === "home" && (
        <main className="container py-4 py-lg-5">
          <section
            className="rounded-4 p-4 p-lg-5 mb-4 text-white shadow-sm"
            style={{
              background:
                "linear-gradient(120deg, #102a43 0%, #176b87 100%)",
            }}
          >
            <div className="text-white-50 mb-2">وزارة التربية والتعليم</div>
            <h1 className="h2 fw-bold mb-2">
              مرحباً، {user.fullName || user.username}
            </h1>
            <p className="mb-0">
              {roleLabels[user.role] || user.role} — اختر إحدى خدمات النظام
              للمتابعة.
            </p>
          </section>

          <h2 className="h5 fw-bold mb-3" style={{ color: "#102a43" }}>
            خدمات النظام
          </h2>
          <div className="row g-3">
            <div className="col-md-6">
              <button
                type="button"
                className="card h-100 w-100 border-0 shadow-sm rounded-4 text-start"
                onClick={() => navigateTo("report")}
              >
                <div className="card-body p-4">
                  <div className="d-flex align-items-center gap-3 mb-3">
                    <span className="text-primary fs-3">
                      <i className="bi bi-bar-chart-line"></i>
                    </span>
                    <h3 className="h5 fw-bold mb-0">التقرير الشهري للحضور</h3>
                  </div>
                  <p className="text-secondary mb-0">
                    عرض ملخص الحضور والتفاصيل الشهرية وطباعتها.
                  </p>
                </div>
              </button>
            </div>
            {canReviewRequests && (
              <div className="col-md-6">
                <button
                  type="button"
                  className="card h-100 w-100 border-0 shadow-sm rounded-4 text-start"
                  onClick={() => navigateTo("requests")}
                >
                  <div className="card-body p-4">
                    <div className="d-flex align-items-center gap-3 mb-3">
                      <span className="text-primary fs-3">
                        <i className="bi bi-file-earmark-check"></i>
                      </span>
                      <h3 className="h5 fw-bold mb-0">طلبات المدارس</h3>
                    </div>
                    <p className="text-secondary mb-0">
                      مراجعة الطلبات المقدمة إلى مديريتك وتحديث حالتها.
                    </p>
                  </div>
                </button>
              </div>
            )}
          </div>
        </main>
      )}

      {activeSection === "report" && <MonthlyReport />}
      {activeSection === "requests" && canReviewRequests && (
        <DirectorateRequests token={token} />
      )}
    </div>
  );
}

export default HomePage;

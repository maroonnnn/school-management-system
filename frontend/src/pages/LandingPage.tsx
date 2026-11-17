import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const FEATURES = [
  { icon: "bi-person-check", title: "الحضور والدوام", text: "تسجيل حضور الكادر بالتعرّف على الوجه، وتصنيف يومي مقارنةً بجدول الحصص مع سماحية قابلة للضبط." },
  { icon: "bi-calendar3-week", title: "الجداول والنصاب", text: "جدول حصص كل شعبة، ونصاب المعلم المثبّت والوكيل، والمنفّذ والمتبقي أسبوعياً." },
  { icon: "bi-inbox", title: "طلبات المدارس", text: "طلبات الصيانة والتجهيزات والكوادر تُرفع للمديرية وتُتابَع حالتها حتى الإغلاق." },
  { icon: "bi-journal-check", title: "النتائج المدرسية", text: "الموجّه يُدخل العلامات ومدير المدرسة يعتمدها، ولا تُعدّل بعد الاعتماد." },
  { icon: "bi-bar-chart-line", title: "التقارير والمؤشرات", text: "تقارير شهرية ولوحات مؤشرات لكل مستوى إداري تدعم اتخاذ القرار." },
  { icon: "bi-shield-lock", title: "صلاحيات وسجل تدقيق", text: "كل مستخدم يرى ما ضمن نطاقه فقط، وكل اطلاع أو تعديل مسجّل ولا يُحذف." },
];

const LEVELS = [
  { icon: "bi-bank", title: "الوزارة", text: "مؤشرات مجمّعة لكل المديريات والمدارس" },
  { icon: "bi-diagram-3", title: "المديرية", text: "متابعة مدارسها، مراجعة الطلبات، ضبط الإعدادات" },
  { icon: "bi-building", title: "المدرسة", text: "الكادر والطلاب والجداول والحضور" },
  { icon: "bi-person-workspace", title: "المعلم", text: "جدوله ونصابه وحضوره للاطلاع" },
];

// Public landing page shown before sign-in (user requirement 4, 2026-11-13)
function LandingPage() {
  const { user } = useAuth();
  if (user) return <Navigate to="/" replace />;

  return (
    <div className="landing" dir="rtl">
      <header className="landing-nav">
        <div className="container d-flex align-items-center justify-content-between py-2">
          <div className="d-flex align-items-center gap-2">
            <img src="/brand/emblem.webp" alt="" className="topbar-emblem" />
            <div>
              <div className="topbar-title">نظام إدارة ومتابعة المدارس</div>
              <div className="topbar-subtitle d-none d-sm-block">وزارة التربية والتعليم</div>
            </div>
          </div>
          <Link to="/login" className="btn btn-gold btn-sm px-3">
            <i className="bi bi-box-arrow-in-left ms-1"></i>تسجيل الدخول
          </Link>
        </div>
      </header>

      <section className="landing-hero">
        <div className="container py-5">
          <div className="row align-items-center g-5 py-lg-4">
            <div className="col-lg-7 text-center text-lg-end">
              <div className="hero-kicker mb-3">الجمهورية العربية السورية · وزارة التربية والتعليم</div>
              <h1 className="display-5 fw-bold mb-3">منصة مركزية واحدة<br />للوزارة والمديريات والمدارس</h1>
              <p className="lead opacity-75 mb-4">
                نظام لإدارة ومتابعة المدارس ودعم اتخاذ القرار: الحضور، النصاب التدريسي، الطلبات الإدارية،
                المراسلات، والتقارير — بأرقام دقيقة ومحدّثة في مكان واحد.
              </p>
              <div className="d-flex flex-wrap gap-2 justify-content-center justify-content-lg-start">
                <Link to="/login" className="btn btn-gold btn-lg px-4">
                  <i className="bi bi-box-arrow-in-left ms-2"></i>الدخول إلى النظام
                </Link>
                <a href="#features" className="btn btn-outline-light btn-lg px-4">تعرّف على الخدمات</a>
              </div>
            </div>
            <div className="col-lg-5 text-center">
              <img src="/brand/emblem.webp" alt="شعار الجمهورية العربية السورية" className="landing-emblem" />
            </div>
          </div>
        </div>
      </section>

      <section className="container py-5" id="levels">
        <div className="text-center mb-4">
          <h2 className="h3 fw-bold brand-title mb-1">لكل مستوى إداري ما يخصّه</h2>
          <span className="gold-rule"></span>
        </div>
        <div className="row g-3">
          {LEVELS.map((l) => (
            <div className="col-6 col-lg-3" key={l.title}>
              <div className="kpi-card p-4 text-center h-100">
                <span className="service-icon mb-3"><i className={`bi ${l.icon}`}></i></span>
                <h3 className="h6 fw-bold mb-1">{l.title}</h3>
                <p className="small text-secondary mb-0">{l.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-band py-5" id="features">
        <div className="container">
          <div className="text-center mb-4">
            <h2 className="h3 fw-bold brand-title mb-1">خدمات النظام</h2>
            <span className="gold-rule"></span>
          </div>
          <div className="row g-3">
            {FEATURES.map((f) => (
              <div className="col-md-6 col-lg-4" key={f.title}>
                <div className="card service-card h-100 shadow-sm rounded-4">
                  <div className="card-body p-4 d-flex gap-3">
                    <span className="service-icon flex-shrink-0"><i className={`bi ${f.icon}`}></i></span>
                    <div>
                      <h3 className="h6 fw-bold mb-1">{f.title}</h3>
                      <p className="small text-secondary mb-0">{f.text}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="container py-5">
        <div className="landing-cta rounded-4 p-4 p-lg-5 d-flex flex-wrap gap-3 align-items-center justify-content-between">
          <div>
            <h2 className="h4 fw-bold mb-1">هل لديك حساب في النظام؟</h2>
            <p className="mb-0 opacity-75">الحسابات تُنشأ من قبل المديرية أو إدارة المدرسة فقط.</p>
          </div>
          <Link to="/login" className="btn btn-gold btn-lg px-4">تسجيل الدخول</Link>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="container py-4 d-flex flex-wrap gap-2 justify-content-between small">
          <span>© {new Date().getFullYear()} وزارة التربية والتعليم — الجمهورية العربية السورية</span>
          <span>نسخة تجريبية · مديرية تربية دمشق</span>
        </div>
      </footer>
    </div>
  );
}

export default LandingPage;

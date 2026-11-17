import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

function LoginPage() {
  const { user, login, logoutReason } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await login(username, password);
      const from = (location.state as { from?: string } | null)?.from ?? "/";
      navigate(from, { replace: true });
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "حدث خطأ أثناء الاتصال بالخادم");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-split" dir="rtl">
      <section className="login-brand">
        <div>
          <img src="/brand/emblem.webp" alt="شعار الجمهورية العربية السورية" className="emblem mb-4" />
          <div className="hero-kicker mb-1">الجمهورية العربية السورية · وزارة التربية والتعليم</div>
          <h1 className="h2 mb-3">نظام إدارة ومتابعة المدارس</h1>
          <p className="opacity-75 mb-0" style={{ maxWidth: 460 }}>
            منصة مركزية تربط الوزارة والمديريات والمدارس: الحضور، النصاب، الطلبات، والتقارير في مكان واحد.
          </p>
        </div>
        <div className="features d-flex flex-column gap-2 mt-4">
          <div className="feature"><i className="bi bi-person-check"></i>متابعة حضور الكادر والنصاب التدريسي</div>
          <div className="feature"><i className="bi bi-inbox"></i>طلبات المدارس ومتابعتها مع المديرية</div>
          <div className="feature"><i className="bi bi-bar-chart-line"></i>تقارير ومؤشرات تدعم اتخاذ القرار</div>
        </div>
      </section>

      <section className="login-form-side">
        <div className="login-card-new">
          <Link to="/welcome" className="small text-decoration-none d-inline-block mb-3"><i className="bi bi-arrow-right ms-1"></i>الصفحة الرئيسية</Link>
          <h2 className="h4 fw-bold brand-title mb-1">تسجيل الدخول</h2>
          <span className="gold-rule mb-3"></span>
          <p className="text-secondary mb-4">أدخل بيانات حسابك للمتابعة.</p>

          {logoutReason && !error && (
            <div className="alert alert-warning" role="status">
              <i className="bi bi-clock-history ms-2"></i>
              {logoutReason}
            </div>
          )}
          {error && (
            <div className="alert alert-danger" role="alert">
              <i className="bi bi-exclamation-circle ms-2"></i>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="card border-0 shadow-sm rounded-4 p-4">
            <div className="mb-3">
              <label htmlFor="username" className="form-label fw-semibold">اسم المستخدم</label>
              <div className="input-group">
                <span className="input-group-text bg-white"><i className="bi bi-person"></i></span>
                <input id="username" name="username" type="text" dir="ltr" className="form-control form-control-lg"
                  value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required autoFocus />
              </div>
            </div>
            <div className="mb-4">
              <label htmlFor="password" className="form-label fw-semibold">كلمة المرور</label>
              <div className="input-group">
                <span className="input-group-text bg-white"><i className="bi bi-lock"></i></span>
                <input id="password" name="password" type="password" dir="ltr" className="form-control form-control-lg"
                  value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
              </div>
            </div>
            <button type="submit" className="btn btn-primary btn-lg w-100" disabled={loading}>
              {loading ? (<><span className="spinner-border spinner-border-sm ms-2"></span>جارٍ تسجيل الدخول...</>) : "دخول"}
            </button>
          </form>
          <p className="small text-secondary text-center mt-4 mb-0">
            <i className="bi bi-shield-lock ms-1"></i>
            الاستخدام مخصّص للموظفين المخوّلين، وكل العمليات مسجّلة.
          </p>
        </div>
      </section>
    </main>
  );
}

export default LoginPage;

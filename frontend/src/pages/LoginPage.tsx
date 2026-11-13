import { useState, type FormEvent } from "react";

interface AuthUser {
  id: number;
  fullName: string;
  username: string;
  role: string;
  schoolId: number | null;
  directorateId: number | null;
}

interface LoginResponse {
  success: boolean;
  message?: string;
  data?: {
    token: string;
    user: AuthUser;
  };
}

interface LoginPageProps {
  onLogin: (token: string, user: AuthUser) => void;
}

function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch("http://localhost:5000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const result = (await response.json()) as LoginResponse;

      if (!response.ok || !result.success || !result.data?.token || !result.data.user) {
        throw new Error(result.message || "تعذر تسجيل الدخول");
      }

      onLogin(result.data.token, result.data.user);
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : "حدث خطأ أثناء الاتصال بالخادم",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      className="min-vh-100 d-flex align-items-center bg-light py-5"
      dir="rtl"
    >
      <div className="container">
        <div className="row justify-content-center">
          <div className="col-12 col-md-8 col-lg-5">
            <div className="text-center mb-4">
              <div
                className="bg-primary text-white rounded-4 d-inline-flex align-items-center justify-content-center mb-3 shadow-sm"
                style={{ width: 72, height: 72 }}
                aria-hidden="true"
              >
                <i className="bi bi-mortarboard-fill fs-2"></i>
              </div>
              <h1 className="h3 fw-bold mb-2" style={{ color: "#102a43" }}>
                نظام إدارة ومتابعة المدارس
              </h1>
              <p className="text-secondary mb-0">وزارة التربية والتعليم</p>
            </div>

            <section className="card border-0 shadow-sm rounded-4">
              <div className="card-body p-4 p-md-5">
                <h2 className="h5 fw-bold mb-1">تسجيل الدخول</h2>
                <p className="text-secondary mb-4">
                  أدخل بيانات حسابك للمتابعة إلى الصفحة الرئيسية.
                </p>

                {error && (
                  <div className="alert alert-danger" role="alert">
                    <i className="bi bi-exclamation-circle ms-2"></i>
                    {error}
                  </div>
                )}

                <form onSubmit={handleSubmit}>
                  <div className="mb-3">
                    <label htmlFor="username" className="form-label fw-semibold">
                      اسم المستخدم
                    </label>
                    <input
                      id="username"
                      name="username"
                      type="text"
                      className="form-control form-control-lg"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      autoComplete="username"
                      required
                      autoFocus
                    />
                  </div>
                  <div className="mb-4">
                    <label htmlFor="password" className="form-label fw-semibold">
                      كلمة المرور
                    </label>
                    <input
                      id="password"
                      name="password"
                      type="password"
                      className="form-control form-control-lg"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="current-password"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    className="btn btn-primary btn-lg w-100"
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <span className="spinner-border spinner-border-sm ms-2"></span>
                        جارٍ تسجيل الدخول...
                      </>
                    ) : (
                      "دخول"
                    )}
                  </button>
                </form>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

export default LoginPage;

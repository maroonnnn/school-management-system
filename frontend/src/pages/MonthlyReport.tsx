import { apiFetch } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { useState, type FormEvent } from "react";

interface MonthlyReportData {
  teacherName: string;
  month: string;
  scheduledLessons: number;
  countedLessons: number;
  partialAttendance: number;
  incompleteRecords: number;
  noAttendanceRecords: number;
  uncoveredMovements: number;
  uncountedLessons: number;
  completionPercentage: number;
}

interface MonthlyDetailedLesson {
  lesson_date: string;
  day_name: string;
  period_number: number;
  start_time: string;
  end_time: string;
  attendance_movements: string;
  lesson_status: string;
  manual_reasons: string;
}

function formatIssueDate() {
  return new Intl.DateTimeFormat("ar-SY", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date());
}

function formatMonth(value: string) {
  if (!/^\d{4}-\d{2}$/.test(value)) return value;
  const [year, monthNumber] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("ar-SY", {
    year: "numeric",
    month: "long",
  }).format(new Date(year, monthNumber - 1, 1));
}

function MonthlyReport() {
  const { user } = useAuth();
  const isTeacher = user?.role === "TEACHER";
  const [employeeNumber, setEmployeeNumber] = useState(user?.employeeNumber ?? "");
  const [month, setMonth] = useState("2026-10");
  const [detailedReport, setDetailedReport] = useState<MonthlyDetailedLesson[]>([]);
  const [report, setReport] = useState<MonthlyReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setReport(null);
    setDetailedReport([]);

    try {
      const query =
        `employeeNumber=${encodeURIComponent(employeeNumber)}` +
        `&month=${encodeURIComponent(month)}`;

      const [summaryResult, detailedResult] = await Promise.all([
        apiFetch<{ data: MonthlyReportData[] }>(`/reports/monthly?${query}`),
        apiFetch<{ data: MonthlyDetailedLesson[] }>(`/reports/monthly/detailed?${query}`),
      ]);

      if (!summaryResult.data || summaryResult.data.length === 0) {
        setError("لا توجد بيانات لهذا المدرّس في الشهر المحدد.");
        return;
      }

      setReport(summaryResult.data[0]);
      setDetailedReport(detailedResult.data ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "حدث خطأ أثناء الاتصال بالخادم",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-vh-100 bg-light" dir="rtl">
      {/* الشريط العلوي - يظهر على الشاشة فقط */}
      <nav className="navbar navbar-dark shadow-sm no-print" style={{ backgroundColor: "#102a43" }}>
        <div className="container-fluid px-4">
          <div className="d-flex align-items-center gap-3 py-2">
            <div
              className="bg-white rounded-3 d-flex align-items-center justify-content-center"
              style={{ width: 48, height: 48 }}
            >
              <i className="bi bi-mortarboard-fill fs-3 text-primary"></i>
            </div>
            <div>
              <div className="fw-bold text-white">نظام إدارة ومتابعة المدارس</div>
              <small className="text-white-50">وزارة التربية والتعليم</small>
            </div>
          </div>
          <span className="badge rounded-pill bg-light text-primary px-3 py-2">
            التقارير والإحصائيات
          </span>
        </div>
      </nav>

      <main className="container py-4 py-lg-5">
        {/* عنوان الصفحة - يظهر على الشاشة فقط */}
        <div className="mb-4 no-print">
          <div className="text-primary fw-semibold mb-2">
            <i className="bi bi-house-door ms-1"></i>
            لوحة التحكم / التقارير
          </div>
          <h2 className="fw-bold mb-2" style={{ color: "#102a43" }}>
            التقرير الشهري للحضور
          </h2>
          <p className="text-secondary mb-0">
            متابعة حضور الكادر التعليمي واحتساب النصاب التدريسي الشهري
          </p>
        </div>

        {/* نموذج البحث */}
        <div className="card border-0 shadow-sm rounded-4 mb-4 no-print">
          <div className="card-body p-4">
            <div className="d-flex align-items-center gap-2 mb-4">
              <i className="bi bi-search text-primary fs-5"></i>
              <h5 className="fw-bold mb-0">البحث عن التقرير</h5>
            </div>
            <form onSubmit={handleSearch}>
              <div className="row g-3 align-items-end">
                <div className="col-md-5">
                  <label className="form-label fw-semibold">الرقم الوظيفي</label>
                  <input
                    type="text"
                    className="form-control form-control-lg"
                    value={employeeNumber}
                    onChange={(e) => setEmployeeNumber(e.target.value)}
                    readOnly={isTeacher}
                    placeholder="أدخل الرقم الوظيفي"
                    required
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label fw-semibold">الشهر المطلوب</label>
                  <input
                    type="month"
                    className="form-control form-control-lg"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                    required
                  />
                </div>
                <div className="col-md-3">
                  <button type="submit" className="btn btn-primary btn-lg w-100" disabled={loading}>
                    {loading ? (
                      <>
                        <span className="spinner-border spinner-border-sm ms-2"></span>
                        جارٍ البحث...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-search ms-2"></i>
                        عرض التقرير
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>

        {error && (
          <div className="alert alert-warning rounded-3 no-print">
            <i className="bi bi-exclamation-triangle ms-2"></i>
            {error}
          </div>
        )}

        {report && (
          <>
            {/* زر الطباعة خارج مساحة التقرير */}
            <div className="d-flex justify-content-end mb-3 no-print">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => window.print()}
              >
                <i className="bi bi-printer ms-2"></i>
                طباعة التقرير / حفظ PDF
              </button>
            </div>

            {/* هذه المنطقة وحدها ستظهر في النسخة المطبوعة */}
            <section className="report-print-area" aria-label="التقرير الشهري">
              <header className="official-report-header">
                <div className="official-report-emblem">
                  <i className="bi bi-mortarboard-fill"></i>
                </div>
                <div className="official-report-heading">
                  <div className="official-country">الجمهورية العربية السورية</div>
                  <div className="official-ministry">وزارة التربية والتعليم</div>
                  <div className="official-directorate">مديرية التربية والتعليم: غير محددة في بيانات التقرير الحالية</div>
                </div>
                <div className="official-report-number">
                  <span>تاريخ الإصدار</span>
                  <strong>{formatIssueDate()}</strong>
                </div>
              </header>

              <div className="official-report-title">
                <h1>التقرير الشهري للحضور والنصاب التدريسي</h1>
                <div>عن شهر {formatMonth(report.month)}</div>
              </div>

              {/* بيانات الموظف والمدرسة */}
              <section className="official-info-section">
                <h2 className="official-section-title">أولاً: البيانات التعريفية</h2>
                <div className="official-info-grid">
                  <div><span>اسم المدرّس:</span><strong>{report.teacherName}</strong></div>
                  <div><span>الرقم الوظيفي:</span><strong>{employeeNumber}</strong></div>
                  <div><span>اسم المدرسة:</span><strong>غير متوفر ضمن بيانات التقرير الحالية</strong></div>
                  <div><span>الاختصاص:</span><strong>غير متوفر ضمن بيانات التقرير الحالية</strong></div>
                  <div><span>الشهر:</span><strong>{formatMonth(report.month)}</strong></div>
                  <div><span>عدد الحصص المجدولة:</span><strong>{report.scheduledLessons}</strong></div>
                </div>
              </section>

              {/* الملخص */}
              <section className="official-summary-section">
                <h2 className="official-section-title">ثانياً: ملخص الحضور الشهري</h2>
                <div className="official-summary-grid">
                  <SummaryItem label="الحصص المجدولة" value={report.scheduledLessons} />
                  <SummaryItem label="الحصص المحتسبة" value={report.countedLessons} />
                  <SummaryItem label="الحضور الجزئي" value={report.partialAttendance} />
                  <SummaryItem label="السجلات غير المكتملة" value={report.incompleteRecords} />
                  <SummaryItem label="لا يوجد سجل حضور" value={report.noAttendanceRecords} />
                  <SummaryItem label="حركات لا تغطي الحصة" value={report.uncoveredMovements} />
                  <SummaryItem label="الحصص غير المحتسبة" value={report.uncountedLessons} />
                  <SummaryItem label="نسبة إنجاز النصاب" value={`${report.completionPercentage}%`} />
                </div>
                <div className="official-progress-caption">
                  نسبة الحصص المحتسبة من إجمالي الحصص المجدولة: <strong>{report.completionPercentage}%</strong>
                </div>
                <div className="official-progress-track">
                  <div style={{ width: `${Math.min(100, Math.max(0, report.completionPercentage))}%` }}></div>
                </div>
              </section>

              {/* التفاصيل */}
              <section className="official-details-section">
                <h2 className="official-section-title">ثالثاً: الكشف التفصيلي للحصص</h2>
                <table className="official-report-table">
                  <thead>
                    <tr>
                      <th>التاريخ</th>
                      <th>اليوم</th>
                      <th>الحصة</th>
                      <th>وقت الحصة</th>
                      <th>حركات الحضور</th>
                      <th>الحالة</th>
                      <th>الملاحظات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailedReport.map((lesson, index) => (
                      <tr key={`${lesson.lesson_date}-${lesson.period_number}-${index}`}>
                        <td>{lesson.lesson_date}</td>
                        <td>{lesson.day_name}</td>
                        <td>{lesson.period_number}</td>
                        <td dir="ltr">{lesson.start_time} - {lesson.end_time}</td>
                        <td>{lesson.attendance_movements || "—"}</td>
                        <td>{lesson.lesson_status}</td>
                        <td>{lesson.manual_reasons || "—"}</td>
                      </tr>
                    ))}
                    {detailedReport.length === 0 && (
                      <tr>
                        <td colSpan={7}>لا توجد حصص مسجلة لهذا الشهر.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </section>

              {/* التواقيع */}
              <section className="official-signatures">
                <div>
                  <strong>مدير المدرسة</strong>
                  <span>الاسم: ................................</span>
                  <span>التوقيع: .............................</span>
                </div>
                <div>
                  <strong>الختم الرسمي</strong>
                  <span className="official-stamp-placeholder">مكان الختم</span>
                </div>
                <div>
                  <strong>الجهة المدققة</strong>
                  <span>الاسم: ................................</span>
                  <span>التوقيع: .............................</span>
                </div>
              </section>

              <div className="official-report-footer">
                <span>نظام إدارة ومتابعة المدارس التابع لوزارة التربية والتعليم</span>
                <span>وثيقة إدارية - يرجى مراجعة البيانات قبل اعتمادها</span>
              </div>
            </section>
          </>
        )}

        <footer className="text-center text-secondary small mt-5 pb-3 no-print">
          نظام إدارة ومتابعة المدارس التابع لوزارة التربية والتعليم
        </footer>
      </main>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="official-summary-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default MonthlyReport;

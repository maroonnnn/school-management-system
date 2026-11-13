# مشروع التخرج — النظام المركزي لإدارة ومتابعة المدارس

> **تعليمات لـ Claude:** هذا الملف هو المرجع الوحيد لحالة المشروع. اقرأه أولاً ولا تعيد قراءة كل ملفات المشروع؛ افتح فقط الملفات المتعلقة بالمهمة الحالية.
> بعد كل جلسة عمل: حدّث قسم "الحالة الحالية" و"سجل التقدم" و"القرارات".
> القرارات المهمة (معمارية، تقنيات جديدة، حذف/تغيير منطق موجود، تغيير نطاق المتطلبات) → اسأل المستخدم أولاً. باقي التفاصيل نفّذها مباشرة.
> المستخدم يتواصل بالعربية (لهجة شامية).

- المتطلبات: ملف SRS (PDF) في جذر المشروع، الإصدار 0.3. أرقام المتطلبات بصيغة `FR-<وحدة>-<رقم>` (AUTH, DATA, SCH, ATT, REQ, MSG, RPT, DASH, ALG) و `NFR-xx`.
- الموعد النهائي: **2026-12-13** (شهر من 2026-11-13).

## التقنيات
| الطبقة | التقنية |
|---|---|
| Frontend | React 19 + TypeScript + Vite + Bootstrap 5 (RTL)، في `frontend/` |
| Backend | Node.js + Express 5 + TypeScript (tsx)، في `backend/` — `npm run dev` |
| Database | PostgreSQL عبر `pg` (استعلامات SQL مباشرة)، الإعدادات في `backend/.env` |
| Auth | JWT + bcryptjs |

## بنية الكود (مختصر)
- `backend/src/app.ts` — تسجيل المسارات: `/api/auth`, `/api/reports`, `/api/requests`, `/api/health`
- `backend/src/utils/http.ts` — `handle()` يلف الـ handlers (HttpError → status، تكرار pg → 409)، و`requireString/requireId/optionalDate`. **استخدمه بكل route جديد.**
- `scope.service.ts`: `readableSchoolIds(user)` و`resolveReadableSchool(user, ?schoolId)` للقراءة حسب النطاق.
- `backend/src/routes/*` → `services/*` (منطق + SQL). كل route محمي: `authenticateToken` ثم `requireRole(...)`، وبيانات الأشخاص تمر عبر `scope.service.ts`، والاطلاع/التعديل يُسجّل بـ `audit()`.
- JWT فيه: id, role, employeeId, schoolId, directorateId. والـ login يرجّع كمان employeeNumber.
- قواعد النطاق: TEACHER نفسه فقط، PRINCIPAL/DEPUTY مدرستهم، DIRECTORATE مدارس مديريتها، MINISTRY مجمّع فقط (بدون أفراد)، STAFF لا شيء.
- Frontend:
  - `App.tsx` — كل المسارات (react-router-dom 7). صفحة جديدة = أضفها بـ `config/navigation.ts` (القائمة + بطاقات الرئيسية + الأدوار) ثم Route بـ App.tsx ملفوف بـ `<RequireAuth roles=...>`.
  - `context/AuthContext.tsx` — `useAuth()`: user, login, logout. الجلسة بـ sessionStorage.
  - `services/api.ts` — `apiFetch(path)` يضيف JWT ويرمي `ApiError` بالرسالة العربية؛ 401 → خروج تلقائي. **استخدمه لكل طلب جديد.**
  - `layouts/MainLayout.tsx` — شريط علوي + قائمة جانبية (منسدلة على الموبايل). الأنماط بآخر `index.css`.
  - `types/auth.ts` — Role, AuthUser, roleLabels.
  - `hooks/useApi.ts` — `useApi<T>(path|null)` → { data, loading, error, reload } للقراءة. للكتابة استخدم apiFetch مباشرة.
  - `components/ui.tsx` — PageHeader, Alert, Loading, Field, SchoolPicker (للمديرية/الوزارة)، DuplicateWarning.
  - pages: LoginPage, HomePage, DirectorateRequests, MonthlyReport.
- التشغيل: `.claude/launch.json` فيه backend (5000) و frontend (5173).
- Git: repo خاص بالمشروع، فرع `main`. `.env` غير مرفوع (انظر `backend/.env.example`).
- قاعدة البيانات: الـ schema الكامل في `database/schema.sql` (مُصدَّر بـ pg_dump من القاعدة الحقيقية). 24 جدول: ministries, directorates, schools, roles, users, employees, employee_assignments, teacher_profiles, students, student_enrollments, academic_years, grades, classes, sections, subjects, teaching_assignments, timetables, timetable_periods, attendance_events (+ trigger `validate_attendance_sequence`), assessments, school_requests, request_status_history, request_attachments, school_deputy_authorizations.
- البيانات الحالية قليلة جداً (مستخدمَين + مدرسة واحدة) → نحتاج seed.
- أدوات PostgreSQL: `C:/Program Files/PostgreSQL/18/bin/` (pg_dump, psql) — غير موجودة بالـ PATH.
- إذا تغيّر الـ schema: عدّل بملف migration بـ `database/migrations/` وأعد تصدير schema.sql.

## الحالة الحالية (آخر تحديث: 2026-11-13)
- ✅ تسجيل دخول JWT (FR-AUTH-01 جزئياً)
- ✅ الطلبات الإدارية: إنشاء/عرض/تغيير حالة (FR-REQ جزئياً)
- ✅ التقرير الشهري للمعلم + تفصيلي (FR-RPT-01 جزئياً، FR-SCH-06/07 جزئياً)
- ⬜ كل الباقي حسب الخطة أدناه

## الخطة (4 أسابيع) — الأولوية: ما يُعرض في المناقشة يعمل من البداية للنهاية

### الأسبوع 1 (11-13 → 11-19): الأساس + البيانات
- [x] 0.1 الكود يتجمّع بدون أخطاء TypeScript (backend + frontend)، والاتصال بالقاعدة شغّال
- [x] 0.2a `database/schema.sql`
- [x] 0.2b `database/seed.sql` يُولَّد من `database/generate_seed.py` (لا تعدّل seed.sql يدوياً). مُختبر على قاعدة `school_seed_test`: 5 مدارس، 85 موظف، 750 طالب، 900 حصة بدون تعارض، 3268 حدث حضور (آخر 4 أسابيع)، 15 طلب. كل المستخدمين كلمة سرهم `Test@1234`: ministry.admin, directorate.admin, principal1..5, deputy1..5, staff1..5, supervisor1..5
- [x] قاعدة جديدة `school_pilot` (schema + migrations + seed)، والـ `.env` صار `DB_NAME=school_pilot`. القاعدة القديمة بقيت كما هي.
- [x] migration `001_teacher_login.sql`: `users.employee_id` + دور TEACHER. المعلمون يدخلون بـ `t<رقم>`. بعد إضافة الموجّهين أول معلم بمدرسة 1 صار `t1006` (= EMP-1006)، والمعلمين EMP-1006..1018 بمدرسة 1.
- إعادة بناء القاعدة من الصفر: createdb → `schema.sql` → `seed.sql`. بعد أي migration جديد: طبّقه ثم أعد تصدير schema.sql.
- [x] 0.3 React Router + Layout عربي RTL + قائمة جانبية حسب الدور + انتهاء الجلسة بعد 30 دقيقة خمول (FR-AUTH-02 من جهة الواجهة)
- [x] AUTH-03/04/06: `requireRole(...)` بـ `middleware/auth.middleware.ts` + `services/scope.service.ts` (`assertCanViewEmployee`). مطبّق على التقارير والطلبات. مُختبر بـ 11 حالة.
- [x] AUTH-07/08/10: جدول `audit_logs` (migration 002) غير قابل للتعديل/الحذف بـ trigger. `audit()` بـ `services/audit.service.ts` يسجّل: LOGIN, LOGIN_FAILED, ACCESS_DENIED, VIEW_TEACHER_REPORT, REQUEST_STATUS_CHANGE.
- [x] AUTH-05: صفحة `/users` + `routes/users.routes.ts`. الوزارة تنشئ كل الأدوار، المديرية تنشئ مدراء مدارسها، المدير ينشئ نائب/موظف/معلم (المعلم لازم يُربط بملف معلم).
- [ ] AUTH-02 من جهة الخادم: JWT حالياً 8 ساعات؛ الخمول 30 دقيقة مطبّق بالواجهة فقط
- [x] DATA-01: `/schools` (الوزارة كل المديريات، المديرية مدارسها فقط)
- [x] DATA-02/03: `/staff` + `routes/employees.routes.ts` — الإضافة والتعديل للمدير فقط، النائب والمديرية قراءة فقط (DATA-11)
- [x] DATA-04/05/08: `/students` + `routes/academics.routes.ts` — صفوف وشعب السنة الحالية، أسماء طلاب كل شعبة، إضافة/تعديل طالب (المدير والنائب)
- [x] DATA-06: تحذير التكرار (409 + `duplicates`) للموظفين والطلاب، والواجهة تعرض "متابعة رغم ذلك" (`confirmDuplicate: true`)
- [x] DATA-07 + AUTH-13: دور SUPERVISOR (موجّه) + صفحة `/grades` + `routes/grades.routes.ts`. المسار: DRAFT (الموجّه يدخل العلامات) → SUBMITTED → APPROVED (المدير). المدير يقدر يرجّعها بسبب. بعد الاعتماد العلامات مقفولة بـ trigger بالقاعدة (migration 003).
- [ ] إدارة المواد من الواجهة (حالياً GET فقط، المواد تأتي من seed)

### الأسبوع 2 (11-20 → 11-26): الجداول + الحضور
- [ ] SCH-01, 04..11: جدول الحصص، النصاب، الإجازات، عرض جدول المعلم
- [ ] ATT: أحداث خام غير قابلة للتعديل (06, 07, 08)، تصنيف يومي (09, 10, ALG-01)، التصحيحات واعتمادها (12, 13)، إدخال يدوي بديل (14)، انقطاع الكهرباء (18, 19)
- [ ] ATT-25..27: ترحيل الأحداث إلى ملف Excel

### الأسبوع 3 (11-27 → 12-03): التعرّف على الوجه + الطلبات + المراسلات
- [ ] ATT-01..05, 22, 24: تسجيل الوجه والتعرّف (متجه رقمي فقط، بدون حفظ صور)
- [ ] ATT-21: تخزين محلي عند انقطاع الإنترنت ثم مزامنة
- [ ] REQ: إكمال الحالات، المرفقات، التعليقات، الإعادة، الإغلاق، الأولوية الموزونة (15..18, ALG-02..04)
- [ ] MSG-01..12: تعاميم، وارد/صادر، حالة الفتح

### الأسبوع 4 (12-04 → 12-13): التقارير + اللوحات + التسليم
- [ ] RPT: اعتماد التقرير، تقرير المدرسة، الطلبات، الوزارة، تصدير Excel/PDF عربي RTL
- [ ] DASH-01..07 + تنبيهات ALG-07..11
- [ ] اختبارات وحدة للخوارزميات (NFR-13)، مراجعة الأمان (NFR-04..06)
- [ ] بيانات عرض نهائية + سيناريو المناقشة + إصلاحات

## القرارات
| التاريخ | القرار | السبب |
|---|---|---|
| 2026-11-13 | هذا الملف (CLAUDE.md) هو سجل التقدم الوحيد | يُحمَّل تلقائياً كل جلسة |
| 2026-11-13 | التعرّف على الوجه بخدمة Python منفصلة (`face-service/`) يستدعيها الـ backend | اختيار المستخدم: دقة أعلى |
| 2026-11-13 | كل الوحدات مطلوبة (حضور+وجه، طلبات، تقارير/لوحات، مراسلات) — الترتيب حسب الخطة | اختيار المستخدم |
| 2026-11-13 | backend يستخدم قاعدة `school_pilot` الجديدة، والقديمة تبقى | اختيار المستخدم |
| 2026-11-13 | ربط users بـ employees + دور TEACHER | اختيار المستخدم، لـ FR-AUTH-12 |
| 2026-11-13 | دور SUPERVISOR (موجّه) مستوى مدرسة، يدخل النتائج والمدير يعتمدها | اختيار المستخدم، لـ DATA-07 |
| 2026-11-13 | أعمدة DATE ترجع نص `YYYY-MM-DD` (setTypeParser بـ database.ts) | كانت التواريخ تطلع يوم قبل |
| 2026-11-13 | القاعدة أُنشئت يدوياً بـ pgAdmin → نستخرجها بـ `pg_dump --schema-only` إلى `database/schema.sql` ونكمل بملفات migration | توثيق وإمكانية إعادة البناء |

## أسئلة مفتوحة (بانتظار المستخدم)
- لا يوجد حالياً

## مشاكل معروفة (للإصلاح لاحقاً)
- اختبارات API: استخدم Python (urllib) مش curl من Git Bash، لأن curl يخرب العربي. مثال جاهز بالسجل أدناه.
- التقرير الشهري يحسب الأيام المستقبلية من الشهر الحالي كـ "بدون سجل حضور" → يجب قصّ الفترة حتى اليوم (أسبوع 4 - RPT).
- `GET /api/requests` غير موجود؛ الموجود `/api/requests/directorate` فقط.
- صفحة مراجعة الطلبات لا تعرض اسم الحالة لـ APPROVED/IN_PROGRESS/COMPLETED/REJECTED (فارغة).
- audit_logs فيه صف تجريبي واحد (LOGIN بدون مستخدم، 2026-11-13) ما بينمسح — طبيعي.

## سجل التقدم
- 2026-11-13: إنشاء الخطة وهذا الملف.
- 2026-11-13: المهمة 0.1 + تصدير schema.sql. التالي: 0.2b seed.sql ثم 0.3 Router.
- 2026-11-13: seed generator جاهز ومُختبر. ملاحظة: أقصى نصاب منفّذ بالبرنامج 18 من 22 (مقصود — يظهر "متبقي" بالتقارير).
- 2026-11-13: school_pilot جاهزة، login + التقريرين مُختبرين عبر API. إصلاح: التقرير الشهري الملخّص كان يرجع فاضي لما `timetables.effective_to = NULL`. التالي: 0.3 Router + Layout.
- 2026-11-13: git repo جديد للمشروع. 0.3 خلص ومُختبر بالمتصفح (directorate.admin يشوف الطلبات، t1005 ممنوع منها). التالي: AUTH بالـ backend (أدوار + عزل النطاق + سجل التدقيق).
- 2026-11-13: AUTH backend خلص (أدوار، نطاق، سجل تدقيق). التالي: DATA-01..08 (CRUD مدارس/معلمين/طلاب/صفوف) + AUTH-05.
- 2026-11-13: DATA + AUTH-05 خلصوا (4 صفحات جديدة). مُختبر: 20 حالة API + المتصفح (principal1: الكادر، الصفوف، تحذير التكرار). ملاحظة: اختبار curl من Git Bash يخرب العربي — استخدم المتصفح أو ملف JSON بـ UTF-8. **الأسبوع 1 خلص تقريباً قبل موعده.** التالي: الأسبوع 2 — جداول الحصص SCH.
- 2026-11-13: DATA-07 (النتائج) خلص. أعيد بناء school_pilot (schema + 003 + seed جديد فيه 5 موجّهين و10 اختبارات). إصلاح: التواريخ كانت تطلع يوم قبل. مُختبر: 18 حالة API + المتصفح كـ supervisor1. **الأسبوع 1 خلص بالكامل.** التالي: SCH-01, 04..11.

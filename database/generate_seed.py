"""
Generates database/seed.sql — Pilot data: 1 ministry, 1 directorate, 5 schools.
Deterministic (fixed random seed). Run:  python database/generate_seed.py
All test users share the password: Test@1234
"""
import random
from datetime import date, datetime, timedelta
from pathlib import Path

random.seed(2026)
OUT = Path(__file__).with_name("seed.sql")
PWD_HASH = "$2b$10$SAKUlO8Oz4TTGlHoKAhODOV6ol.mZx4rI7KLzszf7sSfowAnTAJmq"  # Test@1234
TODAY = date(2026, 11, 12)
YEAR_START = date(2026, 9, 1)

sql: list[str] = []


def q(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def insert(table, cols, rows):
    if not rows:
        return
    for i in range(0, len(rows), 500):
        chunk = rows[i:i + 500]
        vals = ",\n".join("(" + ", ".join(q(v) for v in r) + ")" for r in chunk)
        override = " OVERRIDING SYSTEM VALUE" if cols[0] == "id" else ""
        sql.append(f"INSERT INTO {table} ({', '.join(cols)}){override} VALUES\n{vals};")


FIRST_M = ["أحمد", "محمد", "خالد", "عمر", "سامر", "ياسر", "فادي", "حسن", "علي", "مازن", "رامي", "باسل", "وسيم", "نزار", "طارق"]
FIRST_F = ["سارة", "ريم", "لينا", "هبة", "رنا", "دعاء", "منى", "نور", "سلمى", "ديما", "روان", "غادة", "هالة", "لمى", "يارا"]
LAST = ["الخطيب", "الحلبي", "الشامي", "العلي", "النجار", "الحسن", "المصري", "الأحمد", "السيد", "الزعبي", "العمر", "القاسم", "الرفاعي", "الحمصي", "درويش"]


def person():
    first = random.choice(FIRST_M + FIRST_F)
    return f"{first} {random.choice(FIRST_M)} {random.choice(LAST)}"


# ---------------- organisation ----------------
insert("ministries", ["id", "name"], [(1, "وزارة التربية والتعليم")])
insert("directorates", ["id", "ministry_id", "name", "phone"], [(1, 1, "مديرية تربية دمشق", "011-2210000")])
SCHOOLS = [
    (1, "مدرسة التجربة", "SCH-001", "المزة"),
    (2, "مدرسة ابن خلدون", "SCH-002", "المالكي"),
    (3, "مدرسة الشهيد باسل", "SCH-003", "ركن الدين"),
    (4, "مدرسة دار السلام", "SCH-004", "الميدان"),
    (5, "مدرسة الفيحاء", "SCH-005", "باب توما"),
]
insert("schools", ["id", "directorate_id", "name", "school_code", "address", "school_type"],
       [(i, 1, n, c, f"دمشق - {a}", "PREPARATORY") for i, n, c, a in SCHOOLS])

insert("roles", ["id", "name", "description"], [
    (1, "MINISTRY_ADMIN", "مسؤول الوزارة"),
    (2, "DIRECTORATE_ADMIN", "مسؤول المديرية"),
    (3, "SCHOOL_PRINCIPAL", "مدير المدرسة"),
    (4, "SCHOOL_DEPUTY", "نائب مدير المدرسة"),
    (5, "SCHOOL_STAFF", "موظف المدرسة"),
    (6, "TEACHER", "معلم"),
])

insert("academic_years", ["id", "name", "start_date", "end_date", "is_current"],
       [(1, "2026-2027", YEAR_START, date(2027, 6, 30), True)])

SUBJECTS = [  # (id, name, weekly units per section)
    (1, "اللغة العربية", 5), (2, "الرياضيات", 5), (3, "العلوم", 4), (4, "اللغة الإنكليزية", 4),
    (5, "اللغة الفرنسية", 2), (6, "الاجتماعيات", 3), (7, "التربية الدينية", 2), (8, "المعلوماتية", 2),
    (9, "التربية الرياضية", 2), (10, "التربية الفنية", 1),
]
insert("subjects", ["id", "name"], [(s, n) for s, n, _ in SUBJECTS])
UNITS = {s: u for s, _, u in SUBJECTS}

# teacher templates per school: (specialization label, subjects taught)
TEACHER_TEMPLATES = [
    ("لغة عربية", [1]), ("لغة عربية", [1]), ("رياضيات", [2]), ("رياضيات", [2]),
    ("علوم", [3]), ("علوم", [3]), ("لغة إنكليزية", [4]), ("لغة إنكليزية", [4]),
    ("لغة فرنسية", [5]), ("اجتماعيات", [6]), ("تربية دينية", [7, 10]),
    ("معلوماتية", [8]), ("تربية رياضية", [9]),
]
DAYS = [1, 2, 3, 4, 5]  # 1 = Sunday ... 5 = Thursday (matches EXTRACT(DOW)+1)
PERIODS = {1: "08:00", 2: "08:45", 3: "09:30", 4: "10:30", 5: "11:15", 6: "12:00"}


def plus45(t):
    h, m = map(int, t.split(":"))
    m += 45
    return f"{h + m // 60:02d}:{m % 60:02d}"


ids = {k: 0 for k in ["emp", "ea", "cls", "sec", "stu", "enr", "ta", "tt", "tp", "user", "ev", "req", "hist"]}


def nid(k):
    ids[k] += 1
    return ids[k]


employees, teacher_profiles, assignments = [], [], []
classes, sections, students, enrollments = [], [], [], []
teaching, timetables, periods, users = [], [], [], []
all_staff = []  # (ea_id, position)
school_users = {}

users.append((nid("user"), 1, 1, None, None, "مسؤول الوزارة", "ministry.admin", "ministry@example.test", PWD_HASH, None))
dir_user = nid("user")
users.append((dir_user, 2, None, 1, None, "مسؤول مديرية دمشق", "directorate.admin", "directorate@example.test", PWD_HASH, None))

emp_no = 1000
stu_no = 50000
for school_id, _, _, _ in SCHOOLS:
    def new_employee(position, quota=None, spec=None):
        global emp_no
        emp_no += 1
        e = nid("emp")
        name = person()
        employees.append((e, f"EMP-{emp_no}", name, f"09{random.randint(30000000, 99999999)}",
                          date(random.randint(2000, 2022), random.randint(1, 12), 1)))
        if spec:
            teacher_profiles.append((e, spec, "إجازة جامعية", random.randint(1, 25)))
        ea = nid("ea")
        assignments.append((ea, e, school_id, position,
                            "TEACHING_TIMETABLE" if position == "TEACHER" else "FULL_DAY", quota, YEAR_START))
        all_staff.append((ea, position))
        return ea, name, e

    _, principal_name, principal_emp = new_employee("PRINCIPAL")
    _, deputy_name, deputy_emp = new_employee("DEPUTY")
    admin_emps = [new_employee("ADMINISTRATIVE") for _ in range(2)]
    teachers = []  # (ea_id, subjects)
    for spec, subs in TEACHER_TEMPLATES:
        ea, t_name, t_emp = new_employee("TEACHER", 22, spec)
        teachers.append((ea, subs))
        users.append((nid("user"), 6, None, None, school_id, t_name, f"t{emp_no}", None, PWD_HASH, t_emp))

    p_user, d_user, s_user = nid("user"), nid("user"), nid("user")
    users += [
        (p_user, 3, None, None, school_id, principal_name, f"principal{school_id}", f"principal{school_id}@example.test", PWD_HASH, principal_emp),
        (d_user, 4, None, None, school_id, deputy_name, f"deputy{school_id}", f"deputy{school_id}@example.test", PWD_HASH, deputy_emp),
        (s_user, 5, None, None, school_id, admin_emps[0][1], f"staff{school_id}", f"staff{school_id}@example.test", PWD_HASH, admin_emps[0][2]),
    ]
    school_users[school_id] = (p_user, d_user)

    # classes 7..9, sections أ / ب
    school_sections = []
    for grade in (7, 8, 9):
        c = nid("cls")
        classes.append((c, school_id, 1, f"الصف {['السابع', 'الثامن', 'التاسع'][grade - 7]}", grade))
        for sname in ("أ", "ب"):
            s = nid("sec")
            sections.append((s, c, sname, 30))
            school_sections.append(s)
            for _ in range(25):
                stu_no += 1
                st = nid("stu")
                students.append((st, f"STU-{stu_no}", person(), date(2026 - grade - 6, random.randint(1, 12), random.randint(1, 28)),
                                 f"{random.choice(FIRST_M)} {random.choice(LAST)}", f"09{random.randint(30000000, 99999999)}"))
                enrollments.append((nid("enr"), st, s, YEAR_START))

    # teaching assignments: split each subject's sections between its teachers
    teacher_busy = {ea: set() for ea, _ in teachers}
    for subj_id, units in UNITS.items():
        subj_teachers = [ea for ea, subs in teachers if subj_id in subs]
        for idx, s in enumerate(school_sections):
            ea = subj_teachers[idx * len(subj_teachers) // len(school_sections)]
            teaching.append([nid("ta"), ea, s, subj_id, units, YEAR_START])

    # timetable per section — greedy with retries so no teacher is double-booked
    for s in school_sections:
        tt = nid("tt")
        timetables.append((tt, s, 1, f"برنامج الشعبة {s}", YEAR_START, True))
        lessons = [(ta[0], ta[1]) for ta in teaching if ta[2] == s for _ in range(ta[4])]
        for _attempt in range(500):
            slots = [(d, p) for d in DAYS for p in PERIODS]
            random.shuffle(lessons)
            placed, ok = [], True
            busy_copy = {k: set(v) for k, v in teacher_busy.items()}
            for ta_id, ea in lessons:
                slot = next((sl for sl in slots if sl not in busy_copy[ea]), None)
                if slot is None:
                    ok = False
                    break
                slots.remove(slot)
                busy_copy[ea].add(slot)
                placed.append((ta_id, slot))
            if ok:
                teacher_busy = busy_copy
                break
        else:
            raise RuntimeError(f"could not schedule section {s}")
        for ta_id, (d, p) in sorted(placed, key=lambda x: x[1]):
            periods.append((nid("tp"), tt, ta_id, s, d, p, PERIODS[p], plus45(PERIODS[p])))

insert("employees", ["id", "employee_number", "full_name", "phone", "hire_date"], employees)
insert("teacher_profiles", ["employee_id", "specialization", "qualification", "years_of_experience"], teacher_profiles)
insert("employee_assignments", ["id", "employee_id", "school_id", "position_type", "work_schedule_type", "weekly_quota_units", "start_date"], assignments)
insert("users", ["id", "role_id", "ministry_id", "directorate_id", "school_id", "full_name", "username", "email", "password_hash", "employee_id"], users)
insert("classes", ["id", "school_id", "academic_year_id", "name", "grade_level"], classes)
insert("sections", ["id", "class_id", "name", "capacity"], sections)
insert("students", ["id", "student_number", "full_name", "date_of_birth", "guardian_name", "guardian_phone"], students)
insert("student_enrollments", ["id", "student_id", "section_id", "enrollment_date"], enrollments)
insert("teaching_assignments", ["id", "employee_assignment_id", "section_id", "subject_id", "weekly_quota_units", "start_date"], teaching)
insert("timetables", ["id", "section_id", "academic_year_id", "name", "effective_from", "is_approved"], timetables)
insert("timetable_periods", ["id", "timetable_id", "teaching_assignment_id", "section_id", "day_of_week", "period_number", "start_time", "end_time"], periods)

insert("school_deputy_authorizations", ["school_id", "deputy_user_id", "authorized_by"],
       [(sid, d, p) for sid, (p, d) in school_users.items() if sid in (1, 2)])

# ---------------- attendance: last 4 weeks of working days ----------------
events = []
day = TODAY - timedelta(days=27)
while day <= TODAY:
    if day.weekday() in (6, 0, 1, 2, 3):  # Sun..Thu (Python: Mon=0)
        for ea, pos in all_staff:
            r = random.random()
            if r < 0.04:
                continue  # absent
            late = r < 0.14
            t_in = datetime.combine(day, datetime.min.time()) + timedelta(
                hours=7, minutes=random.randint(35, 58) + (random.randint(20, 60) if late else 0))
            leave_early = random.random() < 0.05
            t_out = datetime.combine(day, datetime.min.time()) + timedelta(
                hours=13 if not leave_early else 11, minutes=random.randint(0, 40))
            method = "FACE" if random.random() > 0.05 else "MANUAL"
            events.append((ea, "IN", t_in, method))
            events.append((ea, "OUT", t_out, "FACE"))
    day += timedelta(days=1)

ev_rows = []
for ea, typ, t, method in sorted(events, key=lambda e: (e[0], e[2])):
    school = next(a[2] for a in assignments if a[0] == ea)
    principal = school_users[school][0]
    manual = method == "MANUAL"
    ev_rows.append((ea, typ, t.strftime("%Y-%m-%d %H:%M:%S") + "+03", method,
                    principal if manual else None, "تعذّر التعرف على الوجه" if manual else None))
insert("attendance_events", ["employee_assignment_id", "event_type", "event_time", "verification_method", "recorded_by", "manual_reason"], ev_rows)

# ---------------- school requests ----------------
REQ_SAMPLES = [
    ("MAINTENANCE", "إصلاح سقف قاعة", "تسرّب مياه من سقف الصف الثامن أ"),
    ("TEACHERS", "نقص مدرّس رياضيات", "شاغر مدرّس رياضيات للصف التاسع"),
    ("TEXTBOOKS", "نقص كتب العلوم", "نقص 30 كتاب علوم للصف السابع"),
    ("FURNITURE", "مقاعد دراسية", "حاجة إلى 20 مقعداً"),
    ("COMPUTERS", "أجهزة مخبر المعلوماتية", "5 أجهزة معطّلة في المخبر"),
    ("OTHER", "تأمين مياه الشرب", "عطل في خزان المياه"),
]
FLOW = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "IN_PROGRESS", "COMPLETED"]
req_rows, hist_rows = [], []
for school_id, _, _, _ in SCHOOLS:
    p_user = school_users[school_id][0]
    for k in range(3):
        typ, title, desc = random.choice(REQ_SAMPLES)
        rid = nid("req")
        created = datetime(2026, 10, random.randint(1, 28), 9, random.randint(0, 59))
        final = random.choice(FLOW + ["REJECTED", "DRAFT"])
        req_rows.append((rid, f"REQ-{created:%Y%m%d}-{rid:08d}", school_id, p_user, typ, title, desc, final,
                         None if final == "DRAFT" else created.strftime("%Y-%m-%d %H:%M:%S") + "+03",
                         created.strftime("%Y-%m-%d %H:%M:%S") + "+03"))
        hist_rows.append((rid, None, "DRAFT", p_user, None, created))
        if final == "DRAFT":
            continue
        path = FLOW[:2] + ["REJECTED"] if final == "REJECTED" else FLOW[:FLOW.index(final) + 1]
        prev, t = "DRAFT", created
        for st in path:
            t += timedelta(days=random.randint(1, 3))
            by = p_user if st == "SUBMITTED" else dir_user
            hist_rows.append((rid, prev, st, by, "لا تتوفر ميزانية حالياً" if st == "REJECTED" else None, t))
            prev = st
insert("school_requests", ["id", "request_number", "school_id", "created_by", "request_type", "title", "description", "status", "submitted_at", "created_at"], req_rows)
insert("request_status_history", ["request_id", "old_status", "new_status", "changed_by", "notes", "changed_at"],
       [(r, o, n, b, note, t.strftime("%Y-%m-%d %H:%M:%S") + "+03") for r, o, n, b, note, t in hist_rows])

# ---------------- write ----------------
seq_fix = """
-- sync sequences with explicit ids
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.table_name, c.column_name, pg_get_serial_sequence(c.table_schema||'.'||c.table_name, c.column_name) AS seq
           FROM information_schema.columns c
           WHERE c.table_schema = 'public' AND pg_get_serial_sequence(c.table_schema||'.'||c.table_name, c.column_name) IS NOT NULL
  LOOP
    EXECUTE format('SELECT setval(%L, COALESCE((SELECT MAX(%I) FROM %I), 0) + 1, false)', r.seq, r.column_name, r.table_name);
  END LOOP;
END $$;
"""
header = f"""-- AUTO-GENERATED by database/generate_seed.py — do not edit by hand.
-- Pilot data: 1 ministry, 1 directorate, 5 schools, {len(employees)} employees, {len(students)} students,
-- {len(periods)} timetable periods, {len(ev_rows)} attendance events, {len(req_rows)} requests.
-- Load into an EMPTY database created from schema.sql (which already includes migrations). All test users: password Test@1234
BEGIN;
DELETE FROM roles;  -- migrations may have inserted roles; seed defines them with fixed ids
"""
OUT.write_text(header + "\n\n".join(sql) + "\n" + seq_fix + "COMMIT;\n", encoding="utf-8")
print(header)

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
SCHOOLS = [  # (id, name, code, area) — stage in SCHOOL_STAGE
    (1, "مدرسة التجربة", "SCH-001", "المزة"),
    (2, "مدرسة ابن خلدون", "SCH-002", "المالكي"),
    (3, "مدرسة الشهيد باسل", "SCH-003", "ركن الدين"),
    (4, "مدرسة دار السلام", "SCH-004", "الميدان"),
    (5, "ثانوية الفيحاء", "SCH-005", "باب توما"),
]
SCHOOL_STAGE = {1: 2, 2: 2, 3: 2, 4: 2, 5: 3}  # 2 = حلقة ثانية (7-9), 3 = حلقة ثالثة (10-12)
STAGE_GRADES = {2: [(7, "السابع"), (8, "الثامن"), (9, "التاسع")],
                3: [(10, "العاشر"), (11, "الحادي عشر"), (12, "الثاني عشر")]}
SECTION_TRACKS = {"أ": "GENERAL_SCIENTIFIC", "ب": "GENERAL_LITERARY"}  # stage 3 only
insert("schools", ["id", "directorate_id", "name", "school_code", "address", "stage"],
       [(i, 1, n, c, f"دمشق - {a}", SCHOOL_STAGE[i]) for i, n, c, a in SCHOOLS])

insert("roles", ["id", "name", "description"], [
    (1, "MINISTRY_ADMIN", "مسؤول الوزارة"),
    (2, "DIRECTORATE_ADMIN", "مسؤول المديرية"),
    (3, "SCHOOL_PRINCIPAL", "مدير المدرسة"),
    (4, "SCHOOL_DEPUTY", "نائب مدير المدرسة"),
    (5, "SCHOOL_STAFF", "موظف المدرسة"),
    (6, "TEACHER", "معلم"),
    (7, "SUPERVISOR", "موجّه"),
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
CONTRACT_SPECS = {"لغة فرنسية", "اجتماعيات", "معلوماتية", "تربية رياضية"}  # وكلاء (~30%)
# Contract teachers shared between two schools: (home school, spec) -> other school they also cover
SHARED_CONTRACT = {(1, "لغة فرنسية"): 2, (3, "معلوماتية"): 4}
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
teacher_profile_by_emp = {}  # emp -> mutable profile list
ea_emp = {}                  # assignment id -> employee id
busy_by_emp = {}             # employee id -> set((day, period)) across ALL schools
shared_waiting = {}          # school_id -> [(emp, spec, subs, name)] contract teachers coming from another school
classes, sections, students, enrollments = [], [], [], []
teaching, timetables, periods, users = [], [], [], []
all_staff = []  # (ea_id, position)
school_users = {}
supervisor_users = {}
section_enrollments = {}  # section_id -> [enrollment ids]

users.append((nid("user"), 1, 1, None, None, "مسؤول الوزارة", "ministry.admin", "ministry@example.test", PWD_HASH, None))
dir_user = nid("user")
users.append((dir_user, 2, None, 1, None, "مسؤول مديرية دمشق", "directorate.admin", "directorate@example.test", PWD_HASH, None))

emp_no = 1000
stu_no = 50000
for school_id, _, _, _ in SCHOOLS:
    def add_assignment(e, position):
        ea = nid("ea")
        assignments.append([ea, e, school_id, position,
                            "TEACHING_TIMETABLE" if position == "TEACHER" else "FULL_DAY", None, YEAR_START])
        all_staff.append((ea, position))
        ea_emp[ea] = e
        return ea

    def new_employee(position, spec=None, contract=False):
        global emp_no
        emp_no += 1
        e = nid("emp")
        name = person()
        hire_year = random.randint(2016, 2024) if contract else random.randint(1998, 2022)
        employees.append((e, f"EMP-{emp_no}", name, f"09{random.randint(30000000, 99999999)}",
                          date(hire_year, random.randint(1, 12), 1)))
        if spec:
            prof = [e, spec, "إجازة جامعية", 2026 - hire_year, "CONTRACT" if contract else "PERMANENT", None]
            teacher_profiles.append(prof)
            teacher_profile_by_emp[e] = prof
        busy_by_emp[e] = set()
        return add_assignment(e, position), name, e

    _, principal_name, principal_emp = new_employee("PRINCIPAL")
    _, deputy_name, deputy_emp = new_employee("DEPUTY")
    admin_emps = [new_employee("ADMINISTRATIVE") for _ in range(2)]
    _, sup_name, sup_emp = new_employee("SUPERVISOR")
    teachers = []  # (ea_id, subjects)
    covered_by_other = {spec for (_, spec, _, _) in shared_waiting.get(school_id, [])}
    for spec, subs in TEACHER_TEMPLATES:
        if spec in covered_by_other:
            continue
        ea, t_name, t_emp = new_employee("TEACHER", spec, contract=spec in CONTRACT_SPECS)
        teachers.append((ea, subs))
        users.append((nid("user"), 6, None, None, school_id, t_name, f"t{emp_no}", None, PWD_HASH, t_emp))
        other = SHARED_CONTRACT.get((school_id, spec))
        if other:
            shared_waiting.setdefault(other, []).append((t_emp, spec, subs, t_name))
    # contract teachers from another school get a second assignment here
    for t_emp, spec, subs, _ in shared_waiting.get(school_id, []):
        teachers.append((add_assignment(t_emp, "TEACHER"), subs))

    p_user, d_user, s_user = nid("user"), nid("user"), nid("user")
    users += [
        (p_user, 3, None, None, school_id, principal_name, f"principal{school_id}", f"principal{school_id}@example.test", PWD_HASH, principal_emp),
        (d_user, 4, None, None, school_id, deputy_name, f"deputy{school_id}", f"deputy{school_id}@example.test", PWD_HASH, deputy_emp),
        (s_user, 5, None, None, school_id, admin_emps[0][1], f"staff{school_id}", f"staff{school_id}@example.test", PWD_HASH, admin_emps[0][2]),
        (nid("user"), 7, None, None, school_id, sup_name, f"supervisor{school_id}", f"supervisor{school_id}@example.test", PWD_HASH, sup_emp),
    ]
    school_users[school_id] = (p_user, d_user)
    supervisor_users[school_id] = users[-1][0]

    # classes per stage, sections أ / ب (stage 3: أ علمي، ب أدبي)
    school_sections = []
    stage = SCHOOL_STAGE[school_id]
    for grade, grade_name in STAGE_GRADES[stage]:
        c = nid("cls")
        classes.append((c, school_id, 1, f"الصف {grade_name}", grade))
        for sname in ("أ", "ب"):
            s = nid("sec")
            sections.append((s, c, sname, 30, SECTION_TRACKS[sname] if stage == 3 else None))
            school_sections.append(s)
            for _ in range(25):
                stu_no += 1
                st = nid("stu")
                students.append((st, f"STU-{stu_no}", person(), date(2026 - grade - 6, random.randint(1, 12), random.randint(1, 28)),
                                 f"{random.choice(FIRST_M)} {random.choice(LAST)}", f"09{random.randint(30000000, 99999999)}"))
                enr = nid("enr")
                enrollments.append((enr, st, s, YEAR_START))
                section_enrollments.setdefault(s, []).append(enr)

    # teaching assignments: split each subject's sections between its teachers
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
            busy_copy = {k: set(v) for k, v in busy_by_emp.items()}
            for ta_id, ea in lessons:
                emp = ea_emp[ea]
                slot = next((sl for sl in slots if sl not in busy_copy[emp]), None)
                if slot is None:
                    ok = False
                    break
                slots.remove(slot)
                busy_copy[emp].add(slot)
                placed.append((ta_id, slot))
            if ok:
                busy_by_emp = busy_copy
                break
        else:
            raise RuntimeError(f"could not schedule section {s}")
        for ta_id, (d, p) in sorted(placed, key=lambda x: x[1]):
            periods.append((nid("tp"), tt, ta_id, s, d, p, PERIODS[p], plus45(PERIODS[p])))

# contract teachers: per-school hours = actual load there; directorate allotment = total (+ maybe 2 spare)
load_by_ea = {}
for ta in teaching:
    load_by_ea[ta[1]] = load_by_ea.get(ta[1], 0) + ta[4]
for a in assignments:
    prof = teacher_profile_by_emp.get(a[1])
    if a[3] == "TEACHER" and prof and prof[4] == "CONTRACT":
        a[5] = load_by_ea.get(a[0], 0)
for prof in teacher_profiles:
    if prof[4] == "CONTRACT":
        prof[5] = sum(a[5] for a in assignments if a[1] == prof[0]) + random.choice([0, 0, 2])

insert("employees", ["id", "employee_number", "full_name", "phone", "hire_date"], employees)
insert("teacher_profiles", ["employee_id", "specialization", "qualification", "years_of_experience", "employment_type", "contract_weekly_hours"], teacher_profiles)
insert("employee_assignments", ["id", "employee_id", "school_id", "position_type", "work_schedule_type", "weekly_quota_units", "start_date"], assignments)
insert("users", ["id", "role_id", "ministry_id", "directorate_id", "school_id", "full_name", "username", "email", "password_hash", "employee_id"], users)
insert("classes", ["id", "school_id", "academic_year_id", "name", "grade_level"], classes)
insert("sections", ["id", "class_id", "name", "capacity", "track"], sections)
insert("students", ["id", "student_number", "full_name", "date_of_birth", "guardian_name", "guardian_phone"], students)
insert("student_enrollments", ["id", "student_id", "section_id", "enrollment_date"], enrollments)
insert("teaching_assignments", ["id", "employee_assignment_id", "section_id", "subject_id", "weekly_quota_units", "start_date"], teaching)
insert("timetables", ["id", "section_id", "academic_year_id", "name", "effective_from", "is_approved"], timetables)
insert("timetable_periods", ["id", "timetable_id", "teaching_assignment_id", "section_id", "day_of_week", "period_number", "start_time", "end_time"], periods)

insert("school_deputy_authorizations", ["school_id", "deputy_user_id", "authorized_by"],
       [(sid, d, p) for sid, (p, d) in school_users.items() if sid in (1, 2)])

# ---------------- leaves (FR-SCH-09): 2 teachers per school, 2 past working days each ----------------
work_dates = [TODAY - timedelta(days=i) for i in range(1, 25) if (TODAY - timedelta(days=i)).weekday() in (6, 0, 1, 2, 3)]
LEAVE_KINDS = [("SICK", "إجازة مرضية"), ("OFFICIAL_ASSIGNMENT", "تكليف رسمي: دورة تدريبية بالمديرية")]
leave_rows, on_leave = [], set()  # on_leave: (employee_id, date)
for school_id, _, _, _ in SCHOOLS:
    school_teachers = [a for a in assignments if a[2] == school_id and a[3] == "TEACHER"
                       and teacher_profile_by_emp[a[1]][4] == "PERMANENT"]
    for k, a in enumerate(random.sample(school_teachers, 2)):
        start = random.choice(work_dates[2:])
        end = start + timedelta(days=1) if start.weekday() != 3 else start
        kind, note = LEAVE_KINDS[k]
        leave_rows.append((a[1], kind, start, end, note, school_users[school_id][0]))
        d = start
        while d <= end:
            on_leave.add((a[1], d))
            d += timedelta(days=1)

# ---------------- attendance: last 4 weeks of working days ----------------
contract_eas = {a[0] for a in assignments
                if a[3] == "TEACHER" and a[1] in teacher_profile_by_emp and teacher_profile_by_emp[a[1]][4] == "CONTRACT"}
ta_ea = {ta[0]: ta[1] for ta in teaching}
lesson_slots = {}  # ea -> {day_of_week: [period numbers]}
for p in periods:
    lesson_slots.setdefault(ta_ea[p[2]], {}).setdefault(p[4], []).append(p[5])
events = []
day = TODAY - timedelta(days=27)
while day <= TODAY:
    if day.weekday() in (6, 0, 1, 2, 3):  # Sun..Thu (Python: Mon=0)
        dow = (day.weekday() + 1) % 7 + 1  # Sun=1 .. Thu=5
        for ea, pos in all_staff:
            r = random.random()
            if r < 0.04 or (ea_emp.get(ea), day) in on_leave:
                continue  # absent / on leave
            if ea in contract_eas:
                # contract teachers come only on days they teach at this school, around their lessons
                todays = sorted(lesson_slots.get(ea, {}).get(dow, []))
                if not todays:
                    continue
                first = datetime.combine(day, datetime.strptime(PERIODS[todays[0]], "%H:%M").time())
                last = datetime.combine(day, datetime.strptime(plus45(PERIODS[todays[-1]]), "%H:%M").time())
                late_min = random.randint(5, 25) if r < 0.12 else 0
                events.append((ea, "IN", first - timedelta(minutes=random.randint(5, 15) - late_min), "FACE"))
                events.append((ea, "OUT", last + timedelta(minutes=random.randint(2, 10)), "FACE"))
                continue
            late = r < 0.14
            t_in = datetime.combine(day, datetime.min.time()) + timedelta(
                hours=7, minutes=random.randint(35, 58) + (random.randint(20, 60) if late else 0))
            leave_early = random.random() < 0.05
            # teachers leave after their last lesson (~12:45); admin staff after official hours (13:30)
            out_start = (13 * 60 if pos == "TEACHER" else 13 * 60 + 25) if not leave_early else 11 * 60
            t_out = datetime.combine(day, datetime.min.time()) + timedelta(minutes=out_start + random.randint(0, 35))
            method = "FACE" if random.random() > 0.05 else "MANUAL"
            events.append((ea, "IN", t_in, method))
            events.append((ea, "OUT", t_out, "FACE"))
    day += timedelta(days=1)

events = [e for e in events if not (e[1] == "OUT" and random.random() < 0.015)]
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
FLOW = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "IN_PROGRESS", "COMPLETED", "CLOSED"]
FINALS = ["SUBMITTED", "UNDER_REVIEW", "UNDER_REVIEW", "APPROVED", "IN_PROGRESS", "COMPLETED", "CLOSED", "REJECTED", "RETURNED", "DRAFT"]
req_rows, hist_rows, comment_rows = [], [], []
for school_id, _, _, _ in SCHOOLS:
    p_user = school_users[school_id][0]
    for k in range(4):
        typ, title, desc = random.choice(REQ_SAMPLES)
        rid = nid("req")
        created = datetime(2026, 10, random.randint(5, 30), 9, random.randint(0, 59)) if k < 3 else datetime(2026, 11, random.randint(1, 11), 10, 0)
        final = random.choice(FINALS)
        severity, affected = random.randint(1, 5), random.choice([0, 15, 25, 50, 150])
        req_rows.append((rid, f"REQ-{created:%Y%m%d}-{rid:06d}", school_id, p_user, typ, title, desc, final, severity, affected,
                         None if final == "DRAFT" else created.strftime("%Y-%m-%d %H:%M:%S") + "+03",
                         created.strftime("%Y-%m-%d %H:%M:%S") + "+03"))
        hist_rows.append((rid, None, "DRAFT", p_user, None, created))
        if final == "DRAFT":
            continue
        if final == "REJECTED":
            path = ["SUBMITTED", "UNDER_REVIEW", "REJECTED"]
        elif final == "RETURNED":
            path = ["SUBMITTED", "UNDER_REVIEW", "RETURNED"]
        else:
            path = FLOW[:FLOW.index(final) + 1]
        prev, t = "DRAFT", created
        for st in path:
            t += timedelta(days=random.randint(1, 3))
            by = p_user if st in ("SUBMITTED", "CLOSED") else dir_user
            note = {"REJECTED": "لا تتوفر ميزانية حالياً لهذا البند", "RETURNED": "يرجى إرفاق صورة توضّح حجم الضرر وعدد الصفوف المتأثرة",
                    "CLOSED": "تم استلام التنفيذ، شكراً"}.get(st)
            hist_rows.append((rid, prev, st, by, note, t))
            prev = st
        if final in ("UNDER_REVIEW", "IN_PROGRESS"):
            comment_rows.append((rid, dir_user, "تم التواصل مع قسم الأبنية المدرسية لتقدير الكلفة", t + timedelta(hours=2)))
            comment_rows.append((rid, p_user, "شكراً، الوضع يتفاقم مع بداية الشتاء", t + timedelta(hours=26)))
insert("school_requests", ["id", "request_number", "school_id", "created_by", "request_type", "title", "description", "status",
                           "severity", "affected_students", "submitted_at", "created_at"], req_rows)
insert("request_status_history", ["request_id", "old_status", "new_status", "changed_by", "notes", "changed_at"],
       [(r, o, n, b, note, t.strftime("%Y-%m-%d %H:%M:%S") + "+03") for r, o, n, b, note, t in hist_rows])
insert("request_comments", ["request_id", "author_id", "body", "created_at"],
       [(r, a, b, t.strftime("%Y-%m-%d %H:%M:%S") + "+03") for r, a, b, t in comment_rows])

insert("employee_leaves", ["employee_id", "leave_type", "start_date", "end_date", "notes", "created_by"], leave_rows)

# ---------------- lesson log (FR-SCH-08): one compensated lesson per school ----------------
lesson_exec_rows = []
for school_id, _, _, _ in SCHOOLS:
    sec_ids = {s[0] for s in sections if next(c for c in classes if c[0] == s[1])[1] == school_id}
    p = next(p for p in periods if p[3] in sec_ids)
    d = next(x for x in work_dates[3:] if (x.weekday() + 1) % 7 + 1 == p[4])
    lesson_exec_rows.append((p[0], d, "COMPENSATED", "عُوّضت بحصة إضافية يوم السبت", school_users[school_id][0]))
insert("lesson_executions", ["timetable_period_id", "lesson_date", "status", "notes", "recorded_by"], lesson_exec_rows)

# ---------------- outages (FR-ATT-18) and corrections (FR-ATT-12) ----------------
outage_rows, correction_rows = [], []
for school_id in (1, 3):
    d = work_dates[4 if school_id == 1 else 7]
    outage_rows.append((school_id, f"{d} 07:30:00+03", f"{d} 09:10:00+03", "POWER", "انقطاع كهرباء عام بالمنطقة",
                        school_users[school_id][0]))
for school_id, _, _, _ in SCHOOLS:
    principal, deputy = school_users[school_id]
    tchs = [a for a in assignments if a[2] == school_id and a[3] == "TEACHER"]
    a_pending, a_done = tchs[0], tchs[1]
    correction_rows.append((a_pending[0], str(work_dates[1]), "PRESENT", "كان المعلم بجولة صفية ونسي تسجيل الخروج",
                            deputy, "PENDING", None, None))
    correction_rows.append((a_done[0], str(work_dates[6]), "EXCUSED", "مراجعة طبية بموجب تقرير رسمي",
                            deputy, "APPROVED", principal, f"{work_dates[5]} 10:00:00+03"))
insert("power_outages", ["school_id", "starts_at", "ends_at", "outage_type", "notes", "recorded_by"], outage_rows)
insert("attendance_corrections", ["employee_assignment_id", "work_date", "corrected_status", "reason", "proposed_by",
                                  "status", "decided_by", "decided_at"], correction_rows)

# ---------------- results (FR-DATA-07): one approved + one draft assessment per school ----------------
assessments, grade_rows, approve_sql = [], [], []
for school_id, _, _, _ in SCHOOLS:
    sup, principal = supervisor_users[school_id], school_users[school_id][0]
    first_sections = sorted({ta[2] for ta in teaching if next(a[2] for a in assignments if a[0] == ta[1]) == school_id})[:2]
    for k, sec in enumerate(first_sections):
        ta = next(t for t in teaching if t[2] == sec and t[3] == 2)  # math
        aid = len(assessments) + 1
        assessments.append((aid, ta[0], "مذاكرة الرياضيات الأولى", "QUIZ", date(2026, 10, 20), 20, sup))
        for enr in section_enrollments[sec]:
            grade_rows.append((aid, enr, round(random.uniform(8, 20) * 2) / 2, sup))
        if k == 0:
            approve_sql.append(
                f"UPDATE assessments SET status='APPROVED', submitted_at='2026-10-22 10:00+03', "
                f"approved_by={principal}, approved_at='2026-10-23 09:00+03' WHERE id={aid};")
insert("assessments", ["id", "teaching_assignment_id", "title", "assessment_type", "assessment_date", "max_score", "created_by"], assessments)
insert("grades", ["assessment_id", "enrollment_id", "score", "recorded_by"], grade_rows)
sql.extend(approve_sql)

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

"""
Builds every report diagram:
  1. generates the ERD parts (src/erd_*.mmd) from the live PostgreSQL schema, so they never drift from the database;
  2. renders each src/*.mmd to out/<name>.svg and out/<name>.png with headless Chrome + Mermaid (needs internet once,
     the Mermaid library is loaded from a CDN).

Usage (from the project root, database school_pilot running):
    python docs/diagrams/build.py
Environment: PGPASSWORD (default "postgres"), CHROME (path to chrome.exe), PSQL (path to psql.exe).
"""
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC, OUT = HERE / "src", HERE / "out"
CHROME = os.environ.get("CHROME", r"C:\Program Files\Google\Chrome\Application\chrome.exe")
PSQL = os.environ.get("PSQL", r"C:\Program Files\PostgreSQL\18\bin\psql.exe")
MERMAID = "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs"

# (file, title, tables). Tables referenced from a part but not listed in it appear as key-only context entities.
ERD_PARTS = [
    ("erd_1_organisation", ["ministries", "directorates", "schools", "roles", "users"]),
    ("erd_2_staff", ["employees", "employee_assignments", "teacher_profiles", "school_deputy_authorizations"]),
    ("erd_3_classes_students", ["academic_years", "classes", "sections", "students", "student_enrollments"]),
    ("erd_4_teaching_timetables", ["subjects", "teaching_assignments", "timetables", "timetable_periods"]),
    ("erd_5_attendance", ["attendance_events", "face_embeddings", "attendance_corrections", "power_outages", "offline_captures"]),
    ("erd_6_leave_lessons_reports", ["employee_leaves", "lesson_executions", "report_approvals"]),
    ("erd_7_requests", ["school_requests", "request_status_history", "request_attachments", "request_comments"]),
    ("erd_8_messages_notifications", ["messages", "message_recipients", "message_attachments", "notifications",
                                      "notification_reads"]),
    ("erd_9_results_audit", ["result_sheets", "term_results", "result_corrections", "audit_logs"]),
]
SKIP_COLS = {"created_at", "updated_at"}
MAX_PLAIN_COLS = 5


def psql(query: str) -> list[list[str]]:
    env = {**os.environ, "PGPASSWORD": os.environ.get("PGPASSWORD", "postgres"), "PGCLIENTENCODING": "UTF8"}
    r = subprocess.run([PSQL, "-U", "postgres", "-d", "school_pilot", "-tA", "-F", "|", "-c", query],
                       capture_output=True, text=True, encoding="utf-8", env=env, check=True)
    return [line.split("|") for line in r.stdout.splitlines() if line.strip()]


def load_schema():
    cols: dict[str, list[tuple[str, str, bool]]] = {}
    for t, c, typ, nullable in psql(
        "select table_name, column_name, data_type, is_nullable from information_schema.columns "
        "where table_schema='public' order by table_name, ordinal_position"
    ):
        cols.setdefault(t, []).append((c, typ, nullable == "YES"))
    pk, unique, fks = {}, set(), []
    for rel, kind, col, ref in psql(
        "select c.conrelid::regclass::text, c.contype, a.attname, coalesce(c.confrelid::regclass::text, '') "
        "from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey) "
        "where c.connamespace = 'public'::regnamespace "
        "and (c.contype = 'p' or (c.contype in ('f','u') and cardinality(c.conkey) = 1))"
    ):
        if kind == "p":
            pk.setdefault(rel, set()).add(col)
        elif kind == "u":
            unique.add((rel, col))
        else:
            fks.append((rel, col, ref))
    return cols, pk, unique, fks


def short_type(t: str) -> str:
    return {"character varying": "varchar", "timestamp with time zone": "timestamptz", "double precision": "float",
            "timestamp without time zone": "timestamp"}.get(t, t).replace(" ", "_")


def build_erds():
    cols, pk, unique, fks = load_schema()
    for name, tables in ERD_PARTS:
        inside = set(tables)
        # Author columns (created_by, recorded_by, decided_by...) point to users from almost every table; drawing them
        # would bury the real structure, so they stay as FK attributes and the edge is omitted outside part 1.
        rels = [(c, col, p) for c, col, p in fks if c in inside and (p != "users" or name == "erd_1_organisation")]
        context = {p for _, _, p in rels if p not in inside}
        lines = ["erDiagram"]
        for child, col, parent in rels:
            nullable = next(n for cn, _, n in cols[child] if cn == col)
            one = (child, col) in unique
            left = "|o" if nullable else "||"
            right = "o|" if one else "o{"
            lines.append(f"  {parent} {left}--{right} {child} : {col}")
        fk_cols = {(c, col) for c, col, _ in fks}
        for t in tables + sorted(context):
            lines.append(f"  {t} {{")
            plain = 0
            for c, typ, _ in cols[t]:
                is_pk, is_fk = c in pk.get(t, set()), (t, c) in fk_cols
                if t in context and not is_pk:
                    continue  # context entity: key only
                if not is_pk and not is_fk:
                    if c in SKIP_COLS or plain >= MAX_PLAIN_COLS:
                        continue
                    plain += 1
                key = " PK" if is_pk else (" FK" if is_fk else "")
                lines.append(f"    {short_type(typ)} {c}{key}")
            lines.append("  }")
        (SRC / f"{name}.mmd").write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"generated {name}.mmd ({len(tables)} tables, {len(context)} context)")


def chrome(args: list[str]) -> str:
    r = subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", *args],
                       capture_output=True, text=True, encoding="utf-8", timeout=180)
    return r.stdout


def render(mmd: Path):
    code = mmd.read_text(encoding="utf-8").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    cfg = ("{startOnLoad:true,theme:'neutral',securityLevel:'loose',fontFamily:'Arial',"
           "flowchart:{htmlLabels:false,useMaxWidth:false,curve:'basis'},er:{useMaxWidth:false,fontSize:13},"
           "sequence:{useMaxWidth:false},state:{useMaxWidth:false}}")
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / "m.html"
        page.write_text(f'<html><body style="margin:0;background:#fff"><pre class="mermaid">{code}</pre>'
                        f'<script type="module">import mermaid from "{MERMAID}"; mermaid.initialize({cfg});</script>'
                        f"</body></html>", encoding="utf-8")
        dom = chrome(["--virtual-time-budget=30000", "--dump-dom", page.as_uri()])
        m = re.search(r"<svg\b.*?</svg>", dom, re.S)
        if not m or "Syntax error" in m.group(0):
            raise RuntimeError(f"{mmd.name}: Mermaid failed to render")
        svg = m.group(0)
        vb = re.search(r'viewBox="([\d.\-]+) ([\d.\-]+) ([\d.]+) ([\d.]+)"', svg)
        w, h = (float(vb.group(3)), float(vb.group(4))) if vb else (1200.0, 800.0)
        svg = re.sub(r'style="max-width:[^"]*"', "", svg, count=1)
        svg = re.sub(r"<svg\b", f'<svg width="{w:.0f}" height="{h:.0f}"', svg, count=1)
        if 'xmlns="http://www.w3.org/2000/svg"' not in svg:
            svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"', 1)
        (OUT / f"{mmd.stem}.svg").write_text(svg, encoding="utf-8")
        shot = Path(tmp) / "s.html"
        shot.write_text(f'<html><body style="margin:0;background:#fff">{svg}</body></html>', encoding="utf-8")
        chrome([f"--screenshot={OUT / (mmd.stem + '.png')}", f"--window-size={int(w) + 20},{int(h) + 20}",
                "--force-device-scale-factor=2", "--default-background-color=ffffffff", shot.as_uri()])
    print(f"rendered {mmd.stem}  {w:.0f}x{h:.0f}")


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    SRC.mkdir(exist_ok=True)
    if "--no-erd" not in sys.argv:
        build_erds()
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    for f in sorted(SRC.glob("*.mmd")):
        if not only or f.stem in only:
            render(f)

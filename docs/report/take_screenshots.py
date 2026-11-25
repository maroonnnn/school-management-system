"""
High-resolution screenshots of the main screens for the report (Results chapter), written to docs/report/screenshots/.

How it works: headless Chrome opens a temporary wrapper page (served by the Vite dev server) that stores the login
token, loads the real application in a same-origin iframe, runs a few UI steps (choose a date, click a row...) and
is then captured at 2x resolution. The temporary wrapper folder is deleted at the end.

Prerequisites: backend (5000) and frontend dev server (5173) running, demo database loaded (database/rebuild.ps1),
Google Chrome installed.   Usage:   python docs/report/take_screenshots.py [shot_name ...]
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent / "screenshots"
WRAP_DIR = ROOT / "frontend" / "public" / "_shots"
APP = "http://localhost:5173"
API = "http://localhost:5000/api"
CHROME = os.environ.get("CHROME", r"C:\Program Files\Google\Chrome\Application\chrome.exe")
W = 1100  # viewport width in CSS px (the desktop layout with the side menu starts at 992)

JS_HELPERS = """
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const setValue = (el, v) => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
};
const byText = (d, sel, text) => [...d.querySelectorAll(sel)].find((e) => e.textContent.includes(text));
const scrollToText = (w, d, text) => { const e = byText(d, 'h1,h2,h3,h4,h5,h6', text); if (e) w.scrollTo({ top: e.getBoundingClientRect().top + w.scrollY - 75, behavior: 'instant' }); };
"""


def api(path, token=None, body=None):
    req = urllib.request.Request(API + path, method="POST" if body is not None else "GET",
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", **({"Authorization": "Bearer " + token} if token else {})})
    return json.loads(urllib.request.urlopen(req).read())


def login(username):
    d = api("/auth/login", body={"username": username, "password": "Test@1234"})["data"]
    return d["token"], d["user"]


def last_working_day():
    from datetime import date, timedelta
    d = date.today() - timedelta(days=1)
    while d.weekday() not in (6, 0, 1, 2, 3):
        d -= timedelta(days=1)
    return d.isoformat()


def top_request_id():
    token, _ = login("directorate.admin")
    rows = api("/requests", token)["data"]
    rows = [r for r in rows if r.get("priority") is not None]
    return max(rows, key=lambda r: r["priority"])["id"]


def shots():
    day = last_working_day()
    return [
        dict(name="01_login", user=None, path="/login", h=620, wait=3000, steps=""),
        dict(name="02_dashboard", user="directorate.admin", path="/", h=1080, wait=9000,
             steps="byText(d, 'button', 'الشهر الماضي').click(); await sleep(7000);"),
        dict(name="03_dashboard_schools", user="directorate.admin", path="/", h=900, wait=9000,
             steps="byText(d, 'button', 'الشهر الماضي').click(); await sleep(7000); scrollToText(w, d, 'مقارنة المدارس');"),
        dict(name="04_attendance", user="principal1", path="/attendance", h=1000, wait=6000,
             steps=f"setValue(d.querySelector('input[aria-label=\"التاريخ\"]'), '{day}'); await sleep(4000);"),
        dict(name="05_teacher_report", user="principal1", path="/reports", h=1200, wait=6000,
             steps="const s = d.querySelector('select[aria-label=\"المعلم\"]'); setValue(s, s.options[4].value); await sleep(6000);"),
        dict(name="06_request_priority", user="directorate.admin", path=f"/requests/review?open={top_request_id()}", w=1500, h=900, wait=9000, steps=""),
        dict(name="07_alerts", user="directorate.admin", path="/insights", h=1000, wait=14000, steps=""),
        dict(name="08_school_ranking", user="directorate.admin", path="/insights", h=1000, wait=8000,
             steps="byText(d, 'button.nav-link', 'مؤشر أداء').click(); await sleep(9000); d.querySelectorAll('tbody tr')[4].click(); await sleep(800);"),
        dict(name="09_term_results", user="supervisor1", path="/grades", h=860, wait=6000,
             steps="byText(d, 'button.list-group-item', 'الرياضيات').click(); await sleep(4000);"),
        dict(name="10_messages", user="ministry.admin", path="/messages", h=1000, wait=6000,
             steps="d.querySelector('.list-group-item').click(); await sleep(4000);"),
    ]


def run(shot):
    W = shot.get('w', 1100)
    token, user = login(shot["user"]) if shot["user"] else (None, None)
    WRAP_DIR.mkdir(parents=True, exist_ok=True)
    storage = (f"sessionStorage.setItem('sms.token', {json.dumps(token)}); sessionStorage.setItem('sms.user', {json.dumps(json.dumps(user))});"
               if token else "")
    html = f"""<!doctype html><html><body style="margin:0;background:#fff">
<iframe id="f" style="border:0;width:{W}px;height:{shot['h']}px;display:block"></iframe>
<script>{JS_HELPERS}
{storage}
const f = document.getElementById('f');
f.src = {json.dumps(shot['path'])};
(async () => {{
  await sleep({shot['wait']});
  const w = f.contentWindow, d = f.contentDocument;
  try {{ {shot['steps']} }} catch (e) {{ document.title = 'step error: ' + e; }}
  await sleep(1500);
}})();
</script></body></html>"""
    (WRAP_DIR / f"{shot['name']}.html").write_text(html, encoding="utf-8")
    target = OUT / f"{shot['name']}.png"
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
                    "--virtual-time-budget=60000", "--force-device-scale-factor=2", "--default-background-color=ffffffff",
                    f"--window-size={W},{shot['h']}", f"--screenshot={target}", f"{APP}/_shots/{shot['name']}.html"],
                   capture_output=True, text=True, timeout=240)
    print(("ok   " if target.exists() else "FAIL ") + shot["name"])


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    only = sys.argv[1:]
    try:
        for s in shots():
            if not only or s["name"] in only or any(s["name"].startswith(o) for o in only):
                run(s)
    finally:
        shutil.rmtree(WRAP_DIR, ignore_errors=True)

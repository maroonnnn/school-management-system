"""
Records the discussion demo as a video: drives the real running system with headless Chrome (Playwright),
shows an Arabic caption on every step, and writes docs/demo/demo.mp4.

Needs: backend (5000) and frontend (5173) running on a freshly rebuilt demo database (database/rebuild.ps1),
and `pip install playwright imageio-ffmpeg`. Uses the installed Google Chrome (no browser download).
Run:  python docs/demo/record_demo.py
"""
import subprocess
import time
from pathlib import Path

import imageio_ffmpeg
from playwright.sync_api import sync_playwright

BASE = "http://localhost:5173"
HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
PASSWORD = "Test@1234"

CAPTION_JS = """
(text) => {
  let el = document.getElementById('demo-caption');
  if (!el) {
    el = document.createElement('div'); el.id = 'demo-caption';
    el.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);max-width:82%;z-index:99999;' +
      'background:rgba(11,59,46,.94);color:#fff;border:2px solid #b9a26a;border-radius:14px;padding:12px 26px;' +
      'font:600 22px Cairo,Arial,sans-serif;direction:rtl;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.35)';
    document.body.appendChild(el);
  }
  el.textContent = text;
}
"""


def caption(page, text, seconds):
    page.evaluate(CAPTION_JS, text)
    time.sleep(seconds)


def goto(page, path, wait=2.5):
    page.goto(BASE + path)
    page.wait_for_load_state("networkidle")
    time.sleep(wait)


def login(page, user):
    page.evaluate("sessionStorage.clear()")
    goto(page, "/login", 1)
    page.locator("input").nth(0).fill(user)
    page.locator("input").nth(1).fill(PASSWORD)
    page.keyboard.press("Enter")
    page.wait_for_url(lambda u: not u.endswith("/login"), timeout=15000)
    page.wait_for_load_state("networkidle")
    time.sleep(2)


def scroll(page, y, seconds=1.5):
    page.mouse.wheel(0, y)
    time.sleep(seconds)


def run(page):
    # 0. landing page
    goto(page, "/welcome", 1)
    caption(page, "النظام المركزي لإدارة ومتابعة المدارس — جولة على النظام بأدواره المختلفة", 4)
    goto(page, "/login", 1)
    caption(page, "تسجيل الدخول بحساب وكلمة سر؛ كل دور بيشوف نطاق بياناته فقط", 4)

    # 1. directorate
    login(page, "directorate.admin")
    caption(page, "مدير المديرية: لوحة مؤشرات لكل مدارس المديرية، وتنبيهات تحتاج انتباهه", 5)
    scroll(page, 520)
    caption(page, "المؤشرات: الحضور، النصاب، الطلبات المفتوحة والمتأخرة، ووصول التعاميم", 6)
    scroll(page, 520)
    caption(page, "كل رقم هون هو نفس رقم التقرير المركزي المصدَّر لنفس الفترة", 5)
    goto(page, "/requests/review")
    caption(page, "طلبات المدارس مرتبة بدرجة أولوية قابلة للتفسير — أداة فرز وما بتقرر عن المدير", 6)
    page.locator("tbody tr, .list-group-item, [role=button]").first.click()
    time.sleep(2)
    caption(page, "بالضغط على الطلب: تفاصيله وسبب الدرجة وتاريخه وإجراءات المديرية", 6)
    goto(page, "/insights")
    caption(page, "التحليلات الذكية: كشف أنماط الحضور غير الطبيعية، كل تنبيه معه الأرقام والتواريخ", 7)
    page.get_by_role("button", name="مؤشر أداء المدارس").click()
    time.sleep(8)
    caption(page, "مؤشر أداء واحتياج المدارس وترتيبها — للمديرية والوزارة فقط", 6)

    # 2. principal
    login(page, "principal1")
    caption(page, "مدير المدرسة: يشوف مدرسته فقط", 4)
    goto(page, "/attendance")
    page.locator("input[type=date]").fill("2026-11-26")
    time.sleep(3)
    caption(page, "الحضور اليومي: كل موظف بدوامه المتوقع وتصنيفه الآلي مع السبب — النظام ما بيعلن غياباً بنفسه", 8)
    scroll(page, 300)
    goto(page, "/insights")
    caption(page, "مدير المدرسة بيشوف تنبيهات الحضور فقط؛ مؤشر ترتيب المدارس مخفي عنه", 6)
    goto(page, "/timetable")
    caption(page, "جدول الحصص: شبكة أيام × حصص مع إسناد المواد للمعلمين", 5)

    # 3. teacher
    login(page, "t1006")
    caption(page, "المعلم: يشوف بياناته فقط", 3)
    goto(page, "/my-schedule")
    caption(page, "جدولي ونصابي: النصاب المطلوب، المنفّذ، المتبقي، ووقت التدريس", 7)

    # 4. supervisor
    login(page, "supervisor1")
    caption(page, "الموجّه: مسؤول عن مراجعة وتصحيح المحصّلات المرفوعة", 4)
    goto(page, "/grades")
    page.get_by_text("الرياضيات — الصف السابع / أ").first.click()
    time.sleep(3)
    caption(page, "التصحيح بسبب إلزامي، وبيتسجّل بقيمته القديمة والجديدة، وبيوصل إشعار للمعلم", 7)
    scroll(page, 400)

    # 5. ministry
    login(page, "ministry.admin")
    caption(page, "الوزارة: أرقام مجمّعة فقط، وما بتشوف معلومات أي فرد", 5)
    goto(page, "/messages")
    caption(page, "التعاميم الوزارية مع تتبّع الفتح والتأكيد لكل مدرسة", 6)
    caption(page, "انتهت الجولة — شكراً", 3)


def main():
    RAW.mkdir(exist_ok=True)
    for f in RAW.glob("*.webm"):
        f.unlink()
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        ctx = browser.new_context(viewport={"width": 1280, "height": 720}, locale="ar",
                                  record_video_dir=str(RAW), record_video_size={"width": 1280, "height": 720})
        page = ctx.new_page()
        try:
            run(page)
        finally:
            ctx.close()
            browser.close()
    webm = max(RAW.glob("*.webm"), key=lambda f: f.stat().st_mtime)
    out = HERE / "demo.mp4"
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-i", str(webm), "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-crf", "23", str(out)], check=True, capture_output=True)
    print("saved", out, round(out.stat().st_size / 1e6, 1), "MB")


if __name__ == "__main__":
    main()

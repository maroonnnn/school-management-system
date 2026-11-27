import re
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

FONT = "Arial"
d = Document()
sec = d.sections[0]
sec.page_width, sec.page_height = Cm(21), Cm(29.7)
sec.left_margin = sec.right_margin = Cm(2.2); sec.top_margin = sec.bottom_margin = Cm(2)
for name in ("Normal","Heading 1","Heading 2","Heading 3"):
    st = d.styles[name]; st.font.name = FONT
    st.element.rPr.rFonts.set(qn("w:cs"), FONT); st.element.rPr.rFonts.set(qn("w:ascii"), FONT); st.element.rPr.rFonts.set(qn("w:hAnsi"), FONT)
    st.font.color.rgb = RGBColor(0,0,0) if name=="Normal" else RGBColor(0x0b,0x3b,0x2e)
d.styles["Normal"].font.size = Pt(12)
d.styles["Heading 1"].font.size = Pt(18); d.styles["Heading 2"].font.size = Pt(14); d.styles["Heading 3"].font.size = Pt(12.5)

def rtl(p, align=WD_ALIGN_PARAGRAPH.RIGHT):
    pPr = p._p.get_or_add_pPr()
    b = OxmlElement("w:bidi"); pPr.append(b)
    p.alignment = align

def runs(p, text, size=None, bold=False, color=None, italic=False):
    r = p.add_run(text); r.bold = bold; r.italic = italic
    r.font.name = FONT
    rPr = r._r.get_or_add_rPr()
    rf = rPr.find(qn("w:rFonts"))
    if rf is None: rf = OxmlElement("w:rFonts"); rPr.append(rf)
    rf.set(qn("w:cs"), FONT)
    rPr.append(OxmlElement("w:rtl"))
    if size: r.font.size = Pt(size)
    if color: r.font.color.rgb = RGBColor(*color)
    return r

def para(text, size=None, bold=False, align=WD_ALIGN_PARAGRAPH.RIGHT, after=8, color=None, italic=False, style=None, ltr=False):
    p = d.add_paragraph(style=style)
    if not ltr: rtl(p, align)
    else: p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    p.paragraph_format.space_after = Pt(after); p.paragraph_format.line_spacing = 1.3
    runs(p, text, size, bold, color, italic)
    return p

def shade(cell, hexcolor):
    tcPr = cell._tc.get_or_add_tcPr(); s = OxmlElement("w:shd")
    s.set(qn("w:val"), "clear"); s.set(qn("w:color"), "auto"); s.set(qn("w:fill"), hexcolor); tcPr.append(s)

def table(rows):
    n = len(rows[0]); t = d.add_table(rows=0, cols=n); t.style = "Table Grid"; t.alignment = WD_TABLE_ALIGNMENT.RIGHT
    tblPr = t._tbl.tblPr; bv = OxmlElement("w:bidiVisual"); tblPr.append(bv)
    for i, row in enumerate(rows):
        cells = t.add_row().cells
        for c, txt in zip(cells, row):
            p = c.paragraphs[0]; rtl(p)
            ltr = bool(re.fullmatch(r"[A-Za-z0-9_,. /+%:()\-]+", txt)) and len(txt) > 3 and not re.search("[\u0600-\u06FF]", txt)
            runs(p, txt, 10.5, bold=(i == 0), color=(255,255,255) if i == 0 else None)
            if i == 0: shade(c, "0B3B2E")
    d.add_paragraph().paragraph_format.space_after = Pt(6)

lines = []
for f in ("part1.md", "part2.md"):
    lines += open(f, encoding="utf-8").read().split("\n")
first_h1 = True; i = 0
while i < len(lines):
    L = lines[i].rstrip()
    if not L: i += 1; continue
    if L.startswith("@title"):
        for _ in range(4): para("", after=12)
        para(L[7:], 26, True, WD_ALIGN_PARAGRAPH.CENTER, 14, (0x0b,0x3b,0x2e))
    elif L.startswith("@sub2"): para(L[6:], 14, False, WD_ALIGN_PARAGRAPH.CENTER, 24)
    elif L.startswith("@sub"): para(L[5:], 15, False, WD_ALIGN_PARAGRAPH.CENTER, 10)
    elif L.startswith("@center"): para(L[8:], 13, False, WD_ALIGN_PARAGRAPH.CENTER, 8)
    elif L.startswith("@note"):
        para("", after=18); para(L[6:], 10.5, False, WD_ALIGN_PARAGRAPH.CENTER, 6, (0x80,0x40,0x00), True)
    elif L.startswith("# "):
        d.add_page_break(); h = d.add_heading(level=1); rtl(h); runs(h, L[2:], 18, True, (0x0b,0x3b,0x2e))
    elif L.startswith("## "):
        h = d.add_heading(level=2); rtl(h); runs(h, L[3:], 14, True, (0x0b,0x3b,0x2e))
    elif L.startswith("### "):
        h = d.add_heading(level=3); rtl(h); runs(h, L[4:], 12.5, True, (0x0b,0x3b,0x2e))
    elif L.startswith("|"):
        rows = []
        while i < len(lines) and lines[i].startswith("|"):
            rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")]); i += 1
        table(rows); continue
    elif L.startswith("- "):
        p = para("• " + L[2:], after=4); p.paragraph_format.right_indent = Cm(0.6)
    elif re.match(r"^(الجدول|الشكل) ", L) and ":" in L[:12] or L.startswith("الجدول A"):
        para(L, 11, True, after=4, color=(0x0b,0x3b,0x2e))
    elif L.startswith("[ملاحظة") or L.startswith("[TODO"):
        para(L, 10.5, False, italic=True, color=(0x80,0x40,0x00))
    elif re.match(r"^\[\d+\]", L): para(L, 10.5, ltr=True, after=5)
    else: para(L)
    i += 1

# page numbers footer
fp = sec.footer.paragraphs[0]; fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = fp.add_run()
for t, txt in (("begin", None), (None, "PAGE"), ("end", None)):
    if t:
        e = OxmlElement("w:fldChar"); e.set(qn("w:fldCharType"), t); r._r.append(e)
    else:
        e = OxmlElement("w:instrText"); e.set(qn("xml:space"), "preserve"); e.text = txt; r._r.append(e)
out = r"C:\Users\USER\Desktop\school-management-system\docs\report\Final_Year_Project_Report_AR.docx"
d.save(out); print("saved", out)

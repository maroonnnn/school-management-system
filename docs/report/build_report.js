// Builds docs/report/Final_Year_Project_Report.docx following the supplied report-writing guidelines:
// A4, margins 25 mm left / 20 mm others, Times New Roman 12 pt, justified, double spacing, blocked paragraphs,
// bold headings (chapters 14 pt), page number top right with a header on every page except the title page,
// numbered figures and tables, front matter (abstract, contents, lists, acknowledgements), appendices, references.
// Text marked [TODO: ...] (yellow) needs the author's input. Run:  node build_report.js
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Header, AlignmentType, TabStopType, PageNumber, LevelFormat,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, TableOfContents, StyleLevel, HeadingLevel,
} = require("docx");

const FIG_DIR = path.resolve(__dirname, "..", "diagrams", "out");
const OUT = path.resolve(__dirname, "Final_Year_Project_Report.docx");
const FONT = "Times New Roman";
const TEXT_WIDTH = 9355; // A4 11906 - 1417 (25 mm) - 1134 (20 mm)
const MAX_IMG_W = 620, MAX_IMG_H = 560; // px at 96 dpi (about 164 x 148 mm)

// ---------------------------------------------------------------- state and helpers
const body = [];
let chapter = 0, section = 0, subsection = 0, figN = 0, tblN = 0, appendixN = 0;

const run = (text, o = {}) => new TextRun({ text, font: FONT, size: 24, ...o });
/** Splits "text [TODO: x] text" into normal and highlighted runs. */
function runs(text, o = {}) {
  return text.split(/(\[TODO:[^\]]*\])/).filter(Boolean).map((t) =>
    t.startsWith("[TODO:") ? run(t, { highlight: "yellow", ...o }) : run(t, o));
}
const P = (text, o = {}) => body.push(new Paragraph({
  alignment: AlignmentType.JUSTIFIED, spacing: { line: 480, after: 240 }, children: runs(text), ...o,
}));
const TODO = (text) => P(`[TODO: ${text}]`);
const B = (items) => items.forEach((t) => body.push(new Paragraph({
  numbering: { reference: "bullets", level: 0 }, alignment: AlignmentType.JUSTIFIED, spacing: { line: 360, after: 120 }, children: runs(t),
})));
const heading = (level, text, extra = {}) => new Paragraph({
  heading: level, keepNext: true, children: [run(text, { bold: true, size: level === HeadingLevel.HEADING_1 ? 28 : 24, italics: level === HeadingLevel.HEADING_3 })],
  spacing: { before: level === HeadingLevel.HEADING_1 ? 0 : 360, after: 240, line: 276 }, ...extra,
});
const UNNUMBERED = (text) => body.push(heading(HeadingLevel.HEADING_1, text, { pageBreakBefore: true }));
const H1 = (text) => { chapter++; section = 0; subsection = 0; figN = 0; tblN = 0;
  body.push(heading(HeadingLevel.HEADING_1, `${chapter}  ${text}`, { pageBreakBefore: true })); };
const H2 = (text) => { section++; subsection = 0; body.push(heading(HeadingLevel.HEADING_2, `${chapter}.${section}  ${text}`)); };
const H3 = (text) => { subsection++; body.push(heading(HeadingLevel.HEADING_3, `${chapter}.${section}.${subsection}  ${text}`)); };
const APPENDIX = (title) => { appendixN++; tblN = 0; body.push(heading(HeadingLevel.HEADING_1, `Appendix ${appendixN}: ${title}`, { pageBreakBefore: true })); };

function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
/** Figure: image centred, caption below ("Figure 3.1 ..."), numbered per chapter, referred to from the text. */
function FIG(name, caption, maxH = MAX_IMG_H) {
  const file = path.join(FIG_DIR, `${name}.png`);
  const { w, h } = pngSize(file);
  const nw = w / 2, nh = h / 2; // the PNGs are rendered at 2x
  const k = Math.min(MAX_IMG_W / nw, maxH / nh, 1.6);
  figN++;
  const label = `Figure ${chapter}.${figN}`;
  body.push(new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 120 },
    children: [new ImageRun({ type: "png", data: fs.readFileSync(file), transformation: { width: Math.round(nw * k), height: Math.round(nh * k) },
      altText: { title: label, description: caption, name } })] }));
  body.push(new Paragraph({ style: "FigureCaption", alignment: AlignmentType.CENTER, spacing: { after: 360 },
    children: [run(`${label}  ${caption}`, { bold: true })] }));
  return label;
}
/** Screenshot of the running system (2x PNG from take_screenshots.py), numbered like a figure. */
function SHOT(name, caption, maxH = MAX_IMG_H) {
  const file = path.join(__dirname, "screenshots", `${name}.png`);
  const { w, h } = pngSize(file);
  const nw = w / 2, nh = h / 2;
  const k = Math.min(MAX_IMG_W / nw, maxH / nh, 1);
  figN++;
  const label = `Figure ${chapter}.${figN}`;
  body.push(new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 120 },
    children: [new ImageRun({ type: "png", data: fs.readFileSync(file), transformation: { width: Math.round(nw * k), height: Math.round(nh * k) },
      altText: { title: label, description: caption, name } })] }));
  body.push(new Paragraph({ style: "FigureCaption", alignment: AlignmentType.CENTER, spacing: { after: 360 },
    children: [run(`${label}  ${caption}`, { bold: true })] }));
  return label;
}
const figLabel = () => `Figure ${chapter}.${figN + 1}`; // label the next FIG() call will produce

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: "808080" };
const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };
/** Table with a caption above ("Table 3.1 ..."). widths in DXA must sum to TEXT_WIDTH. 10 pt single-spaced (allowed by the guidelines). */
function TBL(caption, widths, header, rows) {
  const scale = (TEXT_WIDTH - 60) / TEXT_WIDTH;
  widths = widths.map((w) => Math.floor(w * scale));
  const tableWidth = widths.reduce((a, b) => a + b, 0);
  tblN++;
  const label = `Table ${appendixN > 0 ? "A" + appendixN : chapter}.${tblN}`;
  body.push(new Paragraph({ style: "TableCaption", alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 240, after: 120 },
    children: [run(`${label}  ${caption}`, { bold: true })] }));
  const cell = (text, i, head) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA }, borders, margins: { top: 60, bottom: 60, left: 100, right: 100 },
    shading: head ? { fill: "D9D9D9", type: ShadingType.CLEAR, color: "auto" } : undefined,
    children: String(text).split("\n").map((line) => new Paragraph({ alignment: AlignmentType.LEFT, spacing: { line: 240, after: 0 },
      children: runs(line, { size: 20, bold: head }) })),
  });
  body.push(new Table({
    width: { size: tableWidth, type: WidthType.DXA }, columnWidths: widths,
    rows: [new TableRow({ tableHeader: true, cantSplit: true, children: header.map((t, i) => cell(t, i, true)) }),
      ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((t, i) => cell(t, i, false)) }))],
  }));
  body.push(new Paragraph({ spacing: { after: 240 }, children: [] }));
  return label;
}

// ---------------------------------------------------------------- front matter
const AUTHOR = "Abdalrhmn Boubes, Lilas Dasoki";
const DEGREE = "Bachelor of Software Engineering";
const front = [];
const center = (text, o = {}) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: runs(text, o) });
const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
const logoFile = path.join(__dirname, "university_logo.png");
front.push(
  new Table({
    width: { size: 9355, type: WidthType.DXA }, columnWidths: [6355, 3000],
    borders: { ...noBorders, insideHorizontal: noBorder, insideVertical: noBorder },
    rows: [new TableRow({ children: [
      new TableCell({ width: { size: 6355, type: WidthType.DXA }, borders: noBorders, children: [
        new Paragraph({ spacing: { after: 120 }, children: runs("Yarmouk Private University", { size: 24 }) }),
        new Paragraph({ spacing: { after: 120 }, children: runs("Faculty of Informatics and Communication Engineering", { size: 24 }) }),
        new Paragraph({ spacing: { after: 120 }, children: runs("Department of Software Engineering", { size: 24 }) }),
      ] }),
      new TableCell({ width: { size: 3000, type: WidthType.DXA }, borders: noBorders, children: [
        new Paragraph({ alignment: AlignmentType.RIGHT, children: [new ImageRun({ type: "png", data: fs.readFileSync(logoFile), transformation: { width: 150, height: 112 },
          altText: { title: "University logo", description: "Yarmouk Private University logo", name: "logo" } })] }),
      ] }),
    ] })],
  }),
  new Paragraph({ spacing: { before: 1500 }, children: [] }),
  center("A Central System for Managing and Monitoring Schools", { bold: true, size: 44 }),
  center("A Role-Based Web Platform for Attendance, Teaching Quota, Requests and Decision Support", { size: 28 }),
  center("Graduation Project Report", { size: 30 }),
  new Paragraph({ spacing: { before: 600 }, children: [] }),
  center("Prepared By:", { bold: true, size: 32 }),
  center("Abdalrhmn Boubes", { size: 28 }),
  center("Lilas Dasoki", { size: 28 }),
  new Paragraph({ spacing: { before: 400 }, children: [] }),
  center("Supervised By:", { bold: true, size: 32 }),
  center("Dr. Mostafa Dakak", { size: 28 }),
  center("Eng. Faris Dadosh", { size: 28 }),
  new Paragraph({ spacing: { before: 600 }, children: [] }),
  center("December 2026", { size: 28 }),
);

function frontHeading(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, keepNext: true, pageBreakBefore: true, spacing: { after: 240 },
    children: [run(text, { bold: true, size: 28 })] });
}
const fp = (text) => new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { line: 480, after: 120 }, children: runs(text) });
front.push(
  frontHeading("Abstract"),
  fp("Ministries and local directorates supervise many schools, yet the information needed to do so, such as attendance, teaching load and pending needs, is usually collected on paper and arrives late and inconsistently. This project designed and implemented a central web system that connects a ministry, its directorates and their schools, in which every user sees only the data within the user's own scope."),
  fp("The system records staff attendance, optionally by face recognition with a liveness check, and classifies each working day automatically with a plain-language reason. It tracks the weekly teaching quota of permanent and contract teachers, manages school requests with an explainable priority score, delivers circulars with tracking of opening and acknowledgement, and lets a supervisor correct submitted term results with a logged reason. Reports and dashboards use the same functions, so their figures agree, and results can be exported to Excel or printed to PDF in Arabic. Two local and transparent statistical components rank schools and detect unusual attendance patterns, and no automated administrative action is ever taken."),
  fp("The system uses Node.js, PostgreSQL, React and a separate Python face service, and critical rules, such as the immutability of raw attendance events, sent messages and submitted results, are enforced by database triggers. The attendance kiosk keeps working when the internet connection is lost: it stores encrypted captures on the device and the server verifies them after synchronisation. The system was verified with 61 unit tests and more than 290 API and database test cases. The calibration of the face-matching threshold with real volunteers remains future work."),
  new Paragraph({ pageBreakBefore: true, spacing: { after: 240 }, children: [run("Contents", { bold: true, size: 28 })] }),
  new TableOfContents("Contents", { hyperlink: true, headingStyleRange: "1-2" }),
  new Paragraph({ pageBreakBefore: true, spacing: { after: 240 }, children: [run("List of Figures", { bold: true, size: 28 })] }),
  new TableOfContents("List of Figures", { hyperlink: true, stylesWithLevels: [new StyleLevel("Figure Caption", 1)] }),
  new Paragraph({ pageBreakBefore: true, spacing: { after: 240 }, children: [run("List of Tables", { bold: true, size: 28 })] }),
  new TableOfContents("List of Tables", { hyperlink: true, stylesWithLevels: [new StyleLevel("Table Caption", 1)] }),
  frontHeading("Acknowledgements"),
  fp("We would like to thank our supervisors, Dr. Mostafa Dakak and Eng. Faris Dadosh, for their guidance, for the time they gave to reviewing our work, and for the observations that shaped the offline attendance and liveness design. We also thank the Faculty of Informatics and Communication Engineering at Yarmouk Private University for the education that made this project possible, and our families for their support throughout the year."),
);

// ---------------------------------------------------------------- chapter 1
H1("Introduction");
H2("Motivation");
P("A national or regional education authority is responsible for thousands of teachers and tens of thousands of students spread over many schools. Decisions such as where to send a missing teacher, which maintenance request to handle first, or which school needs support depend on reliable and timely information. In practice that information is gathered through paper registers, phone calls and monthly summaries that are prepared by hand. The result is that problems become visible weeks after they start, figures from different offices do not agree, and managers cannot easily verify whether the information they receive is accurate.");
P("Three recurring difficulties motivated this project. First, attendance is difficult to verify: manual registers can be altered and give no proof of the time a person actually arrived. Second, the workload of teachers is regulated by a weekly teaching quota that depends on the type of appointment and the years of service, and checking it requires comparing timetables with what actually happened each day. Third, communication between a school and its directorate, including requests for repairs, books or additional teachers, has no common process, so the status of a request is unknown to the school and its urgency is judged subjectively.");
H2("Problem description");
P("The problem addressed is the absence of a single trusted system in which the three administrative levels, the ministry, the directorates and the schools, share the same data, each seeing only what concerns it, while preserving the privacy of staff and students. The system must work with the real rules of the education system: schools are organised in three cycles with different grade ranges, teachers are either permanent or contracted, and several sensitive records, for example attendance events and student results, must be protected against later alteration.");
H2("Objectives");
P("The objectives of the project were to design, implement and test a web system that:");
B([
  "gives each of seven user roles access to exactly the data within its scope and records every access to personal data in an audit log;",
  "records staff attendance, including attendance by face recognition without storing face images, and classifies each day automatically with an explanation;",
  "calculates the weekly teaching quota of permanent and contract teachers from approved timetables, leave and actual attendance;",
  "manages school requests through a defined life cycle and orders them by an explainable priority score;",
  "delivers circulars from the ministry and directorates and tracks which school opened and acknowledged them;",
  "allows teachers to submit term results that only a supervisor can correct, with a logged reason and a notification to the teacher;",
  "produces consistent reports and dashboards, with export to Excel and printing to PDF in Arabic;",
  "supports decisions with transparent statistics, namely a school performance index and the detection of unusual attendance patterns, without taking any automatic action.",
]);
H2("Scope and limitations");
P("The system was developed and demonstrated with generated data for one ministry, one directorate and five schools, as no real personal data was used. Payroll is outside the scope: for contract teachers the system only displays an indicative estimate of the payment for executed lessons. Attendance without an internet connection is supported by the installable kiosk, but it was tested with a stand-in face service and not with a real camera, and the face-matching threshold was set from the published characteristics of the model and not yet calibrated with a group of volunteers.");
H2("Organisation of the report");
P("Chapter 2 presents the background: the structure of the education system that the project serves, attendance technologies, the security techniques that are used, and the idea of explainable decision support. Chapter 3 describes the stakeholders, the requirements and the design of the architecture, the database and the security. Chapter 4 explains how each module was implemented. Chapter 5 reports the testing and the results. Chapter 6 evaluates the work against the objectives, and Chapter 7 concludes and suggests future work. The appendices list the configurable parameters, the database tables and the organisation of the source code.");

// ---------------------------------------------------------------- chapter 2
H1("Background");
H2("The organisation of the education system");
P("The case study follows a three-level hierarchy. The ministry sets policy and needs aggregated information. Each directorate supervises the schools of one governorate, approves their requests and defines local parameters such as the teaching-quota rules. Each school is managed by a principal, assisted by a deputy, a supervisor who is responsible for results, administrative staff and teachers.");
P("A school belongs to exactly one of three cycles: the first cycle covers grades 1 to 6, the second grades 7 to 9 and the third grades 10 to 12. In the third cycle a section may follow a general scientific, general literary, commercial or industrial track. Teachers are appointed either as permanent staff, whose weekly quota decreases with the years of service, or as contract teachers who are assigned a number of weekly hours that may be spread over more than one school. The academic year is divided into two terms, from September to January and from February to August.");
H2("Attendance monitoring technologies");
P("Attendance can be recorded with paper registers, cards, fingerprint readers or face recognition. Paper and cards can be used by another person on behalf of the owner, and fingerprint readers require dedicated hardware in every school. Face recognition needs only a camera, but it raises privacy concerns and can be deceived by a photograph. Modern systems therefore separate two tasks: detecting a face in an image and converting it into a numeric vector called an embedding, followed by a comparison of that vector with stored vectors using a similarity measure such as the cosine similarity. A liveness check, for example asking the person to turn the head in a random direction, reduces the risk of spoofing.");
P("This project uses the YuNet detector [6] and the SFace recognition model [5], which are distributed through the OpenCV model zoo [8] and run on an ordinary processor without a graphics card. The recognition model produces an embedding of 128 values. Storing only the embedding, encrypted, and discarding the images is consistent with the privacy requirement that face images are never kept.");
H2("Access control and security techniques");
P("The system relies on established techniques. Role-based access control assigns permissions to roles instead of individuals [7]; in this project it is combined with a data scope, so that a role is also restricted to a school, a directorate or the whole country. Users authenticate with a username and password, and the server issues a JSON Web Token (JWT) [1], a signed statement of the identity and role that the client presents with every request. Passwords are stored only as bcrypt hashes [2], a deliberately slow algorithm designed to resist guessing. Sensitive vectors are encrypted with AES in Galois/Counter Mode (AES-GCM) [3], which provides both confidentiality and tamper detection. Injection attacks, which are among the most common web vulnerabilities [4], are prevented by using parameterised queries for every access to the database.");
H2("Explainable decision support");
P("Decision-support tools in public administration face a trust problem: managers are reluctant to act on a score they cannot understand, and an unexplained automatic decision about a person is unacceptable. The approach adopted here is therefore to use simple statistical methods whose result can be explained in a sentence, for example comparing a weekly absence rate with the mean and standard deviation of the previous weeks (a z-score), and to show the numbers behind every result. The methods run locally, need no internet connection or external model, and are used only to draw attention, never to decide.");
H2("Related work");
P("Remote identity verification systems face the same two problems that the attendance kiosk faces: deciding whether a live person is in front of the camera, and deciding whether the face matches an enrolled one. The international standard ISO/IEC 30107-3 defines how presentation attacks, such as a photograph or a replayed video shown to the camera, are tested and reported, with the error rates APCER (attacks accepted as genuine), BPCER (genuine users rejected) and their average. Active liveness checks, which ask the user to perform an action such as turning the head, are stronger than passive checks on a single image, because the action is unpredictable. A recent graduation project on electronic identity verification, which studied liveness metrics, motivated the two-direction head-turn used here. In contrast with such systems, which assume a permanent connection, the attendance kiosk must also work during power or network outages, which led to the capture-now, verify-later design of Section 4.5.");
TODO("Review at least three existing school-management or attendance systems (commercial school information systems or published research projects), state what each offers and how this project differs; cite the standard and the identity-verification graduation project (confirm the author name and permission) in the reference list.");
H2("The proposed solution");
P("The proposed solution is a central web application with a single database, in which the same business functions serve the screens, the reports and the dashboards. A separate face service performs the image processing. The next chapter describes the requirements and the design in detail.");

// ---------------------------------------------------------------- chapter 3
H1("Requirements and System Design");
H2("Stakeholders and roles");
P("The system serves seven roles. The ministry administrator sees only aggregated figures and never information about individuals. The directorate administrator sees the schools of the directorate, reviews their requests and configures the local parameters. Within a school, the principal manages staff, students, timetables and attendance, the deputy principal helps with a subset of these tasks when authorised by the principal, the supervisor handles term results, teachers see only their own schedule, attendance and results, and administrative staff can use the attendance kiosk.");
TBL("User roles and their data scope", [2200, 2300, 4855], ["Role", "Data scope", "Main functions"], [
  ["Ministry administrator", "Aggregated data of all directorates", "Indicators, school ranking, circulars, aggregated and requests reports"],
  ["Directorate administrator", "Schools of the directorate", "Review and decide on requests, create teacher accounts, settings, circulars, reports"],
  ["School principal", "Own school", "Staff, students, timetables, attendance, face enrolment, corrections, report approval, requests"],
  ["Deputy principal", "Own school (when authorised)", "Staff and student data, timetables, proposing attendance corrections, requests"],
  ["Supervisor", "Own school", "Review and correct submitted term results"],
  ["Teacher", "Own data only", "Own schedule, quota and attendance, entering and submitting term results"],
  ["Administrative staff", "Own data only", "Check-in at the attendance kiosk"],
]);
H2("Functional requirements");
P(`The functional requirements are grouped by module and illustrated by the use-case diagrams in ${figLabel()}, Figure ${chapter}.${figN + 2} and Figure ${chapter}.${figN + 3}.`);
FIG("fig_use_case_central", "Use cases of the ministry and directorate administrators", 330);
FIG("fig_use_case_school_management", "Use cases of the school principal and deputy principal", 330);
FIG("fig_use_case_school_users", "Use cases of teachers, supervisors and administrative staff", 330);
B([
  "Organisation and academic data: schools with their cycle, staff, students, classes and sections, with a warning when a record appears to be a duplicate.",
  "Timetables and quota: weekly timetables, the status of every lesson, and the weekly quota of each teacher with the remaining lessons.",
  "Attendance: raw events from the kiosk or manual entry, daily classification, corrections, power-outage records and a monthly Excel file.",
  "Face recognition: enrolment by the principal and automatic check-in with a liveness challenge.",
  "School requests: creation, review, decision, execution and closing, with attachments, comments, notifications and an explainable priority.",
  "Messages: circulars, notices and messages between the three levels, with tracking of opening and acknowledgement.",
  "Term results: entry by the teacher, submission, correction by the supervisor and notification of the teacher.",
  "Reports and dashboards: monthly teacher and school reports with approval, requests and central reports, indicators with period and school filters, and export.",
  "Decision support: a school performance and need index and the detection of unusual attendance patterns.",
]);
H2("Non-functional requirements");
B([
  "Security: hashed passwords, signed tokens with an idle time-out of 30 minutes, protection against password guessing, parameterised queries and validation of every input.",
  "Privacy: face images are never stored; only an encrypted vector is kept, it is never written to the audit log, and only the principal of the school can enrol faces.",
  "Integrity: raw attendance events, sent messages, audit records, submitted results and report approvals cannot be modified or deleted.",
  "Explainability: every classification, priority score, index and alert is accompanied by its reasons in plain language.",
  "Time: all times are stored in UTC and displayed in local time (UTC+3), including the calculation of working days.",
  "Maintainability: the algorithms are pure functions with unit tests, and all parameters that may change are stored in a settings table instead of the code.",
]);
H2("System architecture");
P(`The system has three tiers, shown in ${figLabel()}. The client is a single-page web application written with React and TypeScript, styled with Bootstrap in right-to-left mode. The application server, written with Node.js, Express and TypeScript, exposes a REST interface in JSON. Requests pass through middleware for authentication, role checking and scope isolation, then reach the routes, which call services that contain the business rules and the SQL. The algorithms are separate pure functions that have no access to the database, which makes them easy to test. Data is stored in PostgreSQL, and uploaded attachments in the file system. A separate Python service, built with FastAPI and OpenCV, performs face detection and recognition and holds no state.`);
FIG("fig_architecture", "System architecture");
TBL("Main technologies", [2600, 6755], ["Layer", "Technology"], [
  ["Client", "React 19, TypeScript, Vite, Bootstrap 5 (right-to-left), React Router"],
  ["Application server", "Node.js, Express 5, TypeScript, JSON Web Tokens, bcrypt, ExcelJS"],
  ["Database", "PostgreSQL 18 accessed with parameterised SQL, triggers and views"],
  ["Face service", "Python 3.13, FastAPI, OpenCV with the YuNet and SFace models"],
  ["Deployment", "Docker Compose with an nginx front end (prepared; see Chapter 6)"],
]);
H2("Database design");
P(`The database contains 40 tables. To keep the diagrams readable they are presented in nine parts, ${figLabel()} to Figure ${chapter}.${figN + 9}, in the order in which they appear below. Foreign keys that point to the users table from author columns, such as created_by or decided_by, are kept as attributes but their lines are omitted. Entities drawn with only an identifier are shown for context and are described in another part.`);
FIG("erd_1_organisation", "Entity-relationship diagram, part 1: ministry, directorates, schools and accounts");
FIG("erd_2_staff", "Entity-relationship diagram, part 2: employees and assignments");
FIG("erd_3_classes_students", "Entity-relationship diagram, part 3: classes, sections and students");
FIG("erd_4_teaching_timetables", "Entity-relationship diagram, part 4: subjects, teaching assignments and timetables");
FIG("erd_5_attendance", "Entity-relationship diagram, part 5: attendance, face vectors, corrections and outages");
FIG("erd_6_leave_lessons_reports", "Entity-relationship diagram, part 6: leave, lesson corrections and report approvals");
FIG("erd_7_requests", "Entity-relationship diagram, part 7: school requests");
FIG("erd_8_messages_notifications", "Entity-relationship diagram, part 8: messages and notifications");
FIG("erd_9_results_audit", "Entity-relationship diagram, part 9: term results and audit log");
P("Several design decisions are enforced inside the database and not only in the application code, because a defect or a direct database access in the application must not be able to break them. Triggers reject any update or deletion of raw attendance events, audit records, correction logs and report approvals. A sent message and its recipients can change only in the columns that record opening and acknowledgement. A submitted result sheet cannot return to draft, and a submitted result can change only inside a supervisor correction. Other triggers ensure that the grades of a school match its cycle, that a third-cycle section has a track, that a teacher cannot be in two lessons at the same time in any school, and that the hours of a contract teacher across schools do not exceed the assignment. Values that may change, such as the quota rules, the length of the lesson, the late tolerance and all the weights, are read from a settings table.");
H2("Security design");
P("Authentication and authorisation are applied in layers. A login request is checked against the stored bcrypt hash, and five failed attempts for the same user name and address lock further attempts for 15 minutes. A successful login returns a token that expires after 30 minutes and is re-issued while the user remains active, so that the idle time-out is enforced by the server. On every request the server verifies the signature and the algorithm, rejects tokens that were issued for another purpose, such as the short face-challenge token, and confirms that the account is still active, so that a disabled account loses access immediately.");
P("After authentication, a role check allows or denies the route, and the scope service restricts the data to the school or directorate of the user. A denied request is recorded in the audit log, which also records logins, failed logins, views of personal reports, status changes and report approvals. Uploaded files are stored under random names with a type whitelist and a path check on download. In production the server refuses to start if the signing secret is short or still has its placeholder value.");

// ---------------------------------------------------------------- chapter 4
H1("Implementation of the Main Modules");
H2("Organisation and academic data");
P("Schools are created by the directorate with their cycle, and the grades that a school may contain must match that cycle. A third-cycle section must have a track and sections of the other cycles must not. Staff and students are added by the principal, and before saving a record the system warns the user if another record has the same name or number, and continues only after confirmation. The deputy and the directorate have read access to the staff data of the school, so that responsibility for changes stays with the principal.");
H2("Timetables and teaching quota");
P("A timetable assigns a subject, a teacher and a section to each period of each working day, and an approved timetable is the reference for everything that follows. The required weekly quota of a permanent teacher is read from a rule table in the settings: 22 lessons below 10 years of service, 21 from 10 to 19 years and 19 from 20 years, and these thresholds can be edited by the directorate. The quota of a contract teacher equals the hours assigned at the school, and the total across schools cannot exceed the assignment. The system displays the estimated payment of a contract teacher only as an indicator, by multiplying the executed lessons by a configurable rate.");
P("The status of every lesson is computed by one query in the following order of precedence: a manual correction by the principal, a recorded leave, a future lesson, an attendance interval that covers the lesson, and otherwise not executed. The weekly summary then shows, for each teacher, the required quota, the executed and compensated lessons, the lessons excused by leave, the remaining lessons, the teaching time and the presence time.");
H2("Attendance");
H3("Events and the daily classification");
P("Every check-in or check-out is stored as an immutable raw event with its source, which is the face service or a manual entry with a mandatory reason. A repeated event of the same type within two minutes is ignored, and an entry that follows an entry is accepted and later flagged as an incomplete registration, so that no real movement is lost.");
P(`The classification of one employee on one working day is a pure function, summarised in ${figLabel()}. The expected hours of a teacher run from the first to the last lesson of the day in the school, and those of administrative staff come from the settings. The function never declares an employee absent automatically: a day without any event becomes a possible absence that the principal must review. Lateness or early leaving that falls inside a recorded power outage is not counted. Each result carries its reasons in Arabic text.`);
FIG("fig_day_classification", "Flowchart of the daily attendance classification");
H3("Corrections, outages and export");
P("A deputy or the principal may propose a correction to the status of a day, and the principal approves it. A correction proposed by the principal is approved by the directorate, so that nobody approves a correction made by the same person. Power outages are recorded with a start and an end of at most 24 hours, and the directorate can see the number of outages of every school. A monthly Excel file of the daily attendance and of the raw events is generated on demand from the accepted events, which guarantees that the file is always an up-to-date copy of the records.");
H2("Face recognition");
P(`Face recognition is split between the application server and the face service, as shown in ${figLabel()}. The kiosk first requests a challenge: a random sequence of two opposite head turns, for example right and then left, returned inside a signed token that lasts 90 seconds and is bound to the kiosk user. The kiosk then captures three frontal frames and four frames during each turn, eleven in all, and sends them with the token. The face service estimates the horizontal head rotation of every frame from the position of the nose relative to the eyes, and requires a frontal pose, a rotation of at least 0.22 eye distances in the requested direction for each step, and the requested order. A single-direction clip or a still photograph therefore fails. It also checks that exactly one face is present and that it belongs to the same person in all frames, and returns a 128-value embedding. The images are held in memory only and are discarded immediately.`);
FIG("fig_face_sequence", "Sequence diagram of face check-in");
H2("Attendance without an internet connection");
P(`A school cannot always rely on the network, so the kiosk page is an installable web application. A service worker keeps the application shell in the browser cache, and the kiosk session is restored after a restart even when the device is offline. The server cannot issue liveness challenges while offline, so the kiosk downloads a pool of signed single-use challenges while it is connected, valid for 72 hours. When there is no connection, a capture is made with a challenge from the pool, encrypted with AES-GCM using a non-extractable key held by the browser, and stored in the local database of the browser together with a client event identifier. No face matching is performed on the device, so no face vectors are stored there. ${figLabel()} shows the whole cycle.`);
FIG("fig_offline_sync", "Offline attendance: preparation, capture without internet and synchronisation");
P("When the connection returns, the kiosk sends the queued captures in small batches, sorted by capture time. The server rejects a replayed capture through the client identifier and a challenge that was used before, verifies the signature of the challenge and that the capture lies inside its validity window, measures the difference between the device clock and the server clock, and then runs the same liveness and matching steps as the online path. A capture that passes is stored as an attendance event with its original capture time. A capture that fails, or whose clock difference exceeds ten minutes, is kept encrypted for review by the principal, who attaches it to an employee or rejects it with a reason; the images are deleted as soon as the decision is taken, or after seven days. The event type, entry or exit, is derived from the order of the movements, so a late synchronisation still produces a consistent day.");
P("The application server decrypts the embeddings of the staff of the same school, computes the cosine similarity with each, and accepts the best match when it exceeds a single threshold taken from the settings (0.42 by default). The event type, entry or exit, follows the last movement of the person on that day, and the match score is stored with the event. Embeddings are encrypted with AES-256-GCM using a key that is kept outside the database and are never written to the audit log. Only the principal of a school can enrol the face of a staff member of that school.");
H2("School requests");
P(`A request is created by the school as a draft and then follows the life cycle in ${figLabel()}. The directorate can start a review, return the request for clarification, approve it or reject it with a mandatory reason, and then mark it in progress and completed. Only the school can close a completed request, so that the school confirms that the problem was solved. Attachments of up to 4 MB in a limited set of types and comments are supported, and each change of status creates a notification for the other party.`);
FIG("fig_request_states", "State diagram of a school request");
P(`The priority score orders open requests for the directorate. As shown in ${figLabel()}, five factors are normalised between 0 and 1: the severity given by the school, the share of the students affected, the waiting time, the fragility of the school and the repetition of the same type of request. The score is the weighted sum of the factors multiplied by 100, with the weights read from the settings and re-normalised to sum to one. The score is computed whenever it is displayed and is never stored, because the waiting time changes every day, and it is accompanied by a sentence that names the factors that raised it. It is only a sorting aid and never accepts or rejects a request.`);
FIG("fig_request_priority", "Computation of the request priority score");
P("A particular type of request lets a principal ask the directorate to create the account of a teacher. After approval the directorate enters the employee number and an initial password, the account is created, and the password is neither stored in clear text nor shown again. For this reason a principal cannot create teacher accounts directly.");
H2("Circulars and messages");
P("Mailboxes belong to organisations and not to individuals: the principal and the deputy share the inbox of the school. The ministry may write to all schools, to chosen directorates or to chosen schools, and the directorate then receives a copy; a directorate writes to its own schools only, and a school writes to its directorate only. A message can be edited while it is a draft, and after sending a trigger prevents any change except the recording of opening and acknowledgement. The sender sees, for each recipient, whether the message was opened, by whom and when, and whether it was acknowledged when an acknowledgement was requested.");
H2("Term results");
P(`The teacher enters one total between 0 and 100 for each student, subject and term, and the sheet can be submitted only when every student of the section has a result, as shown in ${figLabel()}. After submission the sheet is locked, and only the supervisor can correct a single result. A correction requires a reason, stores the old and the new value together with the author, and sends the teacher a personal notification. Until submission, only the teacher can see the values entered.`);
FIG("fig_results_workflow", "Term results workflow");
H2("Reports and dashboards");
P("Four reports are available. The monthly teacher report lists each day with its status and reasons, the lessons, the leave, the corrections, the quota and, for contract teachers, an indicative estimate. The principal approves it only after the month has ended and after pending corrections and incomplete registrations are resolved, and days of possible absence must be acknowledged; the approval stores a frozen copy of the figures. The school report summarises every employee, the requests report shows the number and the processing time of requests per school, and the central report gives aggregated figures by directorate and by school without any individual.");
P("The dashboard shows the number of schools, teachers and students, the attendance rate, the quota completion, the open and overdue requests, the shortage of staff, the share of submitted results, the daily attendance trend, the most frequent types of request, the delivery of circulars and a comparison of schools, with filters for the period and the school. Because the dashboard and the central report call the same function, the figures are identical for the same period, which was verified by comparing their output. Reports are exported to Excel by the server with right-to-left sheets, and to PDF through the print function of the browser with an official header and signature area, which avoids the problems of shaping Arabic text in a server-side PDF generator.");
H2("Decision-support analytics");
H3("School performance and need index");
P(`The performance index of a school, between 0 and 100, combines four factors, as shown in ${figLabel()}: the attendance rate, where 80 percent maps to 0 and 100 percent to 1; the quota completion; the speed of the directorate in deciding the requests of the school; and the average of the submitted results. A second index, the composite need index, combines the number of open requests for teachers, the rate of possible absence, the overdue requests and the decline of the results compared with the previous term. The weights are stored in the settings. A factor without data is left out and the remaining weights are re-normalised, and the explanation states this. Schools are ranked within their directorate. The index is a supervision tool, so only the directorate and the ministry can see it; schools do not.`);
FIG("fig_performance_index", "School performance and need indices");
H3("Detection of unusual attendance patterns");
P(`The detector, summarised in ${figLabel()}, works on the classified days of the last seven weeks after the leave and outage days are removed. It raises four kinds of alert. The first is a teacher absent on three or more consecutive duty days. The second is an abnormal school absence rate: for a school, the weekly absence rate is compared with the mean and the standard deviation of the four previous weeks, and an alert is raised when the z-score exceeds 2 in two consecutive weeks, where z = (x - mean) / sd and the standard deviation has a floor of one percentage point to avoid division by zero. The third is lateness that is concentrated on one weekday, and the fourth is three or more incomplete registrations in four weeks. Each alert has a severity, a sentence that explains it, the numbers that caused it and the dates.`);
FIG("fig_anomaly_pipeline", "Attendance anomaly detection pipeline");
P("The alerts are computed when they are requested and are not stored. The ministry receives school-level alerts and only the number of individual alerts per school, in line with the rule that the ministry does not see information about individuals.");
H2("Deployment");
P("The repository contains a Docker Compose configuration that starts the database, the face service, the application server and an nginx container that serves the web application and forwards requests to the API. For development, a script rebuilds the database in one step: it generates a demonstration data set for the last working day before the date of execution, drops and creates the database, and loads the schema, the default settings and the data. The demonstration set contains one ministry, one directorate, five schools, about 88 employees, 750 students, 900 timetable periods and nearly ten thousand attendance events, including deliberately inserted anomalies.");

// ---------------------------------------------------------------- chapter 5
H1("Results and Testing");
H2("Testing strategy");
P("Testing was done at three levels. The algorithms are pure functions and were covered by unit tests. The routes and the business rules were tested through the HTTP interface with scripted scenarios for every role, including the attempts that must be refused. The rules that must hold even if the application is bypassed were tested directly against the database. The face service was exercised end to end through the API, but not with real faces, as explained in Section 5.7.");
H2("Unit tests of the algorithms");
TBL("Unit tests", [4200, 1400, 3755], ["Component", "Tests", "What is verified"], [
  ["Daily attendance classification", "18", "Every status, tolerance, outages, leave, corrections and incomplete registrations"],
  ["Request priority score", "10", "Normalisation, weights, explanation, overdue rule"],
  ["School performance and need index", "7", "Bounds, missing data, ranking and ties, custom weights"],
  ["Attendance anomaly detection", "12", "Consecutive absence, z-score rule and its guards, weekday lateness, incomplete registrations"],
  ["Face vector encryption and similarity", "4", "Encryption round trip, tampering and similarity"],
  ["Liveness evaluation (face service)", "10", "Order of the two turns, one-way clip, missing frontal pose, direction sign"],
  ["Total", "61", "All tests pass"],
]);
H2("Functional and database tests");
P("Scripted scenarios were executed against a freshly built database after each module was completed. They check that every role receives exactly the data of its scope, that forbidden actions return the appropriate error, and that the database refuses the operations that the triggers forbid.");
TBL("Scripted API and database test campaigns", [3500, 1300, 4555], ["Module", "Cases", "Examples of what was checked"], [
  ["Authorisation and audit", "11", "Scope per role, denied access recorded in the audit log"],
  ["Organisation and academic data", "20", "Creation rules by role, duplicate warning"],
  ["Teacher types and school cycles", "13 + 7", "Cycle and track rules, contract hours, one active assignment per school"],
  ["Timetables and quota", "27", "Lesson status, weekly summary, leave and corrections"],
  ["Attendance", "36 + 9", "Raw event protection, corrections and approval, outages, Excel file"],
  ["Face recognition", "12", "Permissions, challenge token, round trip to the face service"],
  ["Attendance without an internet connection", "38", "Challenge pool, idempotent synchronisation, replay and clock-drift rules, review queue, deletion of frames"],
  ["School requests", "54", "Transitions, mandatory reasons, attachments, notifications, teacher account request"],
  ["Messages and circulars", "28 + 5", "Routing rules, immutability after sending, delivery tracking"],
  ["Term results", "25", "Entry, submission, correction with reason, notification, database guards"],
  ["Reports", "20", "Scope, approval rules, four exports"],
  ["Dashboard and analytics", "6 roles", "Role scope, equality with the central report, ministry restrictions"],
]);
H2("Security tests");
TBL("Security tests", [3600, 5755], ["Test", "Result"], [
  ["Token with the algorithm set to none", "Rejected"],
  ["Token with a modified role", "Rejected"],
  ["Expired token and missing token", "Rejected"],
  ["Face-challenge token used as a login token", "Rejected"],
  ["Token older than five minutes", "Re-issued (sliding session); a fresh token is not re-issued"],
  ["Disabled account: new login and existing token", "Both refused"],
  ["SQL injection strings in the login and in a search field", "Rejected or handled; the data remained intact"],
  ["Five failed logins for one user", "The sixth attempt is refused with a waiting time; other users are not affected"],
  ["Direct update of a submitted result or a correction log in the database", "Refused by triggers"],
]);
P("All 19 security checks passed. A scan of the code found no query built from user input and no insertion of user text into the page as HTML. A dependency audit reported two moderate findings in a library used by the Excel exporter; they concern a function that the project does not call, and updating would break the exporter, so they were documented and left unchanged.");
H2("Results of the decision-support components");
P("On the demonstration data the performance indices of the five schools for October 2026 were between 72 and 74 and the need indices between 11 and 52, which is consistent with data generated with similar parameters for every school. Each school is ranked with an explanation of the factors that lowered its performance or raised its need, and a school that lacks a factor is ranked using the remaining factors with a note, as verified by the unit tests.");
P("The anomaly detector found all four patterns that were deliberately inserted into the data: a school whose absence rate rose for two weeks, a teacher who was absent for four consecutive days, a teacher who arrived late every Tuesday, and an administrative employee who regularly forgot to check out. It also reported a few patterns that arose by chance from the random data, such as a teacher who happened to be late on several Thursdays, which illustrates both the sensitivity of the rules and the need for a human review of every alert.");
H2("Screenshots of the main screens");
P("The screens below were captured from the running system with the demonstration data. The interface is in Arabic and is displayed from right to left, as required by its users. Each user sees only the screens and the data that belong to the role of that user.");
P(`${figLabel()} shows the login page, which is the only screen available before authentication. After login, the dashboard of a directorate administrator, shown in Figure ${chapter}.${figN + 2} and Figure ${chapter}.${figN + 3}, gives the indicators of the selected period and a comparison of the schools; the period and the school can be changed with the filters above the indicators, and the same figures are available as an exported report.`);
SHOT("01_login", "Login page", 330);
SHOT("02_dashboard", "Directorate dashboard for the previous month: indicators and daily attendance trend");
SHOT("03_dashboard_schools", "Dashboard comparison of the schools of the directorate");
P(`The attendance page of a school principal, ${figLabel()}, lists every employee for the chosen day with the expected hours, the first entry, the last exit and the automatic classification with its reason. A day without any movement appears as a possible absence that needs a review, because the system never declares an absence by itself. The monthly report of a teacher, ${`Figure ${chapter}.${figN + 2}`}, summarises the attendance, the lessons and the quota of the month and contains the approval panel that lists the pending cases.`);
SHOT("04_attendance", "Daily attendance page of a school with the automatic classification");
SHOT("05_teacher_report", "Monthly report of a teacher with the approval panel");
P(`The page of school requests of the directorate, ${figLabel()}, orders the requests by the priority score and displays, for the selected request, the sentence that explains the score together with the history of the request. The page of intelligent analytics shows the attendance alerts in ${`Figure ${chapter}.${figN + 2}`}, each with its severity and a link to the numbers that caused it, and the ranking of the schools in ${`Figure ${chapter}.${figN + 3}`} with the contribution of every factor for the selected school.`);
SHOT("06_request_priority", "School requests ordered by priority, with the explanation of the selected request");
SHOT("07_alerts", "Attendance anomaly alerts");
SHOT("08_school_ranking", "School performance and need indices with the explanation of one school");
P(`${figLabel()} shows the term results submitted by a teacher as the supervisor sees them: the pencil icon marks a result that was corrected, and the log under the table records the old value, the new value, the reason and the author. Finally, ${`Figure ${chapter}.${figN + 2}`} shows the delivery status of a ministry circular, with the time at which each school opened it and the person who opened it.`);
SHOT("09_term_results", "Term results submitted by a teacher, as seen by the supervisor, with a correction in the log");
SHOT("10_messages", "Delivery status of a ministry circular");
H2("Limitations of the tests");
B([
  "The face-recognition path, including the offline synchronisation, was verified through the interfaces and with a stand-in face service, but not with real faces and a real camera, because no camera was available on the development machine. The threshold of 0.42 comes from the characteristics of the model and has not been calibrated with the false accept and false reject rates measured on volunteers.",
  "The Docker configuration was prepared but could not be executed because Docker was not installed on the development machine.",
  "All data is generated; no real personal data was used.",
]);
TODO("Add the results of testing face recognition with a real camera (accuracy at several thresholds) when available, and screenshots of the face enrolment and kiosk screens.");

// ---------------------------------------------------------------- chapter 6
H1("Evaluation");
H2("Achievement of the objectives");
TBL("Objectives compared with the outcome", [4100, 1500, 3755], ["Objective", "Status", "Evidence"], [
  ["Scoped access for seven roles with an audit log", "Achieved", "Role and scope tests, audit log, immutability triggers"],
  ["Attendance with automatic explained classification", "Achieved", "18 unit tests, reports built on the same function"],
  ["Face recognition without storing images", "Partly achieved", "Implemented and tested through the interfaces; real-camera testing and threshold calibration pending"],
  ["Teaching quota for permanent and contract teachers", "Achieved", "Quota rules in settings, weekly summary tests"],
  ["Requests with an explainable priority", "Achieved", "State transitions, 10 unit tests, 54 scenario checks"],
  ["Circulars with delivery tracking", "Achieved", "Routing and immutability tests"],
  ["Term results with controlled corrections", "Achieved", "25 checks including database guards"],
  ["Consistent reports and dashboards with export", "Achieved", "Dashboard output equals the central report; four exports"],
  ["Transparent decision support", "Achieved", "19 unit tests, explanations and evidence in every result"],
  ["Attendance without an internet connection", "Achieved", "Installable kiosk, encrypted local queue, synchronisation and review (Section 4.5)"],
  ["Containerised deployment", "Prepared, not executed", "Docker files written; not run"],
]);
H2("Comparison with other systems");
TODO("Compare the system objectively with the systems reviewed in Section 2.5 (features, privacy approach, explainability, cost). State where this work is stronger and where it is weaker.");
H2("Strengths and weaknesses");
P("The main strength of the design is that the rules that protect the data are enforced in the database, and that every figure shown to a user comes from one function, so that screens, reports and exports agree. The explanation attached to every classification, score and alert makes the system suitable for decision support. The main weaknesses are that the offline mode needs the challenge pool to be refilled at least every three days while online, that browsers on some phones may evict local storage, the absence of an accuracy measurement for face recognition on real people, and the fact that the in-memory limit on login attempts is not shared between several server instances.");

// ---------------------------------------------------------------- chapter 7
H1("Conclusion");
H2("Achievements");
P("A complete web system was designed, implemented and tested that connects the ministry, the directorates and the schools. It records and classifies attendance, tracks the teaching quota, processes school requests, delivers circulars, manages term results with controlled corrections, and produces consistent reports and dashboards. Two local decision-support components rank schools and detect unusual attendance patterns, and always show the reasons for their output. The protection of sensitive records is enforced by the database itself, and the security of the access path was verified by tests.");
H2("Conclusions");
P("The project shows that a single system can serve three administrative levels with strict separation of scope, and that simple statistical methods, accompanied by their evidence, are sufficient to draw the attention of managers to the cases that need it. Computing every figure from one source removes the disagreement between reports that motivated the work.");
H2("Future work");
B([
  "Measurement of presentation-attack detection on volunteers with printed photographs and replayed video, reporting APCER, BPCER and their average as defined by ISO/IEC 30107-3, and a passive liveness check as a second layer.",
  "Calibration of the face-matching threshold with 10 to 15 volunteers, publishing the false accept and false reject rates for several thresholds.",
  "Mobile-optimised kiosk and a quick action for recording power outages.",
  "Management of subjects and of the assignment of contract teachers to a second school from the interface.",
  "A request-rate limit for all routes, shared between several server instances, and notifications by e-mail or messaging for alerts.",
  "Analysis of the results of students over several terms, once real data is available.",
]);

// ---------------------------------------------------------------- appendices
APPENDIX("Configurable parameters");
P("The following parameters are stored in the settings table and can be changed without modifying the program. Changes made by the directorate or the ministry apply immediately to all schools.");
TBL("Settings", [3300, 2200, 3855], ["Parameter", "Default", "Meaning"], [
  ["Permanent teacher quota rules", "22 / 21 / 19", "Weekly lessons by years of service (below 10, 10 to 19, 20 and above)"],
  ["Contract lesson rate", "15 000 SYP", "Indicative payment per executed lesson (display only)"],
  ["Lesson duration", "45 minutes", "Used for teaching-time calculations"],
  ["Late tolerance", "15 minutes", "Grace period before lateness is counted"],
  ["Administrative working hours", "08:00 to 13:30", "Expected hours of non-teaching staff"],
  ["Duplicate event window", "2 minutes", "Repeated events of the same type are ignored"],
  ["Face match threshold", "0.42", "Minimum cosine similarity to accept a match"],
  ["Request overdue days", "7", "An open request older than this is overdue"],
  ["Request priority weights", "0.30 / 0.20 / 0.20 / 0.15 / 0.15", "Severity, affected students, waiting, fragility, repetition"],
  ["School performance weights", "0.35 / 0.30 / 0.15 / 0.20", "Attendance, quota, request speed, results"],
  ["School need weights", "0.30 / 0.30 / 0.20 / 0.20", "Shortage, absence, overdue requests, results decline"],
]);
APPENDIX("Database tables by group");
TBL("Tables of the database", [2700, 6655], ["Group", "Tables"], [
  ["Organisation and accounts (9)", "ministries, directorates, schools, roles, users, employees, employee_assignments, teacher_profiles, school_deputy_authorizations"],
  ["Academic structure and timetables (9)", "academic_years, classes, sections, students, student_enrollments, subjects, teaching_assignments, timetables, timetable_periods"],
  ["Attendance (5)", "attendance_events, face_embeddings, attendance_corrections, power_outages, offline_captures"],
  ["Leave, lessons and reports (3)", "employee_leaves, lesson_executions, report_approvals"],
  ["Requests and communication (9)", "school_requests, request_status_history, request_attachments, request_comments, notifications, notification_reads, messages, message_recipients, message_attachments"],
  ["Results and audit (4)", "result_sheets, term_results, result_corrections, audit_logs"],
  ["Configuration (1)", "settings"],
]);
APPENDIX("Organisation of the source code");
P("The source code is kept in a public repository [TODO: confirm the repository address and whether it should appear in the report]. The main folders are the following.");
TBL("Folders of the project", [2700, 6655], ["Folder", "Content"], [
  ["backend", "Application server: routes, services, pure algorithms with their tests, middleware"],
  ["frontend", "Web application: pages, shared components, navigation and the theme"],
  ["face-service", "Python face detection, liveness evaluation and recognition service"],
  ["tests", "Integration test for offline synchronisation and a stand-in face service"],
  ["database", "Schema, default settings, migrations, the demonstration data generator and the rebuild script"],
  ["docs", "Report figures with their sources and build script, and the discussion scenario"],
]);

// ---------------------------------------------------------------- references
UNNUMBERED("References");
TODO("Verify every entry below (authors, year, title, venue, pages) against the original source before submission, and add the sources reviewed for Section 2.5. Entries are cited in the text by their number.");
const refs = [
  "Jones, M., Bradley, J. and Sakimura, N. 2015. JSON Web Token (JWT). RFC 7519. Internet Engineering Task Force.",
  "Provos, N. and Mazieres, D. 1999. A future-adaptable password scheme. In Proceedings of the USENIX Annual Technical Conference, FREENIX Track.",
  "Dworkin, M. 2007. Recommendation for block cipher modes of operation: Galois/Counter Mode (GCM) and GMAC. NIST Special Publication 800-38D. National Institute of Standards and Technology.",
  "OWASP Foundation. OWASP Top 10: the ten most critical web application security risks. https://owasp.org/www-project-top-ten/",
  "Zhong, Y., Deng, W., Hu, J., Zhao, D., Li, X. and Wen, D. 2021. SFace: sigmoid-constrained hypersphere loss for robust face recognition. IEEE Transactions on Image Processing, 30.",
  "Wu, W., Peng, H. and Yu, S. 2023. YuNet: a tiny millisecond-level face detector. Machine Intelligence Research.",
  "Ferraiolo, D. and Kuhn, R. 1992. Role-based access controls. In Proceedings of the 15th National Computer Security Conference.",
  "OpenCV. OpenCV Zoo: model collection for OpenCV. https://github.com/opencv/opencv_zoo",
  "PostgreSQL Global Development Group. PostgreSQL documentation. https://www.postgresql.org/docs/",
];
refs.forEach((t, i) => body.push(new Paragraph({ alignment: AlignmentType.LEFT, spacing: { line: 360, after: 160 },
  indent: { left: 567, hanging: 567 }, children: [run(`[${i + 1}]  ${t}`)] })));

// ---------------------------------------------------------------- document
const sectionProps = {
  page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1417, right: 1134, header: 567, footer: 567 } },
  titlePage: true,
};
const header = new Header({ children: [new Paragraph({
  tabStops: [{ type: TabStopType.RIGHT, position: TEXT_WIDTH }],
  border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "808080", space: 2 } },
  children: [run(`${AUTHOR}  |  ${DEGREE}  |  2026`, { size: 20 }), run("\t", { size: 20 }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 20 })],
})] });
const emptyHeader = new Header({ children: [new Paragraph({ children: [] })] });

const doc = new Document({
  creator: "Author", title: "A Central System for Managing and Monitoring Schools",
  features: { updateFields: true },
  styles: {
    default: { document: { run: { font: FONT, size: 24 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FONT, size: 28, bold: true }, paragraph: { spacing: { before: 0, after: 240 }, keepNext: true, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FONT, size: 24, bold: true }, paragraph: { spacing: { before: 360, after: 240 }, keepNext: true, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FONT, size: 24, bold: true, italics: true }, paragraph: { spacing: { before: 360, after: 240 }, keepNext: true, outlineLevel: 2 } },
      { id: "FigureCaption", name: "Figure Caption", basedOn: "Normal", next: "Normal", run: { font: FONT, size: 24, bold: true } },
      { id: "TableCaption", name: "Table Caption", basedOn: "Normal", next: "Normal", run: { font: FONT, size: 24, bold: true } },
    ],
  },
  numbering: { config: [{ reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }] },
  sections: [{
    properties: sectionProps,
    headers: { default: header, first: emptyHeader },
    children: [...front, ...body],
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log(`wrote ${OUT} (${Math.round(buf.length / 1024)} KB), figures: ${fs.readdirSync(FIG_DIR).filter((f) => f.endsWith(".png")).length} available`);
});

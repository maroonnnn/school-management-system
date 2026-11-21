# Report figures

All figures are in English for the project report. Each one is available as PNG (for Word, 2x resolution) and SVG
(vector) in `out/`. The Mermaid sources are in `src/`, so any figure can be edited and re-rendered.

## Figure list, suggested captions and chapter

| File | Suggested caption | Chapter |
|---|---|---|
| `fig_use_case_central` | Use cases of the ministry and directorate administrators | Requirements |
| `fig_use_case_school_management` | Use cases of the school principal and deputy principal | Requirements |
| `fig_use_case_school_users` | Use cases of teachers, supervisors and administrative staff | Requirements |
| `fig_architecture` | System architecture | Design |
| `erd_1_organisation` | Entity-relationship diagram, part 1: ministry, directorates, schools and accounts | Design (database) |
| `erd_2_staff` | Entity-relationship diagram, part 2: employees and assignments | Design (database) |
| `erd_3_classes_students` | Entity-relationship diagram, part 3: classes, sections and students | Design (database) |
| `erd_4_teaching_timetables` | Entity-relationship diagram, part 4: subjects, teaching assignments and timetables | Design (database) |
| `erd_5_attendance` | Entity-relationship diagram, part 5: attendance, face vectors, corrections and outages | Design (database) |
| `erd_6_leave_lessons_reports` | Entity-relationship diagram, part 6: leave, lesson corrections and report approvals | Design (database) |
| `erd_7_requests` | Entity-relationship diagram, part 7: school requests | Design (database) |
| `erd_8_messages_notifications` | Entity-relationship diagram, part 8: messages and notifications | Design (database) |
| `erd_9_results_audit` | Entity-relationship diagram, part 9: term results and audit log | Design (database) |
| `fig_face_sequence` | Sequence diagram of face check-in | Design |
| `fig_request_states` | State diagram of a school request | Design |
| `fig_results_workflow` | Term results workflow | Design |
| `fig_day_classification` | Flowchart of the daily attendance classification | Algorithms |
| `fig_request_priority` | Computation of the request priority score | Algorithms |
| `fig_performance_index` | School performance and need indices | Algorithms |
| `fig_anomaly_pipeline` | Attendance anomaly detection pipeline | Algorithms |

Notes to put under the ERD figures (once, in the text): foreign keys that point to the `users` table (author columns
such as `created_by`, `recorded_by`, `decided_by`) are kept as attributes but their lines are omitted for readability.
Entities drawn with only an `id` are shown for context and are fully described in another part. Settings and
reference tables without relations (`settings`) are described in the text.

## Rebuilding

The ERDs are generated from the live PostgreSQL schema, so they always match the database.

```powershell
python docs/diagrams/build.py
```

Requirements: the `school_pilot` database running, Google Chrome installed (used headless to render), and internet
access (the Mermaid library is loaded from a CDN). Render a single figure: `python docs/diagrams/build.py fig_architecture`.
Skip regenerating the ERDs: add `--no-erd`. Paths and the database password can be overridden with the `CHROME`,
`PSQL` and `PGPASSWORD` environment variables.

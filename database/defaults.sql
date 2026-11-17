-- Reference data every database needs (not pilot/demo data).
-- schema.sql is schema-only, so data inserted by migrations must also live here.
-- Rebuild order: schema.sql → defaults.sql → seed.sql
-- Keep in sync when a migration adds a setting.
BEGIN;
INSERT INTO settings (key, value, description) VALUES
  ('permanent_quota_rules', '[{"minYears":0,"quota":22},{"minYears":10,"quota":21},{"minYears":20,"quota":19}]',
   'نصاب المعلم المثبّت الأسبوعي حسب سنين الخدمة (أعلى minYears ينطبق)'),
  ('contract_lesson_rate', '15000', 'أجر الحصة للمعلم الوكيل بالليرة السورية (للعرض/التقدير فقط)'),
  ('lesson_duration_minutes', '45', 'مدة الحصة بالدقائق (FR-SCH-05)'),
  ('late_tolerance_minutes', '15', 'سماحية التأخير بالدقائق'),
  ('period_times', '{"1":"08:00","2":"08:45","3":"09:30","4":"10:30","5":"11:15","6":"12:00"}',
   'وقت بداية كل حصة (رقم الحصة → HH:MM)'),
  ('work_days', '[1,2,3,4,5]', 'أيام الدوام: 1 = الأحد ... 7 = السبت'),
  ('staff_work_hours', '{"start":"08:00","end":"13:30"}', 'دوام الكادر الإداري (غير المعلمين)'),
  ('duplicate_event_window_minutes', '2', 'تجاهل حدث مكرر لنفس الموظف والنوع خلال هذه المدة (FR-ATT-08)'),
  ('face_match_threshold', '0.42', 'حد التطابق الوحيد (تشابه جيب التمام) لقبول التعرّف على الوجه (FR-ATT-05)'),
  ('request_priority_weights', '{"severity":0.30,"affected":0.20,"waiting":0.20,"fragility":0.15,"repetition":0.15}',
   'أوزان عوامل أولوية الطلب (FR-REQ-16, FR-ALG-02)'),
  ('request_overdue_days', '7', 'يُعتبر الطلب المفتوح متأخراً بعد هذا العدد من الأيام (FR-REQ-16)')
ON CONFLICT (key) DO NOTHING;
COMMIT;

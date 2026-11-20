-- 012: weights of the school performance and need indices (AI idea 4, FR-ALG-08, FR-DASH-07). Editable from /settings.
BEGIN;
INSERT INTO settings (key, value, description) VALUES
  ('school_performance_weights', '{"attendance":0.35,"quota":0.30,"requests":0.15,"results":0.20}',
   'أوزان مؤشر أداء المدرسة: الحضور، إنجاز النصاب، سرعة معالجة الطلبات، مستوى المحصّلات'),
  ('school_need_weights', '{"shortage":0.30,"absence":0.30,"overdue":0.20,"decline":0.20}',
   'أوزان مؤشر الاحتياج المركّب (FR-ALG-08): نقص الكادر، الغياب، الطلبات المتأخرة، تراجع النتائج')
ON CONFLICT (key) DO NOTHING;
COMMIT;

-- sl_004 实时同步：sl_records 变化时通知在线的设备（合伙人一录入，另一边几秒内更新）
-- 可重复执行（已在发布里就跳过）。前置：sl_001。

do $$
begin
  alter publication supabase_realtime add table public.sl_records;
exception
  when duplicate_object then null;   -- 已加入
  when undefined_object then null;   -- 没有 supabase_realtime 发布（非 Supabase 环境）
end $$;

-- 验证：select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'sl_records';  → 1 行

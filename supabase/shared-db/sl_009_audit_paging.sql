-- sl_009：审计日志分页。应用改为每次取 20 条、按 seq 由近及远翻页（seq < 上一页最后一条），
-- 并可按操作 / 类型 / 成员 / 日期筛选。这个索引让「某个账本、seq 倒序」直接走索引，不用扫全表再排序。
-- 只加索引，不改数据；可重复执行。不执行也能用，只是日志多了以后慢一些。
create index if not exists sl_audit_org_seq on public.sl_audit_log (org_id, seq desc);

-- 验证：explain select seq from public.sl_audit_log where org_id = '<账本 id>' order by seq desc limit 21;
--       应看到 Index Scan using sl_audit_org_seq

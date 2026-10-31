-- 006：审计日志分页（独立项目版，对应 shared-db/sl_009）。只加索引，可重复执行。
create index if not exists audit_org_seq on audit_log (org_id, seq desc);

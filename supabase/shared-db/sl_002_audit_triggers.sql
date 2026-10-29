-- sl_002 服务端时间戳 + 留痕触发器
-- updated_at / updated_by 由数据库定，客户端改不了；每次新增 / 修改 / 删除由触发器写入 sl_audit_log。
-- 可重复执行、不删数据、整体在一个事务里。前置：sl_001。

begin;

create or replace function public.sl_records_before() returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists sl_records_before on public.sl_records;
create trigger sl_records_before before insert or update on public.sl_records for each row execute function public.sl_records_before();

create or replace function public.sl_records_audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.sl_audit_log (org_id, kind, rec_id, action, before, after, by_user)
  values (new.org_id, new.kind, new.id,
          case when tg_op = 'INSERT' then 'create' when new.deleted and not old.deleted then 'delete' else 'update' end,
          case when tg_op = 'UPDATE' then old.data end, new.data, auth.uid());
  return new;
end $$;
drop trigger if exists sl_records_audit on public.sl_records;
create trigger sl_records_audit after insert or update on public.sl_records for each row execute function public.sl_records_audit();

-- 触发器函数不该被直接调用
revoke all on function public.sl_records_before() from public, anon, authenticated;
revoke all on function public.sl_records_audit() from public, anon, authenticated;

commit;

-- 验证：sl_003 之后用 sl_put_record 写一条，sl_audit_log 应多出一行 action = 'create'

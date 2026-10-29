-- sl_001 稻种账本核心表（并入 baby-log 现有数据库用；所有对象一律 sl_ 前缀，不碰 families / hs_ / wb_ 的任何东西）
-- 可重复执行、不删数据、整体在一个事务里。
--   sl_orgs / sl_org_members  经销商账本和成员（owner / partner / viewer）
--   sl_records                所有业务记录（销售、收款、进货……），data 是 JSON；只软删除
--   sl_audit_log              留痕，由触发器写（sl_002），只增不改不删
-- 权限和写入函数见 sl_002 / sl_003。执行顺序：sl_001 → sl_002 → sl_003 → sl_004。

begin;

create table if not exists public.sl_orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists public.sl_org_members (
  org_id uuid not null references public.sl_orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'partner' check (role in ('owner', 'partner', 'viewer')),
  status text not null default 'active' check (status in ('active', 'pending')),
  name text,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create table if not exists public.sl_records (
  org_id uuid not null references public.sl_orgs(id) on delete cascade,
  kind text not null,
  id text not null,
  data jsonb not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid,
  primary key (org_id, kind, id)
);
create index if not exists sl_records_org_updated on public.sl_records (org_id, updated_at);
create table if not exists public.sl_audit_log (
  seq bigserial primary key,
  org_id uuid not null,
  kind text not null,
  rec_id text not null,
  action text not null,
  before jsonb,
  after jsonb,
  by_user uuid,
  at timestamptz not null default clock_timestamp()
);
create index if not exists sl_audit_org_at on public.sl_audit_log (org_id, at desc);

-- 当前用户在某个账本里的角色（只认正式成员；待批准的看不到任何数据）。放在表之后、策略之前
create or replace function public.sl_member_role(p_org uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.sl_org_members where org_id = p_org and user_id = auth.uid() and status = 'active'
$$;

alter table public.sl_orgs enable row level security;
alter table public.sl_org_members enable row level security;
alter table public.sl_records enable row level security;
alter table public.sl_audit_log enable row level security;

drop policy if exists sl_orgs_read on public.sl_orgs;
create policy sl_orgs_read on public.sl_orgs for select to authenticated using (public.sl_member_role(id) is not null);
drop policy if exists sl_members_read on public.sl_org_members;
create policy sl_members_read on public.sl_org_members for select to authenticated using (user_id = auth.uid() or public.sl_member_role(org_id) = 'owner');
drop policy if exists sl_records_read on public.sl_records;
create policy sl_records_read on public.sl_records for select to authenticated using (public.sl_member_role(org_id) is not null);
drop policy if exists sl_audit_read on public.sl_audit_log;
create policy sl_audit_read on public.sl_audit_log for select to authenticated using (public.sl_member_role(org_id) in ('owner', 'partner'));
-- 故意不建任何 insert / update / delete 策略：客户端只能通过 sl_003 的函数写

revoke all on public.sl_orgs, public.sl_org_members, public.sl_records, public.sl_audit_log from public, anon, authenticated;
grant select on public.sl_orgs, public.sl_org_members, public.sl_records, public.sl_audit_log to authenticated;
revoke all on function public.sl_member_role(uuid) from public, anon;
grant execute on function public.sl_member_role(uuid) to authenticated;

commit;

-- 验证（SQL Editor）：
--   select table_name from information_schema.tables where table_schema = 'public' and table_name like 'sl\_%';   -- 4 行
--   select polrelid::regclass, polname from pg_policy where polrelid::regclass::text like 'sl\_%';              -- 4 条 select 策略，没有写策略

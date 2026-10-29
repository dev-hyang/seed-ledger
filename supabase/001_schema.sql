-- ============ 稻种经销账本：云端表结构 ============
-- 在你自己的（独立的）Supabase 项目里：SQL Editor → 粘贴整份 → Run。可重复执行。
-- 设计：
--   records    所有业务记录（销售、收款、进货……）一张表，data 是 JSON；只软删除（deleted=true），永远不真正删。
--   audit_log  留痕：每次新增 / 修改 / 删除由数据库触发器自动写，只增不改不删，客户端绕不过去。
--   写入只走 put_record()：校验角色、用 base 时间戳做冲突检测（别人先改了就返回 conflict，不会悄悄覆盖）。
--   角色：owner（创建者，管成员）/ partner（合伙人，可录入修改）/ viewer（只读）。

create extension if not exists pgcrypto;

create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists org_members (
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'partner' check (role in ('owner', 'partner', 'viewer')),
  status text not null default 'active' check (status in ('active', 'pending')),
  name text,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create table if not exists records (
  org_id uuid not null references orgs(id) on delete cascade,
  kind text not null,
  id text not null,
  data jsonb not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid,
  primary key (org_id, kind, id)
);
create index if not exists records_org_updated on records (org_id, updated_at);
create table if not exists audit_log (
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
create index if not exists audit_org_at on audit_log (org_id, at desc);

-- ---------- 权限辅助 ----------
create or replace function member_role(p_org uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from org_members where org_id = p_org and user_id = auth.uid() and status = 'active'
$$;

-- ---------- 行级权限 ----------
alter table orgs enable row level security;
alter table org_members enable row level security;
alter table records enable row level security;
alter table audit_log enable row level security;

drop policy if exists orgs_read on orgs;
create policy orgs_read on orgs for select using (member_role(id) is not null);
drop policy if exists members_read on org_members;
create policy members_read on org_members for select using (user_id = auth.uid() or member_role(org_id) = 'owner');
drop policy if exists records_read on records;
create policy records_read on records for select using (member_role(org_id) is not null);
drop policy if exists audit_read on audit_log;
create policy audit_read on audit_log for select using (member_role(org_id) in ('owner', 'partner'));
-- 没有任何 insert / update / delete 策略：客户端只能通过下面的函数写

revoke all on orgs, org_members, records, audit_log from anon, authenticated;
grant select on orgs, org_members, records, audit_log to authenticated;

-- ---------- 触发器：服务端时间戳 + 留痕 ----------
create or replace function records_before() returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists records_before on records;
create trigger records_before before insert or update on records for each row execute function records_before();

create or replace function records_audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (org_id, kind, rec_id, action, before, after, by_user)
  values (new.org_id, new.kind, new.id,
          case when tg_op = 'INSERT' then 'create' when new.deleted and not old.deleted then 'delete' else 'update' end,
          case when tg_op = 'UPDATE' then old.data end, new.data, auth.uid());
  return new;
end $$;
drop trigger if exists records_audit on records;
create trigger records_audit after insert or update on records for each row execute function records_audit();

-- ---------- 写入 ----------
-- p_base：客户端上次看到的 updated_at（新记录传 null）。与服务器不一致 = 别人先改过 → 返回 conflict 和服务器当前版本
create or replace function put_record(p_org uuid, p_kind text, p_id text, p_data jsonb, p_deleted boolean, p_base timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cur records; role_ text := member_role(p_org);
begin
  if role_ is null or role_ = 'viewer' then raise exception 'not allowed' using errcode = '42501'; end if;
  if length(p_kind) > 24 or length(p_id) > 64 or pg_column_size(p_data) > 200000 then raise exception 'bad record' using errcode = '22023'; end if;
  select * into cur from records where org_id = p_org and kind = p_kind and id = p_id for update;
  if found and p_base is distinct from cur.updated_at then
    return jsonb_build_object('conflict', true, 'row', to_jsonb(cur));
  end if;
  insert into records (org_id, kind, id, data, deleted) values (p_org, p_kind, p_id, p_data, coalesce(p_deleted, false))
  on conflict (org_id, kind, id) do update set data = excluded.data, deleted = excluded.deleted
  returning * into cur;
  return jsonb_build_object('ok', true, 'updated_at', cur.updated_at);
end $$;

-- ---------- 组织与成员 ----------
create or replace function create_org(p_name text, p_display text) returns orgs
language plpgsql security definer set search_path = public as $$
declare o orgs;
begin
  if auth.uid() is null then raise exception 'login required' using errcode = '42501'; end if;
  insert into orgs (name) values (left(trim(p_name), 60)) returning * into o;
  insert into org_members (org_id, user_id, role, status, name) values (o.id, auth.uid(), 'owner', 'active', left(trim(p_display), 40));
  return o;
end $$;

-- 凭邀请码申请加入：先是 pending，由 owner 批准后才能看到任何数据
create or replace function join_org(p_code text, p_display text) returns uuid
language plpgsql security definer set search_path = public as $$
declare o orgs;
begin
  if auth.uid() is null then raise exception 'login required' using errcode = '42501'; end if;
  select * into o from orgs where invite_code = trim(p_code);
  if not found then raise exception 'invalid code' using errcode = 'P0002'; end if;
  insert into org_members (org_id, user_id, role, status, name) values (o.id, auth.uid(), 'partner', 'pending', left(trim(p_display), 40))
  on conflict (org_id, user_id) do nothing;
  return o.id;
end $$;

create or replace function set_member(p_org uuid, p_user uuid, p_role text, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if member_role(p_org) <> 'owner' then raise exception 'owner only' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'cannot change yourself' using errcode = '42501'; end if;
  if p_role = 'remove' then delete from org_members where org_id = p_org and user_id = p_user;
  else update org_members set role = p_role, status = p_status where org_id = p_org and user_id = p_user; end if;
end $$;

create or replace function reset_invite(p_org uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
begin
  if member_role(p_org) <> 'owner' then raise exception 'owner only' using errcode = '42501'; end if;
  update orgs set invite_code = c where id = p_org;
  return c;
end $$;

grant execute on function put_record, create_org, join_org, set_member, reset_invite, member_role to authenticated;

-- 实时同步：records 变化时通知在线的设备
do $$ begin
  alter publication supabase_realtime add table records;
exception when duplicate_object then null; end $$;

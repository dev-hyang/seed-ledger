-- sl_005 角色与邀请加固（并入 baby-log 现有数据库用；对应 home-pantry 迁移 049 / baby-log 迁移 022 的逻辑，加上角色分级）
-- 可重复执行、整体在一个事务里。前置：sl_001 … sl_004。独立项目版是 supabase/002_roles_and_invites.sql（本文件去掉 sl_ 前缀生成，两份保持一致）。
--
-- 角色（sl_org_members.role）：
--   owner    创建者   管成员：只有创建者能把别人设为「创建者」或「合伙人」，能移出成员、重新生成 / 关闭邀请码
--   partner  合伙人   能录入和修改数据；能批准 / 拒绝加入申请、查看邀请码；不能改任何人的角色
--   viewer   只读     能查看，不能改。凭邀请码加入的人批准后就是这个角色，要录入得由创建者提升为合伙人
-- 加入流程：
--   ① 凭邀请码申请 → 先是待批准（status = pending）。待批准的人只能读到自己那一行（用来显示「等待批准」），读不到账本名称、邀请码、任何业务数据；
--   ② 创建者或合伙人批准（status → active，角色 = 只读）或拒绝（删掉申请）；
--   ③ 创建者按需提升为合伙人 / 创建者。
-- 邀请码：7 天有效；创建者 / 合伙人打开邀请页时，过期了会自动换一个新的（创建者主动「关闭邀请」的除外）；创建者也可以随时重新生成（1–30 天）或关闭。
--   邀请码和有效期只能通过函数读写，普通成员（只读）读不到。
-- 猜邀请码限速：同一登录身份 15 分钟内猜错 5 次、同一个 IP 10 次、全站 60 次，超了返回 throttled；待批准的人最多 10 个，超了返回 full。
--   sl_join_org 因此返回 jsonb（status = invalid / expired / throttled / full / pending / active），不再用抛异常表示失败——抛异常会把「记一次失败」一起回滚，限速就失效了。
begin;

alter table public.sl_orgs add column if not exists invite_expires_at timestamptz default (now() + interval '7 days');
alter table public.sl_orgs add column if not exists invite_closed boolean not null default false;
alter table public.sl_org_members alter column role set default 'viewer';

-- ---------- 权限辅助 ----------
create or replace function public.sl_is_owner(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.sl_member_role(p_org) = 'owner'
$$;
create or replace function public.sl_can_approve(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.sl_member_role(p_org) in ('owner', 'partner')
$$;

-- ---------- 可见范围 ----------
-- 成员表：自己那一行（待批准的人靠它显示「等待批准」）；创建者 / 合伙人能看到全部（批准要用）；只读成员只看到自己
drop policy if exists sl_members_read on public.sl_org_members;
create policy sl_members_read on public.sl_org_members for select to authenticated
  using (user_id = auth.uid() or public.sl_can_approve(org_id));
-- 账本表：邀请码和有效期不给任何人直接读（只读成员也不行），只能走 sl_invite_info
revoke select on public.sl_orgs from authenticated;
grant select (id, name, created_by, created_at) on public.sl_orgs to authenticated;
-- 成员表对客户端只读（本来就没有写策略，这里再收一道）
revoke insert, update, delete on public.sl_org_members from authenticated, anon;

-- ---------- 猜码记录：客户端完全碰不到 ----------
create table if not exists public.sl_join_attempts (
  id      bigint generated always as identity primary key,
  user_id uuid,
  ip      text,
  ok      boolean not null,
  at      timestamptz not null default now()
);
create index if not exists sl_join_attempts_at_idx on public.sl_join_attempts (at);
alter table public.sl_join_attempts enable row level security;
revoke all on public.sl_join_attempts from public, anon, authenticated;

-- ---------- 加入：凭邀请码申请 ----------
drop function if exists public.sl_join_org(text, text);
create function public.sl_join_org(p_code text, p_display text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ip text := nullif(trim(split_part(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''), ',', 1)), '');
  o public.sl_orgs;
  m public.sl_org_members;
  v_pending int;
begin
  perform public.sl_require_email_user();   -- 匿名用户（baby-log 的免注册成员）不能申请
  delete from public.sl_join_attempts where at < now() - interval '1 day';
  if (select count(*) from public.sl_join_attempts where not ok and at > now() - interval '15 minutes' and user_id = v_uid) >= 5
     or (v_ip is not null and (select count(*) from public.sl_join_attempts where not ok and at > now() - interval '15 minutes' and ip = v_ip) >= 10)
     or (select count(*) from public.sl_join_attempts where not ok and at > now() - interval '15 minutes') >= 60 then
    return jsonb_build_object('status', 'throttled', 'retry_minutes', 15);
  end if;

  select * into o from public.sl_orgs where lower(invite_code) = lower(trim(p_code));
  if not found then
    insert into public.sl_join_attempts (user_id, ip, ok) values (v_uid, v_ip, false);
    return jsonb_build_object('status', 'invalid');
  end if;
  if o.invite_closed or o.invite_expires_at is null or o.invite_expires_at < now() then
    insert into public.sl_join_attempts (user_id, ip, ok) values (v_uid, v_ip, false);
    return jsonb_build_object('status', 'expired');   -- 已关闭的邀请和过期的一样对外说「已失效」，不泄露更多
  end if;

  select * into m from public.sl_org_members where org_id = o.id and user_id = v_uid;
  if found then return jsonb_build_object('status', m.status, 'org_id', o.id); end if;   -- 已经申请过 / 已经是成员

  select count(*) into v_pending from public.sl_org_members where org_id = o.id and status = 'pending';
  if v_pending >= 10 then return jsonb_build_object('status', 'full'); end if;   -- 待批准的太多：先处理

  insert into public.sl_org_members (org_id, user_id, role, status, name)
    values (o.id, v_uid, 'viewer', 'pending', coalesce(nullif(left(trim(p_display), 40), ''), '?'));
  insert into public.sl_join_attempts (user_id, ip, ok) values (v_uid, v_ip, true);
  return jsonb_build_object('status', 'pending', 'org_id', o.id);
end $$;

-- ---------- 批准 / 拒绝：创建者或合伙人 ----------
create or replace function public.sl_approve_member(p_org uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.sl_require_email_user();
  if not public.sl_can_approve(p_org) then raise exception 'owner or partner only' using errcode = '42501'; end if;
  update public.sl_org_members set status = 'active', role = 'viewer'
    where org_id = p_org and user_id = p_user and status = 'pending';   -- 批准后一律是只读；要提升由创建者操作
  if not found then raise exception 'no pending request' using errcode = 'P0002'; end if;
end $$;

create or replace function public.sl_reject_member(p_org uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.sl_require_email_user();
  if not public.sl_can_approve(p_org) then raise exception 'owner or partner only' using errcode = '42501'; end if;
  delete from public.sl_org_members where org_id = p_org and user_id = p_user and status = 'pending';   -- 只能拒绝待批准的；移出正式成员只有创建者能做
end $$;

-- ---------- 角色：只有创建者能改（提升 / 降级 / 移出）；不能改自己 ----------
drop function if exists public.sl_set_member(uuid, uuid, text, text);
create function public.sl_set_member(p_org uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.sl_require_email_user();
  if not public.sl_is_owner(p_org) then raise exception 'owner only' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'cannot change yourself' using errcode = '42501'; end if;   -- 同时保证至少还剩创建者自己
  if p_role = 'remove' then
    delete from public.sl_org_members where org_id = p_org and user_id = p_user;
  elsif p_role in ('owner', 'partner', 'viewer') then
    update public.sl_org_members set role = p_role where org_id = p_org and user_id = p_user and status = 'active';
    if not found then raise exception 'not an active member' using errcode = 'P0002'; end if;   -- 待批准的先走批准
  else
    raise exception 'bad role' using errcode = '22023';
  end if;
end $$;

-- ---------- 邀请码 ----------
create or replace function public.sl_new_code() returns text language sql volatile as $$
  select upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 8))
$$;
-- 读邀请码（创建者 / 合伙人）：过期了且没被关闭就自动换一个新的（7 天），所以这里永远给出当前可用的码
create or replace function public.sl_invite_info(p_org uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.sl_orgs; v_renewed boolean := false;
begin
  perform public.sl_require_email_user();
  if not public.sl_can_approve(p_org) then raise exception 'owner or partner only' using errcode = '42501'; end if;
  select * into o from public.sl_orgs where id = p_org for update;
  if not o.invite_closed and (o.invite_expires_at is null or o.invite_expires_at < now()) then
    update public.sl_orgs set invite_code = public.sl_new_code(), invite_expires_at = now() + interval '7 days' where id = p_org returning * into o;
    v_renewed := true;
  end if;
  return jsonb_build_object('code', o.invite_code, 'expires_at', o.invite_expires_at, 'closed', o.invite_closed, 'renewed', v_renewed);
end $$;

drop function if exists public.sl_reset_invite(uuid);
create function public.sl_reset_invite(p_org uuid, p_days int default 7) returns text
language plpgsql security definer set search_path = public as $$
declare c text := public.sl_new_code();
begin
  perform public.sl_require_email_user();
  if not public.sl_is_owner(p_org) then raise exception 'owner only' using errcode = '42501'; end if;
  update public.sl_orgs set invite_code = c, invite_closed = false,
    invite_expires_at = now() + make_interval(days => greatest(1, least(coalesce(p_days, 7), 30))) where id = p_org;
  return c;
end $$;

create or replace function public.sl_close_invite(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.sl_require_email_user();
  if not public.sl_is_owner(p_org) then raise exception 'owner only' using errcode = '42501'; end if;
  update public.sl_orgs set invite_closed = true, invite_expires_at = now() where id = p_org;   -- 现在就失效，也不会被自动换新
end $$;

-- ---------- 执行权限：只给登录用户（函数里再拒绝匿名）----------
revoke execute on function public.sl_is_owner(uuid), public.sl_can_approve(uuid), public.sl_new_code() from public, anon;
revoke execute on function public.sl_join_org(text, text), public.sl_approve_member(uuid, uuid), public.sl_reject_member(uuid, uuid),
  public.sl_set_member(uuid, uuid, text), public.sl_invite_info(uuid), public.sl_reset_invite(uuid, int), public.sl_close_invite(uuid) from public, anon;
grant execute on function public.sl_is_owner(uuid), public.sl_can_approve(uuid) to authenticated;
grant execute on function public.sl_join_org(text, text), public.sl_approve_member(uuid, uuid), public.sl_reject_member(uuid, uuid),
  public.sl_set_member(uuid, uuid, text), public.sl_invite_info(uuid), public.sl_reset_invite(uuid, int), public.sl_close_invite(uuid) to authenticated;
revoke execute on function public.sl_new_code() from authenticated;   -- 只给其它函数内部用

commit;

-- 验证：
--   select column_name from information_schema.column_privileges where table_name = 'sl_orgs' and grantee = 'authenticated' and privilege_type = 'SELECT';   -- 没有 invite_code / invite_expires_at / invite_closed
--   select column_name from information_schema.column_privileges where table_name = 'sl_org_members' and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE');   -- 应为空
--   用另一个邮箱账号：select public.sl_join_org('错的码', 'x');  → {"status":"invalid"}；连续错 5 次 → {"status":"throttled",…}

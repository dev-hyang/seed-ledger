-- 005 合伙人申请与成员移出：全体同意才生效（独立项目用）
-- 可重复执行、整体在一个事务里。前置：007。独立项目版是 supabase/005_member_votes.sql（本文件去掉  前缀生成，两份保持一致）。
--
-- 规则：
--   ① 申请成为合伙人：只读成员 / 录入员都可以申请（邮箱账号直接申请；免邮箱账号必须先留联系方式：邮箱或电话）。
--      申请人要勾选「已知晓合伙人的权益和责任」；创建者和所有现任合伙人**全部同意**才生效，任何一人拒绝就否决。
--   ② 移出成员：创建者或合伙人发起，创建者和所有合伙人（被移出的人除外）**全部同意**才生效；发起人自动算同意；任何一人拒绝就否决。
--      只有创建者一个人时，发起即生效。不能移出自己，不能移出最后一位创建者。待批准的加入申请还是用「拒绝」，不走表决。
--   ③ 不再允许创建者一个人直接把别人设为合伙人，也不再允许一个人直接移出成员（set_member 里拦掉）；
--      设为 录入员 / 只读 / 创建者 仍然只有创建者能做，免邮箱账号仍然不能当创建者。
--   ④ 结果写进 audit_log（partner_approved / member_removed）。联系方式只有创建者、合伙人和本人看得到。
begin;

alter table public.org_members add column if not exists contact text;

create table if not exists public.member_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  kind text not null check (kind in ('partner', 'remove')),
  target_user uuid not null,
  requested_by uuid not null,
  status text not null default 'open' check (status in ('open', 'done', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index if not exists member_requests_one_open on public.member_requests (org_id, kind, target_user) where status = 'open';
create table if not exists public.request_votes (
  request_id uuid not null references public.member_requests(id) on delete cascade,
  voter uuid not null,
  approve boolean not null,
  at timestamptz not null default now(),
  primary key (request_id, voter)
);
alter table public.member_requests enable row level security;
alter table public.request_votes enable row level security;
drop policy if exists requests_read on public.member_requests;
create policy requests_read on public.member_requests for select to authenticated
  using (public.can_approve(org_id) or target_user = auth.uid() or requested_by = auth.uid());
drop policy if exists votes_read on public.request_votes;
create policy votes_read on public.request_votes for select to authenticated
  using (exists (select 1 from public.member_requests r where r.id = request_id and (public.can_approve(r.org_id) or r.target_user = auth.uid())));
revoke all on public.member_requests, public.request_votes from public, anon, authenticated;
grant select on public.member_requests, public.request_votes to authenticated;

-- 有表决权的人：现任创建者 + 合伙人（排除被表决的那位）
create or replace function public.voters(p_org uuid, p_exclude uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select user_id from public.org_members where org_id = p_org and status = 'active' and role in ('owner', 'partner') and user_id <> p_exclude
$$;
create or replace function public.valid_contact(p text) returns boolean language sql immutable as $$
  select coalesce(p, '') ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or regexp_replace(coalesce(p, ''), '\D', '', 'g') ~ '^\d{7,15}$'
$$;

-- 本人留联系方式（邮箱或电话）：免邮箱账号申请合伙人前必须有
create or replace function public.set_contact(p_org uuid, p_contact text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_user();
  if not public.valid_contact(trim(p_contact)) then raise exception 'bad contact' using errcode = '22023'; end if;
  update public.org_members set contact = left(trim(p_contact), 80) where org_id = p_org and user_id = auth.uid();
  if not found then raise exception 'not a member' using errcode = '42501'; end if;
end $$;

-- 结算一条申请：有人拒绝 → 否决；全部同意 → 生效。返回当前状态
create or replace function public.request_resolve(p_req uuid) returns text
language plpgsql security definer set search_path = public, auth as $$
declare r public.member_requests; v_total int; v_ok int; v_no int;
begin
  select * into r from public.member_requests where id = p_req for update;
  if not found then return 'none'; end if;
  if r.status <> 'open' then return r.status; end if;
  select count(*) into v_total from public.voters(r.org_id, r.target_user);
  select count(*) filter (where v.approve), count(*) filter (where not v.approve) into v_ok, v_no
    from public.request_votes v where v.request_id = p_req and v.voter in (select public.voters(r.org_id, r.target_user));
  if v_no > 0 then
    update public.member_requests set status = 'rejected', resolved_at = now() where id = p_req;
    return 'rejected';
  end if;
  if v_total > 0 and v_ok >= v_total then
    if r.kind = 'partner' then
      if coalesce((select is_anonymous from auth.users where id = r.target_user), false)
         and coalesce((select contact from public.org_members where org_id = r.org_id and user_id = r.target_user), '') = '' then
        update public.member_requests set status = 'rejected', resolved_at = now() where id = p_req;   -- 免邮箱账号没有联系方式：不生效
        return 'rejected';
      end if;
      update public.org_members set role = 'partner' where org_id = r.org_id and user_id = r.target_user and status = 'active';
    else
      delete from public.org_members where org_id = r.org_id and user_id = r.target_user;
    end if;
    update public.member_requests set status = 'done', resolved_at = now() where id = p_req;
    insert into public.audit_log (org_id, kind, rec_id, action, after, by_user)
      values (r.org_id, 'member', r.target_user::text, case r.kind when 'partner' then 'partner_approved' else 'member_removed' end, jsonb_build_object('request', p_req), auth.uid());
    return 'done';
  end if;
  return 'open';
end $$;

-- 申请成为合伙人（本人）
create or replace function public.request_partner(p_org uuid, p_ack boolean) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare m public.org_members; r public.member_requests;
begin
  perform public.require_user();
  if not coalesce(p_ack, false) then raise exception 'must acknowledge' using errcode = '22023'; end if;   -- 要先知晓合伙人的权益和责任
  select * into m from public.org_members where org_id = p_org and user_id = auth.uid() and status = 'active';
  if not found then raise exception 'not an active member' using errcode = '42501'; end if;
  if m.role in ('owner', 'partner') then raise exception 'already partner or owner' using errcode = '22023'; end if;
  if coalesce((select is_anonymous from auth.users where id = auth.uid()), false) and coalesce(m.contact, '') = '' then
    raise exception 'contact required' using errcode = '22023';   -- 免邮箱账号要先留邮箱或电话
  end if;
  select * into r from public.member_requests where org_id = p_org and kind = 'partner' and target_user = auth.uid() and status = 'open';
  if not found then
    insert into public.member_requests (org_id, kind, target_user, requested_by) values (p_org, 'partner', auth.uid(), auth.uid()) returning * into r;
  end if;
  return jsonb_build_object('id', r.id, 'status', public.request_resolve(r.id));
end $$;

-- 发起移出成员（创建者 / 合伙人）：发起人自动同意，其余人表决
create or replace function public.request_remove(p_org uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.member_requests; t public.org_members;
begin
  perform public.require_user();
  if not public.can_approve(p_org) then raise exception 'owner or partner only' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'cannot remove yourself' using errcode = '42501'; end if;
  select * into t from public.org_members where org_id = p_org and user_id = p_user and status = 'active';
  if not found then raise exception 'not an active member' using errcode = 'P0002'; end if;
  if t.role = 'owner' and (select count(*) from public.org_members where org_id = p_org and role = 'owner' and status = 'active') <= 1 then
    raise exception 'last owner' using errcode = '22023';
  end if;
  select * into r from public.member_requests where org_id = p_org and kind = 'remove' and target_user = p_user and status = 'open';
  if not found then
    insert into public.member_requests (org_id, kind, target_user, requested_by) values (p_org, 'remove', p_user, auth.uid()) returning * into r;
  end if;
  insert into public.request_votes (request_id, voter, approve) values (r.id, auth.uid(), true) on conflict (request_id, voter) do nothing;
  return jsonb_build_object('id', r.id, 'status', public.request_resolve(r.id));
end $$;

-- 表决：只有有表决权的人（创建者 + 合伙人，被表决的除外）；可以改票，直到生效或被否决
create or replace function public.vote_request(p_req uuid, p_approve boolean) returns text
language plpgsql security definer set search_path = public as $$
declare r public.member_requests;
begin
  perform public.require_user();
  select * into r from public.member_requests where id = p_req and status = 'open' for update;
  if not found then raise exception 'request closed' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.voters(r.org_id, r.target_user) as v(uid) where v.uid = auth.uid()) then raise exception 'not a voter' using errcode = '42501'; end if;
  insert into public.request_votes (request_id, voter, approve) values (p_req, auth.uid(), coalesce(p_approve, false))
    on conflict (request_id, voter) do update set approve = excluded.approve, at = now();
  return public.request_resolve(p_req);
end $$;

create or replace function public.cancel_request(p_req uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_user();
  update public.member_requests set status = 'cancelled', resolved_at = now() where id = p_req and status = 'open' and requested_by = auth.uid();
  if not found then raise exception 'not yours or already closed' using errcode = '42501'; end if;
end $$;

-- 改角色：不能再一个人把别人设为合伙人、也不能一个人移出成员（走上面的申请 / 表决）；其余同 007
create or replace function public.set_member(p_org uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  perform public.require_email_user();
  if not public.is_owner(p_org) then raise exception 'owner only' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'cannot change yourself' using errcode = '42501'; end if;
  if p_role = 'partner' then raise exception 'use partner request' using errcode = '22023'; end if;
  if p_role = 'remove' then raise exception 'use removal request' using errcode = '22023'; end if;
  if p_role in ('owner', 'staff', 'viewer') then
    if p_role = 'owner' and coalesce((select is_anonymous from auth.users where id = p_user), false) then
      raise exception 'email account required for this role' using errcode = '42501';
    end if;
    update public.org_members set role = p_role where org_id = p_org and user_id = p_user and status = 'active';
    if not found then raise exception 'not an active member' using errcode = 'P0002'; end if;
  else
    raise exception 'bad role' using errcode = '22023';
  end if;
end $$;

-- 合伙人也可能是免邮箱账号了：批准 / 拒绝 / 看邀请码只要求登录 + 角色，不再要求邮箱（重新定义，其余同 005）
create or replace function public.approve_member(p_org uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_user();
  if not public.can_approve(p_org) then raise exception 'owner or partner only' using errcode = '42501'; end if;
  update public.org_members set status = 'active', role = 'viewer' where org_id = p_org and user_id = p_user and status = 'pending';
  if not found then raise exception 'no pending request' using errcode = 'P0002'; end if;
end $$;
create or replace function public.reject_member(p_org uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_user();
  if not public.can_approve(p_org) then raise exception 'owner or partner only' using errcode = '42501'; end if;
  delete from public.org_members where org_id = p_org and user_id = p_user and status = 'pending';
end $$;
create or replace function public.invite_info(p_org uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orgs; v_renewed boolean := false;
begin
  perform public.require_user();
  if not public.can_approve(p_org) then raise exception 'owner or partner only' using errcode = '42501'; end if;
  select * into o from public.orgs where id = p_org for update;
  if not o.invite_closed and (o.invite_expires_at is null or o.invite_expires_at < now()) then
    update public.orgs set invite_code = public.new_code(), invite_expires_at = now() + interval '7 days' where id = p_org returning * into o;
    v_renewed := true;
  end if;
  return jsonb_build_object('code', o.invite_code, 'expires_at', o.invite_expires_at, 'closed', o.invite_closed, 'renewed', v_renewed);
end $$;

revoke execute on function public.voters(uuid, uuid), public.valid_contact(text), public.request_resolve(uuid) from public, anon, authenticated;
revoke execute on function public.set_contact(uuid, text), public.request_partner(uuid, boolean), public.request_remove(uuid, uuid),
  public.vote_request(uuid, boolean), public.cancel_request(uuid) from public, anon;
grant execute on function public.set_contact(uuid, text), public.request_partner(uuid, boolean), public.request_remove(uuid, uuid),
  public.vote_request(uuid, boolean), public.cancel_request(uuid) to authenticated;

commit;

-- 验证：
--   免邮箱成员未留联系方式就 select public.request_partner('<org>', true);  → 报 contact required；set_contact 后可以
--   只有创建者时：成员申请合伙人 → 创建者 vote_request(id, true) → 立即生效（status = done，该成员 role = partner）
--   有合伙人时：必须每个现任合伙人都同意；任何一个 false → rejected
--   创建者调用 set_member(org, user, 'partner') 应报 use partner request；调用 'remove' 应报 use removal request

-- sl_003 写入与成员函数（客户端唯一的写入口）
-- 和独立版（supabase/001_schema.sql）的区别：这个库里有 baby-log 的匿名用户（免注册加入），
-- 所以建账本、申请加入、写记录一律拒绝匿名用户（同 baby-log 迁移 009 的判断方式）；函数全部 sl_ 前缀。
-- 可重复执行、不删数据、整体在一个事务里。前置：sl_001、sl_002。

begin;

-- 匿名用户（邀请码直接进入家庭应用的人）不能碰账本
create or replace function public.sl_require_email_user() returns void language plpgsql stable as $$
begin
  if auth.uid() is null then raise exception 'login required' using errcode = '42501'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise exception 'email account required' using errcode = '42501'; end if;
end $$;

-- 写一条记录。p_base = 客户端上次看到的 updated_at（新记录传 null）；与服务器不一致 = 别人先改过 → 返回 conflict 和服务器当前版本
create or replace function public.sl_put_record(p_org uuid, p_kind text, p_id text, p_data jsonb, p_deleted boolean, p_base timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cur public.sl_records; role_ text;
begin
  perform public.sl_require_email_user();
  role_ := public.sl_member_role(p_org);
  if role_ is null or role_ = 'viewer' then raise exception 'not allowed' using errcode = '42501'; end if;
  if length(p_kind) > 24 or length(p_id) > 64 or pg_column_size(p_data) > 200000 then raise exception 'bad record' using errcode = '22023'; end if;
  select * into cur from public.sl_records where org_id = p_org and kind = p_kind and id = p_id for update;
  if found and p_base is distinct from cur.updated_at then
    return jsonb_build_object('conflict', true, 'row', to_jsonb(cur));
  end if;
  insert into public.sl_records (org_id, kind, id, data, deleted) values (p_org, p_kind, p_id, p_data, coalesce(p_deleted, false))
  on conflict (org_id, kind, id) do update set data = excluded.data, deleted = excluded.deleted
  returning * into cur;
  return jsonb_build_object('ok', true, 'updated_at', cur.updated_at);
end $$;

create or replace function public.sl_create_org(p_name text, p_display text) returns public.sl_orgs
language plpgsql security definer set search_path = public as $$
declare o public.sl_orgs;
begin
  perform public.sl_require_email_user();
  insert into public.sl_orgs (name) values (left(trim(p_name), 60)) returning * into o;
  insert into public.sl_org_members (org_id, user_id, role, status, name) values (o.id, auth.uid(), 'owner', 'active', left(trim(p_display), 40));
  return o;
end $$;

-- 凭邀请码申请加入：先是 pending，由 owner 批准后才能看到任何数据
create or replace function public.sl_join_org(p_code text, p_display text) returns uuid
language plpgsql security definer set search_path = public as $$
declare o public.sl_orgs;
begin
  perform public.sl_require_email_user();
  select * into o from public.sl_orgs where invite_code = trim(p_code);
  if not found then raise exception 'invalid code' using errcode = 'P0002'; end if;
  insert into public.sl_org_members (org_id, user_id, role, status, name) values (o.id, auth.uid(), 'partner', 'pending', left(trim(p_display), 40))
  on conflict (org_id, user_id) do nothing;
  return o.id;
end $$;

-- owner 批准 / 改角色 / 移出（p_role = 'remove' 表示移出）；不能改自己
create or replace function public.sl_set_member(p_org uuid, p_user uuid, p_role text, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.sl_require_email_user();
  if public.sl_member_role(p_org) <> 'owner' then raise exception 'owner only' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'cannot change yourself' using errcode = '42501'; end if;
  if p_role = 'remove' then delete from public.sl_org_members where org_id = p_org and user_id = p_user;
  else update public.sl_org_members set role = p_role, status = p_status where org_id = p_org and user_id = p_user; end if;
end $$;

create or replace function public.sl_reset_invite(p_org uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
begin
  perform public.sl_require_email_user();
  if public.sl_member_role(p_org) <> 'owner' then raise exception 'owner only' using errcode = '42501'; end if;
  update public.sl_orgs set invite_code = c where id = p_org;
  return c;
end $$;

-- 只给登录用户（函数内部再拒绝匿名）；anon / public 一律不行
revoke all on function public.sl_require_email_user() from public, anon;
revoke all on function public.sl_put_record(uuid, text, text, jsonb, boolean, timestamptz) from public, anon;
revoke all on function public.sl_create_org(text, text) from public, anon;
revoke all on function public.sl_join_org(text, text) from public, anon;
revoke all on function public.sl_set_member(uuid, uuid, text, text) from public, anon;
revoke all on function public.sl_reset_invite(uuid) from public, anon;
grant execute on function public.sl_require_email_user() to authenticated;
grant execute on function public.sl_put_record(uuid, text, text, jsonb, boolean, timestamptz) to authenticated;
grant execute on function public.sl_create_org(text, text) to authenticated;
grant execute on function public.sl_join_org(text, text) to authenticated;
grant execute on function public.sl_set_member(uuid, uuid, text, text) to authenticated;
grant execute on function public.sl_reset_invite(uuid) to authenticated;

commit;

-- 验证：用邮箱账号登录后 select public.sl_create_org('测试店', '我');  → 返回一行；
--      匿名用户调用应报 email account required；
--      select * from public.sl_audit_log;（建账本不写 audit，写第一条记录后才有）

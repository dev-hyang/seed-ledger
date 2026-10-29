-- 004 免邮箱加入：新用户只凭邀请码 + 名字就能提交加入申请（独立项目用）
-- 可重复执行、整体在一个事务里。前置：006。独立项目版是 supabase/004_anonymous_join.sql（本文件去掉  前缀生成，两份保持一致）。
-- 前置设置：Supabase 后台 → Authentication → Sign In / Providers → 打开 "Allow anonymous sign-ins"（baby-log 项目已经开着；独立项目要自己开）。
--
-- 免邮箱账号（Supabase 匿名登录）的规则：
--   ① 只能「申请加入」：凭邀请码提交，照样是待批准，由创建者或合伙人批准；批准前什么都看不到；猜码限速同样适用。
--   ② 批准后可以是 只读 / 录入员；不能是 合伙人 / 创建者（这两个角色要批准别人、看邀请码，必须是能找回账号的邮箱账号）；
--      想升级，先在应用里绑定邮箱，再由创建者提升。
--   ③ 不能创建账本（create_org 仍然只认邮箱账号）。
--   ④ 账号绑在这台设备的浏览器上：清了浏览器数据就进不去了，创建者可以把旧的移出、让对方重新申请。
begin;

-- 只要求「登录了」（含匿名）；require_email_user 继续给只有邮箱账号能做的事用
create or replace function public.require_user() returns void language plpgsql stable as $$
begin
  if auth.uid() is null then raise exception 'login required' using errcode = '42501'; end if;
end $$;
revoke execute on function public.require_user() from public, anon;
grant execute on function public.require_user() to authenticated;

-- 写记录：匿名的录入员也能写（角色仍由 member_role 判断，只读成员写不了）
create or replace function public.put_record(p_org uuid, p_kind text, p_id text, p_data jsonb, p_deleted boolean, p_base timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cur public.records; role_ text;
begin
  perform public.require_user();
  role_ := public.member_role(p_org);
  if role_ is null or role_ = 'viewer' then raise exception 'not allowed' using errcode = '42501'; end if;
  if length(p_kind) > 24 or length(p_id) > 64 or pg_column_size(p_data) > 200000 then raise exception 'bad record' using errcode = '22023'; end if;
  select * into cur from public.records where org_id = p_org and kind = p_kind and id = p_id for update;
  if found and p_base is distinct from cur.updated_at then
    return jsonb_build_object('conflict', true, 'row', to_jsonb(cur));
  end if;
  insert into public.records (org_id, kind, id, data, deleted) values (p_org, p_kind, p_id, p_data, coalesce(p_deleted, false))
  on conflict (org_id, kind, id) do update set data = excluded.data, deleted = excluded.deleted
  returning * into cur;
  return jsonb_build_object('ok', true, 'updated_at', cur.updated_at);
end $$;

-- 加入申请：匿名也可以（其余逻辑同 005：限速、过期、待批准上限）
create or replace function public.join_org(p_code text, p_display text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ip text := nullif(trim(split_part(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''), ',', 1)), '');
  o public.orgs;
  m public.org_members;
  v_pending int;
begin
  perform public.require_user();
  delete from public.join_attempts where at < now() - interval '1 day';
  if (select count(*) from public.join_attempts where not ok and at > now() - interval '15 minutes' and user_id = v_uid) >= 5
     or (v_ip is not null and (select count(*) from public.join_attempts where not ok and at > now() - interval '15 minutes' and ip = v_ip) >= 10)
     or (select count(*) from public.join_attempts where not ok and at > now() - interval '15 minutes') >= 60 then
    return jsonb_build_object('status', 'throttled', 'retry_minutes', 15);
  end if;

  select * into o from public.orgs where lower(invite_code) = lower(trim(p_code));
  if not found then
    insert into public.join_attempts (user_id, ip, ok) values (v_uid, v_ip, false);
    return jsonb_build_object('status', 'invalid');
  end if;
  if o.invite_closed or o.invite_expires_at is null or o.invite_expires_at < now() then
    insert into public.join_attempts (user_id, ip, ok) values (v_uid, v_ip, false);
    return jsonb_build_object('status', 'expired');
  end if;

  select * into m from public.org_members where org_id = o.id and user_id = v_uid;
  if found then return jsonb_build_object('status', m.status, 'org_id', o.id); end if;

  select count(*) into v_pending from public.org_members where org_id = o.id and status = 'pending';
  if v_pending >= 10 then return jsonb_build_object('status', 'full'); end if;

  insert into public.org_members (org_id, user_id, role, status, name)
    values (o.id, v_uid, 'viewer', 'pending', coalesce(nullif(left(trim(p_display), 40), ''), '?'));
  insert into public.join_attempts (user_id, ip, ok) values (v_uid, v_ip, true);
  return jsonb_build_object('status', 'pending', 'org_id', o.id);
end $$;

-- 改角色：同 006，另加一条：免邮箱账号不能被设为合伙人 / 创建者
create or replace function public.set_member(p_org uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  perform public.require_email_user();
  if not public.is_owner(p_org) then raise exception 'owner only' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'cannot change yourself' using errcode = '42501'; end if;
  if p_role = 'remove' then
    delete from public.org_members where org_id = p_org and user_id = p_user;
  elsif p_role in ('owner', 'partner', 'staff', 'viewer') then
    if p_role in ('owner', 'partner') and coalesce((select is_anonymous from auth.users where id = p_user), false) then
      raise exception 'email account required for this role' using errcode = '42501';   -- 免邮箱账号只能是只读 / 录入员
    end if;
    update public.org_members set role = p_role where org_id = p_org and user_id = p_user and status = 'active';
    if not found then raise exception 'not an active member' using errcode = 'P0002'; end if;
  else
    raise exception 'bad role' using errcode = '22023';
  end if;
end $$;

commit;

-- 验证：
--   匿名登录后 select public.join_org('正确的码', '小王');  → {"status":"pending",…}；调用 create_org 应报 email account required；
--   创建者把这位匿名成员设为 partner 应报 email account required for this role，设为 staff 成功

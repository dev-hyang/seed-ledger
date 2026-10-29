-- 003 新增角色「录入员」staff：可以录入和修改数据，但不能管成员（独立项目用）
-- 可重复执行、整体在一个事务里。前置：005。独立项目版是 supabase/003_staff_role.sql（本文件去掉  前缀生成，两份保持一致）。
--
-- 四个角色，权限从小到大：
--   viewer   只读成员   只能看
--   staff    录入员     能录入 / 修改数据；不能批准申请、看不到邀请码和审计日志、不能管成员
--   partner  合伙人     录入员能做的 + 批准 / 拒绝加入申请、查看邀请码和审计日志（仍不能改任何人的角色）
--   owner    创建者     全部：改角色（只有创建者能把别人设为录入员 / 合伙人 / 创建者）、移出成员、重新生成 / 关闭邀请码
-- 写入函数 put_record 只拦 viewer，所以 staff 自然能写；批准、邀请码、审计读取只认 owner / partner，所以 staff 够不着，这里不用改。
begin;

alter table public.org_members drop constraint if exists org_members_role_check;
alter table public.org_members add constraint org_members_role_check check (role in ('owner', 'partner', 'staff', 'viewer'));

-- 改角色：和 005 一样只有创建者能调、不能改自己；可设的角色多了 staff
create or replace function public.set_member(p_org uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_email_user();
  if not public.is_owner(p_org) then raise exception 'owner only' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'cannot change yourself' using errcode = '42501'; end if;   -- 同时保证至少还剩创建者自己
  if p_role = 'remove' then
    delete from public.org_members where org_id = p_org and user_id = p_user;
  elsif p_role in ('owner', 'partner', 'staff', 'viewer') then
    update public.org_members set role = p_role where org_id = p_org and user_id = p_user and status = 'active';
    if not found then raise exception 'not an active member' using errcode = 'P0002'; end if;   -- 待批准的先走批准
  else
    raise exception 'bad role' using errcode = '22023';
  end if;
end $$;

commit;

-- 验证：
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'org_members_role_check';   -- 含 'staff'
--   创建者把某位成员设为 staff 后，该成员能写记录，但调用 approve_member / invite_info 会报 owner or partner only

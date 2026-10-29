# Supabase 数据库脚本：两套，二选一

Supabase 免费套餐同时只能有两个项目，所以账本提供两种部署方式。**两套功能完全一样**，前端用 `js/config.js` 里的 `DB_PREFIX` 切换。

| | A. 独立项目 | B. 并入 baby-log 数据库 |
|---|---|---|
| 脚本 | `001_schema.sql`（一个文件） | `shared-db/sl_001 … sl_004`（按顺序，每个可重复执行） |
| 对象名 | `orgs` `records` `put_record` … | 全部 `sl_` 前缀：`sl_orgs` `sl_records` `sl_put_record` … |
| `DB_PREFIX` | `""` | `"sl_"` |
| URL / anon key | 新项目的 | baby-log 那个项目的 |
| 隔离程度 | 最好：数据、账号、配额都独立 | 表和权限独立，但**同一个项目**：共用账号体系、500 MB 配额、同一个后台 |
| 需要占用项目名额 | 是（第 3 个项目，免费版不行） | 否 |

## B 的执行顺序（baby-log 项目 → SQL Editor）
1. `shared-db/sl_001_core_tables.sql`：4 张表 + 角色函数 + 行级权限（只给 select，没有写策略）
2. `shared-db/sl_002_audit_triggers.sql`：服务端时间戳 + 留痕触发器
3. `shared-db/sl_003_write_and_members.sql`：写入函数、建账本、邀请加入、批准成员（**拒绝匿名用户**）
4. `shared-db/sl_004_realtime.sql`：实时同步

然后 `js/config.js`：`DB_PREFIX = "sl_"`，URL 和 anon key 填 baby-log 项目的。

`sl_` 迁移的编号独立于 baby-log 的 `NNN_*.sql`，互不影响；以后账本的结构变动继续追加 `sl_005_…`。
如果想和 baby-log 一样统一放到 `baby-log/supabase/migrations/`，把这四个文件原样复制过去即可（文件名不会冲突），
并在它的 README 迁移表里加一行。

## B 和 A 的区别（为什么不能直接把 A 改个名）
- **拒绝匿名用户**：baby-log 开了「匿名登录」（邀请码免注册加入），库里有大量匿名用户。账本的建账本、申请加入、写记录都要求邮箱账号（判断方式同 baby-log 迁移 009）。
- **登录会话独立**：同一个域名下的几个应用默认共享浏览器里的登录会话。账本客户端用单独的存储键，所以登录账本不会把家庭应用的会话顶掉，反过来也一样。
- **函数权限收紧**：`revoke … from public, anon`，只给 `authenticated`。
- 没有 `create extension`（项目里已有）。

## 选 B 要知道的取舍
- 邮箱注册对整个项目开放：任何人注册后都能 `sl_create_org` 建一个**空的、自己的**账本（看不到别人的）。想限制就在 Authentication 里关掉公开注册，改成手动邀请。
- 账本数据是文本 JSON，很小；但要和家庭应用共用 500 MB 数据库配额（家庭应用的备份桶、音频在 Storage，另算 1 GB）。
- 备份：baby-log 的 `backup_family` 只备份它自己的表，**不包含** `sl_` 表。账本数据靠应用里的「更多 → 备份与恢复」导出 JSON，或在后台做数据库备份。
- 以后想拆出来：在 Supabase 后台导出 `sl_` 表，或用应用的 JSON 备份导入新项目，再把 `DB_PREFIX` 改回 `""`。

## 回滚（只删账本的对象，不碰 baby-log）
```sql
begin;
drop table if exists public.sl_audit_log, public.sl_records, public.sl_org_members, public.sl_orgs cascade;
drop function if exists public.sl_put_record(uuid, text, text, jsonb, boolean, timestamptz);
drop function if exists public.sl_create_org(text, text), public.sl_join_org(text, text), public.sl_set_member(uuid, uuid, text, text),
  public.sl_reset_invite(uuid), public.sl_require_email_user(), public.sl_member_role(uuid), public.sl_records_before(), public.sl_records_audit();
commit;
```
（会删除账本的所有数据，执行前先在应用里导出备份。）

## 验证状态
- 两套 SQL（含全部 PL/pgSQL 函数体）都用 Postgres 官方解析器（pglast / libpg_query）检查过**语法**，通过。
- **还没有在真实的 Supabase 上执行过**（本机没有数据库环境）：权限、行级策略、触发器的实际行为未验证。第一次执行后请跑各文件末尾注释里的验证语句，并反馈报错。

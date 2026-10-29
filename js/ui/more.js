/* ============ 更多：账户与成员 · 设置 · 审计日志 · 同步冲突 · 备份 ============ */
import { S, save, saveSettings, remove, live, notify, KINDS, DEFAULT_SEASONS } from "../core/state.js";
import { esc, toast, newId, downloadText } from "../core/util.js";
import { t, LOCALES, locale, setLocale, UNITS, currency } from "../core/i18n.js";
import { CLOUD_CONFIGURED, APP_VERSION } from "../config.js";
import * as cloud from "../core/sync.js";
import { authMessage, signupOutcome, joinOutcome, inviteState, perms, cleanInvite, extractInvite, validContact, partnerError } from "../core/auth-msg.js";
import * as db from "../core/db.js";
import { DIRS } from "../logic/route.js";
import { byId, sortBy, ro } from "./common.js";
import { show, replace, back, closeAll, fld, text, num, select, seg, formData, badge, empty, btn, kv, ask } from "./kit.js";
import { PROVIDERS, providerOf, aiSettings, saveAiSettings, aiReady, testAi } from "../core/ai.js";
import { ACT, FORMS, CHG, INP } from "./actions.js";

const ROLE = { owner: "创建者", partner: "合伙人（录入 + 批准申请）", staff: "录入员（可录入，不能管成员）", viewer: "只读成员" };
const KIND_LAB = { sale: "销售单", pay: "收款", adj: "催账调整", purchase: "进货", sreturn: "退货", spay: "打款入池", sfee: "手续费", customer: "客户", brand: "品种", price: "价格", supplier: "种子公司", trip: "送货", town: "镇", setting: "设置" };
const ACTION_LAB = { create: "新增", update: "修改", delete: "删除", restore: "恢复" };

function renderMore(){
  const mem = S.cloud === "online" || S.cloud === "offline";
  return `<div class="page-head"><h1>${esc(t("更多"))}</h1></div>
    <section class="card"><h3>${esc(t("账户与同步"))}</h3>${accountBlock()}</section>
    <ul class="list menu">
      <li><button class="row" data-act="open-settings"><span class="row-main"><b>${esc(t("设置"))}</b><small>${esc(t("语言、币种、单位、季节名称、送货参数、镇与距离"))}</small></span><span>›</span></button></li>
      <li><button class="row" data-act="open-ai"><span class="row-main"><b>${esc(t("AI 助手"))}</b><small>${esc(aiReady() ? t("已设置：") + t(providerOf(aiSettings().provider).name) : t("还没设置（可选）：议价、客户建议、送货路线"))}</small></span><span>›</span></button></li>
      ${perms(S.role).approve ? `<li><button class="row" data-act="open-audit"><span class="row-main"><b>${esc(t("审计日志"))}</b><small>${esc(t("谁在什么时候新增、修改、删除了什么"))}</small></span><span>›</span></button></li>` : ""}
      ${mem && perms(S.role).approve ? `<li><button class="row" data-act="open-members"><span class="row-main"><b>${esc(t("成员与邀请"))}</b><small>${esc(t(S.role === "owner" ? "邀请码、批准申请、改角色" : "邀请码、批准申请"))}</small></span><span>›</span></button></li>` : ""}
      <li><button class="row" data-act="open-conflicts"><span class="row-main"><b>${esc(t("同步冲突"))}</b><small>${esc(t("两个人同时改了同一条记录时，被放弃的那份留在这里"))}</small></span><span>›</span></button></li>
      <li><button class="row" data-act="open-backup"><span class="row-main"><b>${esc(t("备份与恢复"))}</b><small>${esc(t("导出 / 导入全部数据（JSON）"))}</small></span><span>›</span></button></li></ul>
    <p class="hint center">${esc(t("稻种账本"))} · ${esc(t("版本"))} v${esc(APP_VERSION)} · ${esc(t("只提供交易记录和风险提示，不构成法律意见。"))}</p>`;
}

/* ---------- 账户 ---------- */
const CLOUD_LAB = { local: "本机模式（数据只在这台设备）", signedout: "未登录", noorg: "已登录，还没有经销商账本", pending: "等待创建者批准加入", online: "已同步", offline: "离线（恢复网络后自动同步）" };
function accountBlock(){
  const c = S.cloud, st = [`<p>${badge(t(CLOUD_LAB[c]), c === "online" ? "good" : c === "offline" || c === "pending" ? "warn" : "")}${S.syncing ? " " + esc(t("同步中…")) : ""}</p>`];
  if (S.user) st.push(`<p class="meta">${esc(S.user.is_anonymous ? t("访客（免邮箱）") : S.user.email || "")}${S.orgName ? " · " + esc(S.orgName) : ""} · ${esc(t(ROLE[S.role] || ""))}</p>`);
  if (S.pendingOps) st.push(`<p class="hint warn">${esc(t("{n} 条记录等待上传（已安全存在本机）", { n: S.pendingOps }))}</p>`);
  if (S.lastSync) st.push(`<p class="meta">${esc(t("上次同步"))} ${esc(S.lastSync.toLocaleTimeString())}</p>`);
  if (!CLOUD_CONFIGURED) st.push(`<p class="hint">${esc(t("云端还没配置：现在是本机模式，功能完整但不同步。配置步骤见 README。"))}</p>`);
  const acts = [];
  if (CLOUD_CONFIGURED && !S.user) acts.push(btn("登录 / 注册", "open-login", { cls: "primary" }));
  if (S.user && c === "noorg") { if (!S.user.is_anonymous) acts.push(btn("创建经销商账本", "open-createorg", { cls: "primary" })); acts.push(btn("用邀请码加入", "open-joinorg")); }   // 免邮箱账号不能创建账本
  if (S.user && (c === "online" || c === "offline")) acts.push(btn("立即同步", "sync-now"));
  if (S.user) acts.push(btn("退出登录", "sign-out"));
  return st.join("") + (acts.length ? `<div class="actions">${acts.join("")}</div>` : "");
}
/* ---------- 登录 / 注册：分步向导（一次只问一个问题，点「下一步」） ----------
   先选怎么开始，然后两条路，每一步一个页面：
     有邀请码：① 邀请码（或粘贴邀请链接）→ ② 你的名字 → ③ 可选：留邮箱和密码（不填 = 免邮箱直接申请加入；填了 = 用邮箱注册并申请加入）
     用邮箱：  ① 邮箱 → ② 密码 → ③ 可选：邀请码（可粘贴链接）→ 点「登录」或「注册」
   有暂存的邀请码（点了邀请链接进来 / 之前填过）时，直接从「有邀请码」这条路开始，码已经填好。
   免邮箱账号只能申请加入，由创建者或合伙人批准；批准后是只读成员。 */
const WZ_STEPS = { invite: ["invite", "name", "account"], email: ["email", "password", "invite2"] };
let wz = { path: null, step: 0, d: {} };
const authForm = el => el.closest(".sheet-in").querySelector("form");
const authSay = (f, msg) => { const b = f && f.querySelector("[data-authmsg]"); if (b) b.textContent = msg; };   // 消息留在弹层里，不会 3 秒就消失
const wzSteps = () => WZ_STEPS[wz.path] || [];
const msgBox = `<p class="hint ai-out" data-authmsg role="status"></p>`;
const STEP_UI = {
  invite: d => ({ title: "输入邀请码", body: `${fld("邀请码，或粘贴邀请链接", text("invite", d.invite || "", { max: 300, ph: "邀请码，或整条邀请链接" }), t("创建者在「更多 → 成员与邀请」里复制；邀请码和链接都行"))}` }),
  name: d => ({ title: "你的名字", body: `${fld("你的名字", text("name", d.name || "", { max: 40 }), t("申请加入时给创建者看"))}` }),
  account: d => ({ title: "要不要留邮箱？（可选）", body: `<p class="hint">${esc(t("不留也行：直接申请加入，批准后是只读成员；账号只存在这台设备的浏览器里，清了浏览器数据就进不去了。留下邮箱和密码，就能在任何设备登录，以后也能申请当合伙人。"))}</p>
      ${fld("邮箱（可选）", text("email", d.email || "", { type: "email", max: 120 }))}${fld("密码（可选，至少 8 位）", `<input name="password" type="password" minlength="8" autocomplete="new-password">`)}` }),
  email: d => ({ title: "你的邮箱", body: `${fld("邮箱", text("email", d.email || "", { type: "email", req: true, max: 120 }), t("小月亮等姊妹应用的账号可以直接登录，不用重新注册"))}` }),
  password: d => ({ title: "密码", body: `${fld("密码", `<input name="password" type="password" minlength="8" required autocomplete="current-password">`, t("至少 8 位。已有账号：下一步点「登录」；新用户点「注册」"))}` }),
  invite2: d => ({ title: "要加入别人的店吗？（可选）", body: `<p class="hint">${esc(t("邀请码是用来加入别人的店的。没有也没关系：登录后你可以创建自己的店，也可以以后再用邀请码加入别人的店。"))}</p>
      ${fld("别人店的邀请码，或邀请链接（可选）", text("invite", d.invite2 || d.invite || "", { max: 300 }))}` })
};
function wizardPage(){
  if (!wz.path) return { title: t("登录 / 注册"), body: `<p class="lead">${esc(t("你想怎么开始？"))}</p>
    <div class="choices"><button type="button" class="choice" data-act="wz-start" data-p="invite"><b>${esc(t("我有邀请码：加入别人的店"))}</b><small>${esc(t("不用邮箱和密码，填邀请码和名字就能申请加入"))}</small></button>
      <button type="button" class="choice" data-act="wz-start" data-p="email"><b>${esc(t("用邮箱登录或注册"))}</b><small>${esc(t("可以创建自己的店，也可以加入别人的店；已有账号直接登录"))}</small></button></div>`,
    foot: `<button class="btn" data-act="close">${esc(t("取消"))}</button>` };
  const steps = wzSteps(), cur = steps[wz.step], last = wz.step === steps.length - 1, ui = STEP_UI[cur](wz.d);
  const dots = `<p class="small muted wz-prog" aria-label="${esc(t("第 {n} 步，共 {m} 步", { n: wz.step + 1, m: steps.length }))}">${steps.map((_, i) => `<i class="${i === wz.step ? "on" : i < wz.step ? "done" : ""}"></i>`).join("")} ${esc(t("第 {n} 步 / 共 {m} 步", { n: wz.step + 1, m: steps.length }))}</p>`;
  const back = `<button type="button" class="btn" data-act="wz-back">${esc(t("上一步"))}</button>`;
  const foot = wz.path === "email" && last
    ? `${back}<button type="button" class="btn primary" data-act="wz-login">${esc(t("登录"))}</button><button type="button" class="btn" data-act="wz-signup">${esc(t("注册"))}</button><button type="button" class="btn" data-act="wz-resend">${esc(t("重发确认邮件"))}</button>`
    : `${back}<button class="btn primary" form="f">${esc(last ? t("完成并申请加入") : t("下一步"))}</button>`;
  return { title: t(ui.title), body: `<form id="f" data-form="wz">${dots}${ui.body}${msgBox}</form>`, foot };
}
ACT["open-login"] = () => { const k = cloud.peekInvite(); wz = { path: k ? "invite" : null, step: 0, d: { invite: k?.code || "", name: k?.display || "" } }; show(wizardPage); };
ACT["wz-start"] = el => { wz.path = el.dataset.p; wz.step = 0; replace(wizardPage); };
ACT["wz-back"] = el => { const f = authForm(el); if (f) Object.assign(wz.d, formData(f)); if (wz.step > 0) wz.step--; else wz.path = null; replace(wizardPage); };
const validEmail = s => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || "").trim());
/** 「下一步」：先检查这一步填对没有，再进下一步；有邀请码那条路的最后一步 = 提交 */
FORMS.wz = async (d, f) => {
  const cur = wzSteps()[wz.step], say = m => authSay(f, m);
  Object.assign(wz.d, d);
  if (cur === "invite" && !extractInvite(d.invite)) { say(t("请填邀请码，或粘贴邀请链接")); return; }
  if (cur === "name" && !(d.name || "").trim()) { say(t("请填你的名字（给创建者看）")); return; }
  if (cur === "email" && !validEmail(d.email)) { say(t("请填正确的邮箱")); return; }
  if (cur === "password" && (d.password || "").length < 8) { say(t("密码至少 8 位")); return; }
  if (cur === "account") {
    const e = (d.email || "").trim(), p = d.password || "";
    if ((e || p) && !validEmail(e)) { say(t("要留邮箱的话，请填正确的邮箱")); return; }
    if ((e || p) && p.length < 8) { say(t("要留邮箱的话，密码至少 8 位")); return; }
    await finishInvite(f); return;
  }
  wz.step++; replace(wizardPage);
};
/** 有邀请码那条路的提交：留了邮箱 → 用邮箱注册（登录后自动申请）；没留 → 免邮箱直接申请 */
async function finishInvite(f){
  const d = wz.d, code = extractInvite(d.invite), name = (d.name || "").trim(), email = (d.email || "").trim();
  authSay(f, t("提交中…"));
  if (email) {
    cloud.rememberInvite(code, name);   // 注册要先去邮箱确认，邀请码先记 24 小时，登录后自动申请
    const { data, error } = await cloud.signUp(email, d.password), out = signupOutcome(data, error, email);
    authSay(f, out.message + (out.kind === "confirm" ? " " + t("邀请码已记下：确认邮箱并登录后会自动申请加入。") : ""));
    if (out.kind === "signed-in") closeAll();
    return;
  }
  const res = await cloud.joinAnonymous(code, name), out = joinOutcome(res.data, res.error);
  authSay(f, out.message);
  if (out.kind === "pending" || out.kind === "active") closeAll();
}
/** 邮箱那条路的最后一步：登录 / 注册 / 重发确认邮件；填了邀请码的话先记下，登录后自动申请 */
async function finishEmail(el, mode){
  const f = authForm(el), d = { ...wz.d, ...formData(f) }; wz.d = d;
  const code = extractInvite(d.invite); if (code) cloud.rememberInvite(code, "");
  authSay(f, t("提交中…"));
  if (mode === "login") { const { error } = await cloud.signIn(d.email, d.password); if (error) authSay(f, t("登录失败：") + authMessage(error)); else closeAll(); return; }
  const { data, error } = await cloud.signUp(d.email, d.password), out = signupOutcome(data, error, d.email);
  authSay(f, out.message + (out.kind === "confirm" && code ? " " + t("邀请码已记下：确认邮箱并登录后会自动申请加入。") : ""));
  if (out.kind === "signed-in") closeAll();
}
ACT["wz-login"] = el => finishEmail(el, "login");
ACT["wz-signup"] = el => finishEmail(el, "signup");
ACT["wz-resend"] = async el => {
  const f = authForm(el), email = (wz.d.email || "").trim();
  if (!validEmail(email)) { authSay(f, t("先填邮箱")); return; }
  const { error } = await cloud.resendConfirm(email);
  authSay(f, error ? authMessage(error) : t("已重发确认邮件到 {email}，几分钟内没收到请看垃圾邮件箱。", { email }));
};
ACT["sign-out"] = async () => { await cloud.signOut(); };
ACT["pending-check"] = async () => { await cloud.recheck(); toast(S.cloud === "pending" ? t("还没批准，请耐心等一下") : t("已批准，正在进入")); };
ACT["sync-now"] = () => cloud.sync();
const orgForm = (title, name, label, hint, kind) => ({ title: t(title), body: `<form id="f" data-form="${kind}">${fld(label, text(name, "", { req: true }))}${fld("你的名字（合伙人看得到）", text("display", "", { req: true, max: 40 }))}${hint ? `<p class="hint">${esc(t(hint))}</p>` : ""}${kind === "joinorg" ? `<p class="hint ai-out" data-authmsg role="status"></p>` : ""}
  ${kind === "createorg" && live("sale").length + live("purchase").length ? `<label class="chk"><input type="checkbox" name="adopt" checked> ${esc(t("把这台设备上已经录入的数据一起放进新账本"))}</label>` : ""}</form>`, foot: `<button class="btn" data-act="back">${esc(t("取消"))}</button><button class="btn primary" form="f">${esc(t("确定"))}</button>` });
ACT["open-createorg"] = () => show(() => orgForm("创建经销商账本", "name", "店名 / 账本名称", "你将成为创建者，可以邀请合伙人、批准加入、设置权限。", "createorg"));
ACT["open-joinorg"] = () => show(() => orgForm("用邀请码加入", "code", "邀请码", "向店的创建者要邀请码（或邀请链接）。创建者或合伙人会在「更多 → 成员与邀请」里看到你的申请并批准。批准前你只能看到「等待批准」，看不到任何数据；批准后是只读成员，要录入由创建者设为录入员或合伙人。", "joinorg"));
FORMS.createorg = async d => { try { await cloud.createOrg(d.name, d.display, d.adopt); closeAll(); } catch (e) { toast(t("创建失败：") + (e.message || e)); } };
FORMS.joinorg = async (d, f) => {
  const res = await cloud.joinOrg(d.code, d.display), out = joinOutcome(res.data, res.error);
  if (out.kind === "error") { const box = f.querySelector("[data-authmsg]"); if (box) box.textContent = out.message; else toast(out.message); return; }   // 错误留在表单里，方便改邀请码重试
  closeAll();
};

/* ---------- 成员与邀请 ----------
   创建者：改角色（只读 / 录入员 / 创建者；合伙人只能走申请）、批准 / 拒绝加入申请、重新生成 / 关闭邀请码、发起移出。
   合伙人：批准 / 拒绝加入申请、查看邀请码、发起移出、参与表决；不能改任何人的角色。
   成为合伙人：本人申请（先看权益和责任并勾选知晓；免邮箱账号还要留邮箱或电话），创建者和所有现任合伙人全部同意才生效，任何一人拒绝即否决。
   移出成员：创建者或合伙人发起，创建者和所有合伙人（被移出的人除外）全部同意才生效，发起人自动算同意。
   界面只决定显示哪些按钮，真正的拦截和结算在数据库函数里（supabase/*member_votes.sql）。 */
const RIGHTS = ["可以录入和修改账本里的数据", "可以批准或拒绝新成员的加入申请，查看邀请码和审计日志", "有表决权：新合伙人加入、移出成员，都要创建者和全体合伙人一致同意",
  "账本里的数据（含客户个人信息）属于经营机密，你有保密责任", "合伙人身份本身，也可以被创建者和其他合伙人一致同意后移出"];
const rightsHTML = () => `<ul class="bul">${RIGHTS.map(r => `<li>${esc(t(r))}</li>`).join("")}</ul>`;
const inviteLine = info => {
  const s = inviteState(info);
  return s.kind === "valid" ? t("有效期还有 {n} 天；过期后打开本页会自动换新的", { n: s.days })
    : s.kind === "closed" ? t("邀请已关闭，新的申请进不来。要邀请人就重新生成。") : s.kind === "expired" ? t("邀请码已过期") : "";
};
const afterAction = async res => { if (res?.error) toast(authMessage(res.error)); await cloud.refreshTeam(); back(); await ACT["open-members"](); };
const NO_TEAM = { members: [], pending: [], requests: [], votes: [], approvers: [], names: {} };
ACT["open-members"] = async () => {
  const team = (await cloud.refreshTeam()) || NO_TEAM, invite = perms(S.role).approve ? await cloud.getInvite() : null;
  show(() => membersPage({ team, invite }));
};
/** 一条申请的进度：有表决权的人、已同意几人、我投过没有 */
function progress(team, r){
  const voters = team.approvers.filter(u => u !== r.target_user), votes = team.votes.filter(v => v.request_id === r.id);
  return { voters, agreed: votes.filter(v => v.approve).length, mine: votes.find(v => v.voter === S.user?.id) };
}
function membersPage({ team, invite }){
  const me = S.user?.id, p = perms(S.role), anon = !!S.user?.is_anonymous, nameOf = id => team.names[id] || "?";
  const active = team.members.filter(m => m.status !== "pending"), open = team.requests.filter(r => r.status === "open");
  const removing = new Set(open.filter(r => r.kind === "remove").map(r => r.target_user));
  const myPartnerReq = open.find(r => r.kind === "partner" && r.target_user === me);
  const roleBox = m => {
    const self = m.user_id === me;
    const opts = ["viewer", "staff", "owner", ...(m.role === "partner" ? ["partner"] : [])];   // 合伙人只能走申请；已经是合伙人的可以降级
    const sel = p.manage && !self
      ? `<select data-change="member-role" data-u="${esc(m.user_id)}" aria-label="${esc(t("角色"))}">${opts.map(r => `<option value="${r}" ${m.role === r ? "selected" : ""}>${esc(t(ROLE[r]))}</option>`).join("")}</select>`
      : badge(t(ROLE[m.role] || m.role), m.role === "owner" ? "good" : "");
    const rm = p.approve && !self ? (removing.has(m.user_id) ? badge(t("移出表决中"), "warn") : `<button class="btn sm ghost-danger" data-act="member-rm" data-u="${esc(m.user_id)}">${esc(t("申请移出"))}</button>`) : "";
    return sel + rm;
  };
  const vote = r => {
    const pr = progress(team, r), canVote = pr.voters.includes(me) && !pr.mine, mineReq = r.requested_by === me, target = team.members.find(m => m.user_id === r.target_user);
    const title = r.kind === "partner" ? t("{n} 申请成为合伙人", { n: nameOf(r.target_user) }) : t("申请移出成员 {n}", { n: nameOf(r.target_user) });
    const prog = pr.voters.length ? t("已同意 {a}/{b}（要全体同意）", { a: pr.agreed, b: pr.voters.length }) : t("已同意 {a} 人（要全体同意）", { a: pr.agreed });
    return `<li class="vote"><div class="row static"><span class="row-main"><b>${esc(title)}</b><small>${esc(prog)}${p.approve && target?.contact ? " · " + esc(t("联系方式：{c}", { c: target.contact })) : ""}${pr.mine ? " · " + esc(pr.mine.approve ? t("你已同意") : t("你已拒绝")) : ""}</small></span>
      <span class="row-side">${canVote ? `<button class="btn sm primary" data-act="vote-yes" data-r="${esc(r.id)}">${esc(t("同意"))}</button><button class="btn sm ghost-danger" data-act="vote-no" data-r="${esc(r.id)}">${esc(t("拒绝"))}</button>` : ""}${mineReq ? `<button class="btn sm" data-act="request-cancel" data-r="${esc(r.id)}">${esc(t("撤回"))}</button>` : ""}</span></div>
      ${canVote && r.kind === "partner" ? `<details class="hint"><summary>${esc(t("合伙人的权益和责任（表决前请确认）"))}</summary>${rightsHTML()}</details>` : ""}</li>`;
  };
  const mineOrVote = open.filter(r => progress(team, r).voters.includes(me) || r.requested_by === me || r.target_user === me);
  return { title: t("成员与邀请"),
    body: `${p.approve ? `<div class="card"><p class="meta">${esc(t("邀请码"))}</p><p class="code">${esc(invite?.code || "—")}</p>
        <p class="hint">${esc(inviteLine(invite))}</p>
        <div class="actions"><button class="btn sm" data-act="invite-copy" data-code="${esc(invite?.code || "")}">${esc(t("复制"))}</button><button class="btn sm" data-act="invite-link" data-code="${esc(invite?.code || "")}">${esc(t("复制邀请链接"))}</button>
          ${p.manage ? `<button class="btn sm" data-act="invite-reset">${esc(t("重新生成（7 天）"))}</button>${invite?.closed ? "" : `<button class="btn sm ghost-danger" data-act="invite-close">${esc(t("关闭邀请"))}</button>`}` : ""}</div>
        <p class="hint">${esc(t("凭邀请码加入的人要先经过批准；批准后是「只读」。要录入由创建者设为录入员；要当合伙人，本人申请并经创建者和全体合伙人同意。"))}</p></div>` : ""}
      ${S.role === "viewer" || S.role === "staff" ? `<div class="card"><h3>${esc(t("成为合伙人"))}</h3>${myPartnerReq ? `<p class="hint">${esc(t("你的申请已提交，等待创建者和全体合伙人同意。"))}</p>` : `<p class="hint">${esc(t("合伙人能批准新成员、参与表决。申请需要创建者和所有合伙人全部同意。"))}${anon ? " " + esc(t("免邮箱账号要先留下邮箱或电话。")) : ""}</p><button class="btn primary" data-act="partner-apply">${esc(t("申请成为合伙人"))}</button>`}</div>` : ""}
      ${team.pending.length && p.approve ? `<h3 class="grp">${esc(t("等你批准（{n}）", { n: team.pending.length }))}</h3><p class="hint">${esc(t("认识这个人再批准：批准后他能看到账本里的全部数据（只读）。不认识就拒绝，并重新生成邀请码。"))}</p>
        <ul class="list">${team.pending.map(m => `<li><div class="row static"><span class="row-main"><b>${esc(m.name || "?")}</b><small>${esc(t("申请时间"))} ${esc(String(m.created_at || "").slice(0, 10))}${m.contact ? " · " + esc(t("联系方式：{c}", { c: m.contact })) : ""}</small></span>
          <span class="row-side"><button class="btn sm primary" data-act="member-approve" data-u="${esc(m.user_id)}">${esc(t("批准"))}</button><button class="btn sm ghost-danger" data-act="member-reject" data-u="${esc(m.user_id)}">${esc(t("拒绝"))}</button></span></div></li>`).join("")}</ul>` : ""}
      ${mineOrVote.length ? `<h3 class="grp">${esc(t("待表决"))}</h3><ul class="list">${mineOrVote.map(vote).join("")}</ul>` : ""}
      <h3 class="grp">${esc(t("成员"))}</h3>
      <ul class="list">${active.map(m => `<li><div class="row static"><span class="row-main"><b>${esc(m.name || "?")}${m.user_id === me ? " " + esc(t("（我）")) : ""}</b>${m.contact && p.approve ? `<small>${esc(m.contact)}</small>` : ""}</span><span class="row-side">${roleBox(m)}</span></div></li>`).join("")}</ul>
      ${p.manage ? `<p class="hint">${esc(t("创建者能改角色（只读 / 录入员 / 创建者）。合伙人只能由本人申请、全体同意；移出成员也要全体同意，不能一个人决定。"))}</p>` : ""}` };
}
function partnerForm(){
  const me = S.user?.id, anon = !!S.user?.is_anonymous, mine = (S.team?.members || []).find(m => m.user_id === me);
  return { title: t("申请成为合伙人"),
    body: `<form id="f" data-form="partner"><p class="lead">${esc(t("合伙人的权益和责任"))}</p>${rightsHTML()}
      ${anon ? fld("联系方式（邮箱或电话，必填）", text("contact", mine?.contact || "", { max: 80, req: true }), t("免邮箱账号申请合伙人必须留下联系方式；只有创建者和合伙人看得到。")) : fld("联系方式（邮箱或电话，可选）", text("contact", mine?.contact || "", { max: 80 }))}
      <label class="chk"><input type="checkbox" name="ack"> ${esc(t("我已知晓以上权益和责任，并同意由创建者和全体合伙人表决"))}</label>
      <p class="hint ai-out" data-authmsg role="status"></p></form>`,
    foot: `<button class="btn" data-act="back">${esc(t("取消"))}</button><button class="btn primary" form="f">${esc(t("提交申请"))}</button>` };
}
ACT["partner-apply"] = () => show(partnerForm);
FORMS.partner = async (d, f) => {
  const say = m => { f.querySelector("[data-authmsg]").textContent = m; };
  if (!d.ack) { say(t("请先勾选「我已知晓以上权益和责任」")); return; }
  const anon = !!S.user?.is_anonymous;
  if (anon && !validContact(d.contact)) { say(t("请填有效的邮箱或电话（电话 7–15 位数字）")); return; }
  if (d.contact) { if (!validContact(d.contact)) { say(t("联系方式格式不对：填邮箱或电话")); return; } const r0 = await cloud.setContact(d.contact); if (r0.error) { say(authMessage(r0.error)); return; } }
  const res = await cloud.requestPartner();
  if (res.error) { say(partnerError(res.error)); return; }
  await cloud.refreshTeam(); closeAll(); toast(res.data?.status === "done" ? t("你已成为合伙人") : t("申请已提交，等待创建者和全体合伙人同意"));
};
ACT["vote-yes"] = async el => afterAction(await cloud.voteRequest(el.dataset.r, true));
ACT["vote-no"] = el => ask(t("拒绝这个申请？"), t("只要有一人拒绝，申请就被否决。"), async () => { await afterAction(await cloud.voteRequest(el.dataset.r, false)); }, "拒绝");
ACT["request-cancel"] = async el => afterAction(await cloud.cancelRequest(el.dataset.r));
ACT["invite-copy"] = async el => { try { await navigator.clipboard.writeText(el.dataset.code); toast(t("邀请码已复制")); } catch (e) { toast(el.dataset.code); } };
ACT["invite-link"] = async el => { const url = `${location.origin}${location.pathname}?invite=${encodeURIComponent(el.dataset.code)}`; try { await navigator.clipboard.writeText(url); toast(t("邀请链接已复制：对方打开后登录，会自动申请加入")); } catch (e) { toast(url); } };
ACT["invite-reset"] = () => ask(t("重新生成邀请码？"), t("旧邀请码立即失效，新的 7 天有效；已加入的成员不受影响。"), async () => { await cloud.resetInvite(7); await afterAction({}); }, "重新生成");
ACT["invite-close"] = () => ask(t("关闭邀请？"), t("现在起邀请码失效，新的申请进不来（已申请的不受影响）。要再邀请人，点「重新生成」。"), async () => { await afterAction(await cloud.closeInvite()); }, "关闭");
ACT["member-approve"] = async el => afterAction(await cloud.approveMember(el.dataset.u));
ACT["member-reject"] = el => ask(t("拒绝这个申请？"), t("他会看到申请被拒绝，不会进入账本。"), async () => { await afterAction(await cloud.rejectMember(el.dataset.u)); }, "拒绝");
CHG["member-role"] = async el => {
  const go = async () => { const res = await cloud.setMember(el.dataset.u, el.value); if (res.error) toast(authMessage(res.error)); else toast(t("已更新")); await afterAction({}); };
  if (el.value === "owner") ask(t("设为创建者？"), t("创建者拥有全部权限：管理成员、改角色。只给你完全信任的人。"), go, "设为创建者");
  else await go();
};
ACT["member-rm"] = el => ask(t("申请移出这位成员？"), t("需要创建者和全体合伙人（他本人除外）一致同意才会移出；你的这一票自动算同意，只有你一人有表决权时立即生效。"), async () => { const res = await cloud.requestRemove(el.dataset.u); toast(res.data?.status === "done" ? t("已移出") : res.error ? authMessage(res.error) : t("已发起移出申请，等待其他人同意")); await afterAction({}); }, "发起申请");

/* ---------- 设置 ---------- */
function settingsPage(){
  const st = S.settings, towns = sortBy(live("town"), x => x.name), seasons = st.seasons;
  return { title: t("设置"), body: `<form id="f" data-form="settings">
    ${fld("店名（印在单据上）", text("name", st.name))}
    <fieldset class="box"><legend>${esc(t("语言、币种、单位"))}</legend>
      ${fld("界面语言", select("lang", LOCALES.map(([k, l]) => [k, l]), locale(), { blank: false }))}
      <div class="grid2">${fld("显示币种", select("currency", [["", t("跟随语言（简繁 ¥ / English $）")], ["CNY", "¥ CNY"], ["USD", "$ USD"]], st.currency || "", { blank: false }))}${fld("汇率：1 元人民币 = ？美元", num("fx", st.fx, { min: 0 }))}</div>
      ${fld("显示单位", select("unit", Object.entries(UNITS).map(([k, u]) => [k, u.zh + " / " + u.en]), st.unit, { blank: false }))}
      <small>${esc(t("录入时仍按 ¥ 和斤填，显示、报表、导出、打印按这里换算。汇率请自己定期更新。"))}</small></fieldset>
    <fieldset class="box"><legend>${esc(t("季节名称"))}</legend>${seasons.map(s => `<div class="srow"><input name="season_${esc(s.id)}" value="${esc(t(s.name))}" maxlength="12" aria-label="${esc(t("季节名称"))}"></div>`).join("")}
      <div class="srow"><input name="newSeason" maxlength="12" placeholder="${esc(t("新增一个季节，例如 中稻"))}"></div><small>${esc(t("可以改名或新增；已有记录不受影响。"))}</small></fieldset>
    <fieldset class="box"><legend>${esc(t("送货参数（用于路线估算）"))}</legend><div class="grid3">${fld("车费（¥/公里）", num("perKm", st.perKm, { min: 0 }))}${fld("换村里程（公里）", num("villageHopKm", st.villageHopKm, { min: 0 }))}${fld("每趟人工（¥）", num("laborPerTrip", st.laborPerTrip, { min: 0 }))}</div></fieldset>
    <label class="chk"><input type="checkbox" name="maskPhone" ${st.maskPhone ? "checked" : ""}> ${esc(t("列表里遮挡手机号（中间 4 位）"))}</label>
    <h3 class="grp">${esc(t("镇与距离"))}</h3><p class="hint">${esc(t("填每个镇离门店多少公里、在哪个方向，路线规划用它来估算。"))}</p>
    <ul class="list tight">${towns.map(x => `<li><button type="button" class="row" data-act="town-edit" data-id="${x.id}"><span class="row-main"><b>${esc(x.name)}</b></span><span class="row-side"><small>${esc(x.distKm)} km · ${esc(x.dir ? t(x.dir) : "—")}</small></span></button></li>`).join("")}</ul>
    <button type="button" class="btn sm" data-act="town-new">${esc(t("＋ 添加镇"))}</button>
    <p class="hint center">${esc(t("稻种账本"))} · ${esc(t("版本"))} v${esc(APP_VERSION)}</p></form>`,
    foot: `<button class="btn" data-act="back">${esc(t("取消"))}</button><button class="btn primary" form="f">${esc(t("保存"))}</button>` };
}
ACT["open-settings"] = () => show(settingsPage);
FORMS.settings = async d => {
  const seasons = S.settings.seasons.map(s => { const v = (d["season_" + s.id] || "").trim(); const orig = t(s.name); return { id: s.id, name: v && v !== orig ? v : s.name }; });
  if (d.newSeason) seasons.push({ id: newId(), name: d.newSeason });
  await saveSettings({ name: d.name, currency: d.currency, fx: d.fx > 0 ? d.fx : 0.14, unit: d.unit, seasons, perKm: d.perKm ?? 1.2, villageHopKm: d.villageHopKm ?? 2, laborPerTrip: d.laborPerTrip ?? 0, maskPhone: !!d.maskPhone });
  if (d.lang !== locale()) setLocale(d.lang);
  back(); notify();
};
const townForm = x => ({ title: t(x ? "修改镇" : "添加镇"), body: `<form id="f" data-form="town" data-id="${x?.id || ""}">${fld("镇名", text("name", x?.name, { req: true }))}${fld("离门店（公里）", num("distKm", x?.distKm, { req: true, min: 0 }))}${fld("方向", select("dir", DIRS.map(d => [d, t(d)]), x?.dir))}</form>`,
  foot: `${x ? btn("删除", "del", { cls: "danger", data: { kind: "town", id: x.id } }) : ""}<button class="btn" data-act="back">${esc(t("取消"))}</button><button class="btn primary" form="f">${esc(t("保存"))}</button>` });
ACT["town-new"] = () => show(() => townForm());
ACT["town-edit"] = el => show(() => townForm(byId("town", el.dataset.id)));
FORMS.town = async (d, f) => { const old = f.dataset.id ? byId("town", f.dataset.id) : null; await save("town", { ...(old || {}), id: old?.id, name: d.name, distKm: d.distKm, dir: d.dir }); back(); };

/* ---------- AI 设置（自带 key，只存本机浏览器；和家庭学堂、牧羊人同一套） ---------- */
const aiHelp = p => esc(t(p.hint)) + (p.signup ? ` <a href="${esc(p.signup)}" target="_blank" rel="noopener">${esc(t("申请 key"))}</a>` : "");
function aiForm(){
  const s = aiSettings(), p = providerOf(s.provider);
  const keyBox = `<input name="key" type="password" value="${esc(s.key)}" autocomplete="off" placeholder="${esc(t("粘贴你自己的 key"))}">`;
  return { title: t("AI 助手"),
    body: `<form id="f" data-form="ai" data-input-form="ai">
      <p class="hint">${esc(t("议价建议、客户建议、送货路线需要你自己的 AI key。只存在这台设备的浏览器里，不上传，也不同步给合伙人（各人用各人的）。"))}</p>
      ${fld("服务商", seg("provider", PROVIDERS.map(x => [x.id, t(x.name)]), s.provider))}
      ${fld("API key", keyBox)}
      ${fld("模型（可空，用默认）", text("model", s.model, { ph: p.model }))}
      <div data-custom ${p.id === "custom" ? "" : "hidden"}>${fld("接口地址（只有“自定义”要填）", text("base", s.base, { ph: "https://…/v1", max: 200 }))}</div>
      <p class="hint" data-aihelp>${aiHelp(p)}</p>
      ${s.borrowed ? `<p class="hint">${esc(t("这里用的是你在爱家小助手里填的 key。"))}</p>` : ""}
      <p class="hint">${esc(t("发出去的只有脱敏后的数字摘要（金额、等级、镇村名），不含客户姓名、电话、详细地址。"))}</p>
      <div class="ai-out" data-aitest></div></form>`,
    foot: `<button class="btn" data-act="back">${esc(t("取消"))}</button><button class="btn" data-act="ai-test">${esc(t("测试连接"))}</button><button class="btn primary" form="f">${esc(t("保存"))}</button>` };
}
ACT["open-ai"] = () => show(aiForm);
INP.ai = (el, f) => {   // 换服务商：更新说明、默认模型提示、自定义地址框
  const p = providerOf(f.elements.provider.value);
  f.querySelector("[data-custom]").hidden = p.id !== "custom";
  f.querySelector("[data-aihelp]").innerHTML = aiHelp(p);
  f.elements.model.placeholder = p.model;
};
const aiValues = f => { const d = formData(f); return { provider: d.provider, key: d.key, model: d.model, base: d.base }; };
FORMS.ai = async (d, f) => { saveAiSettings(aiValues(f)); toast(t("已保存")); back(); };
ACT["ai-test"] = async el => {
  const f = el.closest(".sheet-in").querySelector("form"), out = f.querySelector("[data-aitest]");
  saveAiSettings(aiValues(f)); out.textContent = t("测试中…");
  try { await testAi(); out.textContent = t("连接成功 ✓"); } catch (e) { out.textContent = String(e.message || e).slice(0, 200); }
};

/* ---------- 审计日志 ---------- */
const brief = r => !r ? "" : r.name || r.no || (r.amount != null ? String(r.amount) : "") || r.reason || "";
function diffText(before, after){
  if (!before) return ""; const out = [];
  for (const k of Object.keys(after || {})) if (JSON.stringify(before[k]) !== JSON.stringify(after[k]) && typeof after[k] !== "object") out.push(`${k}: ${before[k] ?? "∅"} → ${after[k] ?? "∅"}`);
  return out.slice(0, 4).join("；");
}
ACT["open-audit"] = async () => {
  const members = S.user && (S.cloud === "online") ? (await cloud.listMembers().catch(() => ({ members: [] }))).members : [];
  const who = id => members.find(m => m.user_id === id)?.name || (id ? t("合伙人") : t("本机"));
  const rows = S.cloud === "online" ? (await cloud.cloudAudit()).map(r => ({ at: r.at, kind: r.kind, action: r.action, who: who(r.by_user), before: r.before, after: r.after })) : (await cloud.localAudit()).map(r => ({ at: r.at, kind: r.kind, action: r.action, who: t("本机"), before: r.before, after: r.after }));
  show(() => ({ title: t("审计日志"), body: `<p class="hint">${esc(S.cloud === "online" ? t("来自云端，由数据库自动记录，不能被修改或删除。") : t("本机记录；联网登录后以云端日志为准。"))}</p>${rows.length ? `<ul class="list tight audit">${rows.slice(0, 300).map(r => `<li><div class="row static"><span class="row-main"><b>${esc(t(ACTION_LAB[r.action] || r.action))} · ${esc(t(KIND_LAB[r.kind] || r.kind))} ${esc(brief(r.after))}</b><small>${esc(diffText(r.before, r.after))}</small></span><span class="row-side"><small>${esc(new Date(r.at).toLocaleString())}</small><small>${esc(r.who)}</small></span></div></li>`).join("")}</ul>` : empty("还没有记录。")}` }));
};
ACT["open-conflicts"] = async () => {
  const list = await cloud.conflictsList();
  show(() => ({ title: t("同步冲突"), body: list.length ? `<ul class="list tight">${list.map(c => `<li><div class="row static"><span class="row-main"><b>${esc(t(KIND_LAB[c.kind] || c.kind))} ${esc(brief(c.mine))}</b><small>${esc(t("你的版本："))}${esc(JSON.stringify(c.mine).slice(0, 160))}</small></span><span class="row-side"><small>${esc(new Date(c.at).toLocaleString())}</small></span></div></li>`).join("")}</ul>` : empty("没有冲突。") }));
};

/* ---------- 备份与恢复 ---------- */
ACT["open-backup"] = () => show(() => ({ title: t("备份与恢复"), body: `<p class="lead">${esc(t("导出的文件包含客户个人信息和账务，请妥善保管，不要发到公开的地方。"))}</p>
  <div class="actions">${btn("导出全部数据", "backup-export", { cls: "primary" })}${ro() ? "" : `<label class="btn">${esc(t("导入备份"))}<input type="file" accept="application/json,.json" data-file="import" hidden></label>`}</div><p class="hint">${esc(t("导入只会新增或覆盖同 ID 的记录，不会删除现有数据；每一条都会留痕。"))}</p>` }));
ACT["backup-export"] = async () => {
  const rows = (await db.getAll("records", S.org)).map(r => ({ kind: r.kind, id: r.id, data: r.data, deleted: r.deleted }));
  downloadText(`seed-ledger-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: "seed-ledger", version: 1, at: new Date().toISOString(), records: rows }));
};
async function importFile(file){
  if (!file || file.size > 20e6) { toast(t("文件不对或太大")); return; }
  try {
    const j = JSON.parse(await file.text()); if (j.app !== "seed-ledger" || !Array.isArray(j.records)) throw new Error("bad");
    const ok = new Set([...KINDS, "setting"]); let n = 0;
    for (const r of j.records) { if (!ok.has(r.kind) || typeof r.id !== "string" || typeof r.data !== "object" || r.deleted) continue; await save(r.kind, { ...r.data, id: r.id }); n++; }
    toast(t("已导入 {n} 条", { n }));
  } catch (e) { toast(t("导入失败：不是有效的备份文件")); }
}

export { renderMore, importFile, membersPage };

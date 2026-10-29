/* ============ 更多：账户与成员 · 设置 · 审计日志 · 同步冲突 · 备份 ============ */
import { S, save, saveSettings, remove, live, notify, KINDS, DEFAULT_SEASONS } from "../core/state.js";
import { esc, toast, newId, downloadText } from "../core/util.js";
import { t, LOCALES, locale, setLocale, UNITS, currency } from "../core/i18n.js";
import { CLOUD_CONFIGURED, APP_VERSION } from "../config.js";
import * as cloud from "../core/sync.js";
import { authMessage, signupOutcome } from "../core/auth-msg.js";
import * as db from "../core/db.js";
import { DIRS } from "../logic/route.js";
import { byId, sortBy, ro } from "./common.js";
import { show, back, closeAll, fld, text, num, select, seg, formData, badge, empty, btn, kv, ask } from "./kit.js";
import { PROVIDERS, providerOf, aiSettings, saveAiSettings, aiReady, testAi } from "../core/ai.js";
import { ACT, FORMS, CHG, INP } from "./actions.js";

const ROLE = { owner: "创建者", partner: "合伙人（可录入）", viewer: "只读" };
const KIND_LAB = { sale: "销售单", pay: "收款", adj: "讨账调整", purchase: "进货", sreturn: "退货", spay: "打款入池", sfee: "手续费", customer: "客户", brand: "品种", price: "价格", supplier: "种子公司", trip: "送货", town: "镇", setting: "设置" };
const ACTION_LAB = { create: "新增", update: "修改", delete: "删除", restore: "恢复" };

function renderMore(){
  const mem = S.cloud === "online" || S.cloud === "offline";
  return `<div class="page-head"><h1>${esc(t("更多"))}</h1></div>
    <section class="card"><h3>${esc(t("账户与同步"))}</h3>${accountBlock()}</section>
    <ul class="list menu">
      <li><button class="row" data-act="open-settings"><span class="row-main"><b>${esc(t("设置"))}</b><small>${esc(t("语言、币种、单位、季节名称、送货参数、镇与距离"))}</small></span><span>›</span></button></li>
      <li><button class="row" data-act="open-ai"><span class="row-main"><b>${esc(t("AI 助手"))}</b><small>${esc(aiReady() ? t("已设置：") + t(providerOf(aiSettings().provider).name) : t("还没设置（可选）：议价、客户建议、送货路线"))}</small></span><span>›</span></button></li>
      <li><button class="row" data-act="open-audit"><span class="row-main"><b>${esc(t("审计日志"))}</b><small>${esc(t("谁在什么时候新增、修改、删除了什么"))}</small></span><span>›</span></button></li>
      ${mem && S.role === "owner" ? `<li><button class="row" data-act="open-members"><span class="row-main"><b>${esc(t("成员与邀请"))}</b><small>${esc(t("合伙人加入、批准、改权限"))}</small></span><span>›</span></button></li>` : ""}
      <li><button class="row" data-act="open-conflicts"><span class="row-main"><b>${esc(t("同步冲突"))}</b><small>${esc(t("两个人同时改了同一条记录时，被放弃的那份留在这里"))}</small></span><span>›</span></button></li>
      <li><button class="row" data-act="open-backup"><span class="row-main"><b>${esc(t("备份与恢复"))}</b><small>${esc(t("导出 / 导入全部数据（JSON）"))}</small></span><span>›</span></button></li></ul>
    <p class="hint center">${esc(t("稻种账本"))} ${esc(APP_VERSION)} · ${esc(t("只提供交易记录和风险提示，不构成法律意见。"))}</p>`;
}

/* ---------- 账户 ---------- */
const CLOUD_LAB = { local: "本机模式（数据只在这台设备）", signedout: "未登录", noorg: "已登录，还没有经销商账本", pending: "等待创建者批准加入", online: "已同步", offline: "离线（恢复网络后自动同步）" };
function accountBlock(){
  const c = S.cloud, st = [`<p>${badge(t(CLOUD_LAB[c]), c === "online" ? "good" : c === "offline" || c === "pending" ? "warn" : "")}${S.syncing ? " " + esc(t("同步中…")) : ""}</p>`];
  if (S.user) st.push(`<p class="meta">${esc(S.user.email || "")}${S.orgName ? " · " + esc(S.orgName) : ""} · ${esc(t(ROLE[S.role] || ""))}</p>`);
  if (S.pendingOps) st.push(`<p class="hint warn">${esc(t("{n} 条记录等待上传（已安全存在本机）", { n: S.pendingOps }))}</p>`);
  if (S.lastSync) st.push(`<p class="meta">${esc(t("上次同步"))} ${esc(S.lastSync.toLocaleTimeString())}</p>`);
  if (!CLOUD_CONFIGURED) st.push(`<p class="hint">${esc(t("云端还没配置：现在是本机模式，功能完整但不同步。配置步骤见 README。"))}</p>`);
  const acts = [];
  if (CLOUD_CONFIGURED && !S.user) acts.push(btn("登录 / 注册", "open-login", { cls: "primary" }));
  if (S.user && c === "noorg") acts.push(btn("创建经销商账本", "open-createorg", { cls: "primary" }), btn("用邀请码加入", "open-joinorg"));
  if (S.user && (c === "online" || c === "offline")) acts.push(btn("立即同步", "sync-now"));
  if (S.user) acts.push(btn("退出登录", "sign-out"));
  return st.join("") + (acts.length ? `<div class="actions">${acts.join("")}</div>` : "");
}
ACT["open-login"] = () => show(() => ({ title: t("登录 / 注册"), body: `<form id="f" data-form="login">${fld("邮箱", text("email", "", { type: "email", req: true, max: 120 }))}${fld("密码", `<input name="password" type="password" minlength="8" required autocomplete="current-password">`, t("至少 8 位"))}
  <p class="hint">${esc(t("合伙人各用自己的账号；注册后凭邀请码加入同一个账本。小月亮等姊妹应用的账号可以直接登录，不用重新注册。"))}</p>
  <p class="hint ai-out" data-authmsg role="status"></p></form>`,
  foot: `<button class="btn primary" form="f">${esc(t("登录"))}</button><button class="btn" data-act="signup">${esc(t("注册"))}</button><button class="btn" data-act="resend-confirm">${esc(t("重发确认邮件"))}</button>` }));
const authForm = el => el.closest(".sheet-in").querySelector("form");
const authSay = (f, msg) => { f.querySelector("[data-authmsg]").textContent = msg; };   // 消息留在弹层里，不会 3 秒就消失
FORMS.login = async (d, f) => {
  const { error } = await cloud.signIn(d.email, d.password);
  if (error) authSay(f, t("登录失败：") + authMessage(error)); else closeAll();
};
ACT.signup = async el => {
  const f = authForm(el), d = formData(f);
  if (!d.email || !d.password || d.password.length < 8) { authSay(f, t("请填邮箱和至少 8 位的密码")); return; }
  authSay(f, t("提交中…"));
  const { data, error } = await cloud.signUp(d.email, d.password);
  const out = signupOutcome(data, error, d.email);
  authSay(f, out.message);
  if (out.kind === "signed-in") closeAll();
};
ACT["resend-confirm"] = async el => {
  const f = authForm(el), d = formData(f);
  if (!d.email) { authSay(f, t("先填邮箱")); return; }
  const { error } = await cloud.resendConfirm(d.email);
  authSay(f, error ? authMessage(error) : t("已重发确认邮件到 {email}，几分钟内没收到请看垃圾邮件箱。", { email: d.email }));
};
ACT["sign-out"] = async () => { await cloud.signOut(); };
ACT["sync-now"] = () => cloud.sync();
const orgForm = (title, name, label, hint, kind) => ({ title: t(title), body: `<form id="f" data-form="${kind}">${fld(label, text(name, "", { req: true }))}${fld("你的名字（合伙人看得到）", text("display", "", { req: true, max: 40 }))}${hint ? `<p class="hint">${esc(t(hint))}</p>` : ""}
  ${kind === "createorg" && live("sale").length + live("purchase").length ? `<label class="chk"><input type="checkbox" name="adopt" checked> ${esc(t("把这台设备上已经录入的数据一起放进新账本"))}</label>` : ""}</form>`, foot: `<button class="btn" data-act="back">${esc(t("取消"))}</button><button class="btn primary" form="f">${esc(t("确定"))}</button>` });
ACT["open-createorg"] = () => show(() => orgForm("创建经销商账本", "name", "店名 / 账本名称", "你将成为创建者，可以邀请合伙人、批准加入、设置权限。", "createorg"));
ACT["open-joinorg"] = () => show(() => orgForm("用邀请码加入", "code", "邀请码", "创建者会在「更多 → 成员与邀请」里看到你的申请并批准，批准前你看不到任何数据。", "joinorg"));
FORMS.createorg = async d => { try { await cloud.createOrg(d.name, d.display, d.adopt); closeAll(); } catch (e) { toast(t("创建失败：") + (e.message || e)); } };
FORMS.joinorg = async d => { try { await cloud.joinOrg(d.code, d.display); closeAll(); toast(t("已申请，等待创建者批准")); } catch (e) { toast(t("邀请码不对，或已申请过")); } };

/* ---------- 成员 ---------- */
ACT["open-members"] = async () => {
  const { members, code } = await cloud.listMembers();
  show(() => ({ title: t("成员与邀请"), body: `<div class="card"><p class="meta">${esc(t("邀请码"))}</p><p class="code">${esc(code)}</p><button class="btn sm" data-act="reset-invite">${esc(t("重置邀请码"))}</button></div>
    <ul class="list">${members.map(m => `<li><div class="row static"><span class="row-main"><b>${esc(m.name || "?")}</b><small>${esc(t(ROLE[m.role]))} · ${esc(m.status === "pending" ? t("待批准") : t("已加入"))}</small></span>
      ${m.user_id === S.user?.id ? "" : `<span class="row-side">${m.status === "pending" ? `<button class="btn sm primary" data-act="member-set" data-u="${m.user_id}" data-role="partner" data-status="active">${esc(t("批准"))}</button>` : `<select data-change="member-role" data-u="${m.user_id}">${["partner", "viewer"].map(r => `<option value="${r}" ${m.role === r ? "selected" : ""}>${esc(t(ROLE[r]))}</option>`).join("")}</select>`}<button class="btn sm ghost-danger" data-act="member-rm" data-u="${m.user_id}">${esc(t("移出"))}</button></span>`}</div></li>`).join("")}</ul>` }));
};
ACT["reset-invite"] = () => ask(t("重置邀请码？"), t("旧邀请码立即失效，已加入的成员不受影响。"), async () => { await cloud.resetInvite(); back(); await ACT["open-members"](); }, "重置");
ACT["member-set"] = async el => { const { error } = await cloud.setMember(el.dataset.u, el.dataset.role, el.dataset.status); if (error) toast(error.message); back(); await ACT["open-members"](); };
CHG["member-role"] = async el => { const { error } = await cloud.setMember(el.dataset.u, el.value, "active"); if (error) toast(error.message); else toast(t("已更新")); };
ACT["member-rm"] = el => ask(t("移出这位成员？"), t("他将看不到任何数据；他录过的记录仍然保留。"), async () => { await cloud.setMember(el.dataset.u, "remove", "active"); back(); await ACT["open-members"](); }, "移出");

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
    <button type="button" class="btn sm" data-act="town-new">${esc(t("＋ 添加镇"))}</button></form>`,
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

export { renderMore, importFile };

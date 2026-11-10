/* 发布日志（更多 → 发布日志；新版本第一次打开起，概览页顶上提示最多 5 次）。每次发布加一条，和版本号同一个 commit（最新在前）。
   写给店主看：一句话简介 + 1–4 条短要点，不写技术词。k：new 新功能 / better 改进 / fix 修复。界面在 js/ui/releases-ui.js（和姊妹应用同一份）。 */
export const RELEASES = [
  { v: "2026-11-09.2", title: { zh: "记账的日期不能选到未来", en: "Ledger dates can no longer be in the future" }, items: [
    { k: "better", zh: "销售、收款、进货、退货、打款、手续费的日期：晚于今天的变灰、不能选", en: "Dates for sales, payments, purchases, returns, deposits and fees: anything after today is greyed out" },
    { k: "better", zh: "送货日期、约定收款日、送货行程不受影响，照样能选未来", en: "Delivery dates, agreed payment dates and delivery trips are unchanged and can still be in the future" }
  ] },
  { v: "2026-11-09.1", title: { zh: "填表时没保存的内容不会再被自动刷新冲掉", en: "Unsaved typing is no longer wiped by automatic refreshes" }, items: [
    { k: "fix", zh: "后台同步、合伙人那边一录入时，正在打的字、光标都保持不动，离开输入框后再刷新", en: "While syncing or when a partner adds records, what you are typing and the cursor stay put; the page refreshes after you leave the box" },
    { k: "fix", zh: "设置里改到一半去「添加镇」再回来，改过的内容还在；登录时点「上一步」，密码不用重填", en: "Settings keeps your unsaved changes after adding a town and coming back; going back a step at sign-in keeps the password" }
  ] },
  { v: "2026-11-08.2", title: { zh: "各页面更清楚、更好点，手机电脑都整齐", en: "Clearer, easier pages on phone and computer" }, items: [
    { k: "better", zh: "概览：四个大按钮（记销售、进货、扫描、报表）；「待处理」可以收起，每条一行，按钮就在旁边", en: "Overview: four big buttons (sale, purchase, scan, reports); “To do” can be folded, one line per item with its button alongside" },
    { k: "better", zh: "各页的筛选和排序统一成一个「筛选」按钮，默认最新的在前；已选的条件一眼看到，点 ✕ 就去掉", en: "Every page now has one “Filter” button for filtering and sorting, newest first by default; chosen filters show as tags you can remove with ✕" },
    { k: "better", zh: "手机上：页面切换改成下拉框，表格变成一张张小卡片不用左右滑，品种名不再折行", en: "On phones: the page switcher is a drop-down, tables become small cards (no sideways scrolling), and variety names stay on one line" },
    { k: "better", zh: "记销售单分成「卖给谁、卖了什么、怎么付钱、送货」几块；按钮大小统一，空白页面会告诉你下一步做什么", en: "The sale form is split into who, what, payment and delivery; buttons are the same size, and empty pages tell you what to do next" }] },
  { v: "2026-11-08.1", title: { zh: "新增「发布日志」，金额默认遮挡", en: "Release notes, and amounts hidden by default" }, items: [
    { k: "new", zh: "更多 → 发布日志：每次更新了什么，可按类型、时间筛选", en: "More → Release notes: what changed in each update, filter by type and time" },
    { k: "new", zh: "所有金额默认遮挡：点一下看 10 秒，顶栏眼睛可切换", en: "All amounts hidden by default: tap to see for 10 seconds; the eye in the top bar switches modes" },
    { k: "fix", zh: "手机上也能看到版本号，点它就打开发布日志", en: "The version number now shows on phones too; tap it to open the release notes" }] },
  { v: "2026-10-31.5", title: { zh: "客户的销售记录最新的在前", en: "Customer sales history shows newest first" }, items: [
    { k: "better", zh: "客户页的销售记录按日期从新到旧排", en: "A customer's sales are listed newest first" }] },
  { v: "2026-10-31.4", title: { zh: "长列表分批显示，打开更快", en: "Long lists load in batches and open faster" }, items: [
    { k: "better", zh: "列表先显示一部分，底下点「继续加载」看更多", en: "Lists show a first batch; tap “Load more” for the rest" },
    { k: "better", zh: "每页显示几条可以在这台设备上设置", en: "Choose how many rows per page on this device" },
    { k: "better", zh: "数据没变时同步更快，不重复刷新", en: "Syncing is quicker when nothing has changed" }] },
  { v: "2026-10-31.3", title: { zh: "审计日志的筛选更好用", en: "Easier audit log filters" }, items: [
    { k: "better", zh: "筛选条件排成一行，起止日期并排", en: "Filters sit in one row, with start and end dates side by side" },
    { k: "new", zh: "快捷范围：近 7 天、近 30 天、本月", en: "Quick ranges: last 7 days, last 30 days, this month" }] },
  { v: "2026-10-31.2", title: { zh: "按单价议价更清楚", en: "Clearer per-price negotiation" }, items: [
    { k: "better", zh: "每个品种一行：名称、新单价、金额右对齐，最后一行是合计", en: "One row per variety: name, new price, amount right-aligned, with a total row" },
    { k: "better", zh: "手机上自动上下排列，不挤", en: "Stacks neatly on phones" }] },
  { v: "2026-10-31.1", title: { zh: "催账可以按单价议价、打折，销售过程看得更清楚", en: "Chasing: negotiate by price or discount; clearer sale history" }, items: [
    { k: "new", zh: "催账时可以改单价议价，或直接减金额", en: "When chasing, renegotiate the unit price or take an amount off" },
    { k: "new", zh: "每张销售单和每位客户都能看时间线：买、送货、收款、结清", en: "Each sale and customer has a timeline: bought, delivered, paid, settled" },
    { k: "better", zh: "审计日志可以筛选，并分批加载", en: "The audit log can be filtered and loads in batches" },
    { k: "fix", zh: "注册确认链接的提示更准确", en: "Clearer messages for sign-up confirmation links" }] },
  { v: "2026-10-29.6", title: { zh: "「讨账」改名「催账」，可以标记待催账的单", en: "“Chase” sales that are owed" }, items: [
    { k: "new", zh: "销售单可以标记「待催账」：单张、批量或扫描导入时都行", en: "Mark sales “to chase”: one at a time, in bulk, or while importing" },
    { k: "new", zh: "概览页显示待催账的客户和总金额", en: "The overview shows customers to chase and the total owed" }] },
  { v: "2026-10-29.5", title: { zh: "登录一步一步来，概览有待处理提醒", en: "Step-by-step sign-in and to-dos on the overview" }, items: [
    { k: "new", zh: "登录 / 注册改成分步向导，一次只问一件事", en: "Sign-in and sign-up are a step-by-step wizard, one question at a time" },
    { k: "new", zh: "概览顶上「待处理」：送货、催账、成员审批、库存卖超、种子公司补款", en: "“To do” on the overview: deliveries, chasing, member approvals, oversold stock, supplier top-ups" },
    { k: "new", zh: "销售单可以填送货日期和约定收款日", en: "Sales can have a delivery date and a due date" },
    { k: "new", zh: "加合伙人、移出成员要大家都同意", en: "Adding a partner or removing a member needs everyone to agree" }] },
  { v: "2026-10-29.4", title: { zh: "邀请码加入更顺，客户用手机号区分", en: "Smoother invite joins; customers identified by phone" }, items: [
    { k: "fix", zh: "用邀请码加入失败时，提示说清楚原因", en: "Clear reasons when joining with an invite code fails" },
    { k: "better", zh: "客户用手机号区分，同一个号码不会建成两个人", en: "Customers are identified by phone number, so no duplicates" }] },
  { v: "2026-10-29.3", title: { zh: "新增「录入员」，不用邮箱也能加入", en: "New “staff” role; join without an email" }, items: [
    { k: "new", zh: "录入员：能记账，但不能管理成员", en: "Staff can record entries but not manage members" },
    { k: "new", zh: "只凭邀请码和名字就能申请加入，也可以点邀请链接", en: "Join with just an invite code and a name, or with an invite link" }] },
  { v: "2026-10-29.2", title: { zh: "成员和邀请更安全", en: "Safer members and invites" }, items: [
    { k: "new", zh: "加入要创建者或合伙人批准；只有创建者能给别人升权限", en: "Joining needs approval from the owner or a partner; only the owner can promote" },
    { k: "new", zh: "邀请码 7 天有效，过期自动换新", en: "Invite codes last 7 days and renew automatically" }] },
  { v: "2026-10-29.1", title: { zh: "零售价、批发价分开，扫描导入能补建资料", en: "Retail and wholesale prices; import fills in missing records" }, items: [
    { k: "new", zh: "品种可以设零售价和批发价，客户可以设默认价格档", en: "Varieties have retail and wholesale prices; customers can default to one" },
    { k: "new", zh: "扫描导入时，没有的客户、品种、种子公司可以直接补上", en: "While importing, add missing customers, varieties and seed companies on the spot" }] },
  { v: "2026-10-28.2", title: { zh: "可以拍照、导入文件来记销售", en: "Record sales from photos and files" }, items: [
    { k: "new", zh: "拍单据、选照片 / PDF / Excel / CSV 或粘贴文字，读成销售草稿再核对", en: "Photos, PDF, Excel, CSV or pasted text become draft sales for you to check" },
    { k: "new", zh: "页面上显示版本号；更新后自动用上新版本", en: "The version number is shown, and updates apply automatically" }] },
  { v: "2026-10-28.1", title: { zh: "稻种账本上线", en: "Rice Seed Ledger launches" }, items: [
    { k: "new", zh: "进货、退货、库存，品种按年设价格", en: "Purchases, returns and stock, with yearly prices per variety" },
    { k: "new", zh: "销售、收款、赊账和催账；种子公司钱池对账", en: "Sales, payments, credit and chasing; seed company account balance" },
    { k: "new", zh: "报表、打印单据，多人同步、离线也能记", en: "Reports, printable slips, shared sync, and offline entry" },
    { k: "new", zh: "可选 AI 助手：议价、客户建议、送货路线", en: "Optional AI helper: negotiation, customer tips, delivery routes" }] }
];

/* ============ 文件读取器：图片、PDF、Excel、CSV / 文本 → 统一的 { images | text } ============
   Excel / PDF / 图片压缩的读法复用自爱家小助手 js/stats/statement-readers.js 和 js/core/autofill.js：
   PDF.js / SheetJS 只在用到时才从 CDN 加载（固定版本）；文件本身都在浏览器里处理，不上传，
   只有用户点「识别」才会把内容发给自己选的 AI（见 js/ui/scan.js）。
   返回：{ name, kind, images?: [{ mime, b64, url? }], text?: string }。 */
import { t } from "./i18n.js";

const loaded = {};
function loadScript(url){
  return (loaded[url] ||= new Promise((resolve, reject) => {
    const s = document.createElement("script"); s.src = url; s.async = true;
    s.onload = () => resolve(); s.onerror = () => { delete loaded[url]; reject(new Error(t("加载失败：") + url)); };
    document.head.appendChild(s);
  }));
}
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174";
const XLSX_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
const MAX_FILE = 15 * 1024 * 1024;
const IMAGE_EXT = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "heic", "heif"];
const SHEET_EXT = ["xlsx", "xls", "xlsm"];
const TEXT_EXT = ["csv", "tsv", "txt", "md", "json", "log"];

/** 图片 → 最长边 1600 的 JPEG（省流量、省 token） */
async function compressImage(file, max = 1600){
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  const url = c.toDataURL("image/jpeg", 0.82);
  return { mime: "image/jpeg", b64: url.split(",")[1], url };
}

/** 文本文件解码：先按 UTF-8（严格），不对就按 GB18030（中文 Excel 另存的 CSV 常是 GBK）；去掉 BOM */
function decodeText(buf){
  let s;
  try { s = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (e) { s = new TextDecoder("gb18030").decode(buf); }
  return s.replace(/^﻿/, "");
}

async function readXLSX(buf){
  await loadScript(XLSX_URL);
  const wb = window.XLSX.read(buf, { type: "array", cellDates: true });
  const out = [];
  for (const name of wb.SheetNames.slice(0, 5)) {   // 最多读前 5 个工作表
    const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, dateNF: "yyyy-mm-dd", defval: "" })
      .map(r => r.map(x => String(x ?? "").trim())).filter(r => r.some(x => x !== ""));
    if (rows.length) out.push(...(wb.SheetNames.length > 1 ? [["# " + name]] : []), ...rows);
  }
  return out;
}

let pdfReady = null;
async function pdfjs(){
  pdfReady ||= (async () => {
    await loadScript(`${PDFJS}/pdf.min.js`);
    const lib = window.pdfjsLib;
    const src = await (await fetch(`${PDFJS}/pdf.worker.min.js`)).text();   // 跨域 worker 不能直接用：取回来做成同源 blob
    lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    return lib;
  })();
  return pdfReady;
}
/** PDF → 文字行（同一水平位置的拼成一行）；扫描件没有文字层时 lines 为空 */
async function pdfLines(buf){
  const lib = await pdfjs(), doc = await lib.getDocument({ data: buf.slice(0) }).promise, lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent(), rows = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 3) * 3, x = it.transform[4];
      let row = rows.find(r => Math.abs(r.y - y) <= 2); if (!row) rows.push(row = { y, items: [] });
      row.items.push({ x, s: it.str, w: it.width || 0 });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x);
      let line = "", end = null;
      for (const it of r.items) { line += (end != null && it.x - end > 6 ? "  " : "") + it.s; end = it.x + it.w; }
      lines.push(line.replace(/\s+/g, " ").trim());
    }
    lines.push("");
  }
  return { lines, pages: doc.numPages };
}
/** 扫描件 PDF：前几页渲染成图片（给 AI 看） */
async function pdfImages(buf, max = 6, scale = 1.6){
  const lib = await pdfjs(), doc = await lib.getDocument({ data: buf.slice(0) }).promise, out = [];
  for (let p = 1; p <= Math.min(doc.numPages, max); p++) {
    const page = await doc.getPage(p), vp = page.getViewport({ scale }), c = document.createElement("canvas");
    c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    out.push({ mime: "image/jpeg", b64: c.toDataURL("image/jpeg", 0.8).split(",")[1] });
  }
  return out;
}

/** 按文件类型分派。读不了就抛出带原因的错误 */
async function readAnyFile(file){
  const name = file.name || "", ext = (name.split(".").pop() || "").toLowerCase(), type = file.type || "";
  if (file.size > MAX_FILE) throw new Error(t("文件太大（超过 15 MB）"));
  if (type.startsWith("image/") || IMAGE_EXT.includes(ext)) {
    try { return { name, kind: "image", images: [await compressImage(file)] }; }
    catch (e) { throw new Error(t("这张图读不了（手机拍的 HEIC 请换成 JPG / PNG）")); }
  }
  const buf = await file.arrayBuffer();
  if (type === "application/pdf" || ext === "pdf") {
    const { lines } = await pdfLines(buf), text = lines.join("\n").trim();
    return text.length > 40 ? { name, kind: "pdf", text } : { name, kind: "pdf-scan", images: await pdfImages(buf) };
  }
  if (SHEET_EXT.includes(ext)) return { name, kind: "sheet", text: (await readXLSX(buf)).map(r => r.join("\t")).join("\n") };
  if (TEXT_EXT.includes(ext) || type.startsWith("text/")) return { name, kind: "text", text: decodeText(buf) };
  throw new Error(t("不支持这种文件格式（支持：图片、PDF、Excel、CSV / 文本）"));
}

/** 太长的文字按行分段（每段不超过 maxChars），段与段之间不重叠 */
function chunkText(text, maxChars = 7000){
  const chunks = []; let cur = [], n = 0;
  for (const l of String(text).split(/\r?\n/)) { if (n + l.length > maxChars && cur.length) { chunks.push(cur.join("\n")); cur = []; n = 0; } cur.push(l); n += l.length + 1; }
  if (cur.length) chunks.push(cur.join("\n"));
  return chunks;
}

/** 发给 AI 之前抹掉：邮箱、长数字串（身份证 / 银行卡号，15 位以上）。手机号和姓名要保留——单据上本来就写着，识别客户要用 */
function redactSensitive(text){
  return String(text).replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[邮箱]").replace(/\b(?:\d[ -]?){15,19}\b/g, "[号码]").replace(/\b\d{15,}[0-9Xx]?\b/g, "[号码]");
}

const ACCEPT = "image/*,.pdf,.csv,.tsv,.txt,.md,.json,.xlsx,.xls,.xlsm";
export { readAnyFile, decodeText, chunkText, redactSensitive, compressImage, readXLSX, pdfLines, pdfImages, ACCEPT, MAX_FILE };

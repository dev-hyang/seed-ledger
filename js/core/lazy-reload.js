/* 发新版后，打开着的旧页面记着的带哈希文件名（dist/chunks/…）已经不存在（404）。
 * 按需加载失败且在线时，自动整页刷新一次拿新版；1 分钟内刷新过、或离线，就照原样抛出错误（调用处原有的失败处理照旧）。
 * 四个姊妹应用共用同一份（home-pantry 的 core/lazy.js 里是同一套做法），改一处要同步其他几处。 */
export function importFresh(load) {
  return load().catch((e) => {
    try {
      const key = "hmh.lazy.reloaded:" + location.pathname.split("/")[1], last = +sessionStorage.getItem(key) || 0;
      if (navigator.onLine !== false && Date.now() - last > 60000) { sessionStorage.setItem(key, String(Date.now())); location.reload(); return new Promise(() => {}); }
    } catch { /* 隐私模式等拿不到 sessionStorage：不自动刷新 */ }
    throw e;
  });
}

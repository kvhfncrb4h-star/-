const https = require("https");
const http = require("http");

const EWHA_URL =
  "http://www.ewha.ac.kr/ewha/life/restaurant.do?mode=view&articleNo=900&article.offset=0&articleLimit=10";

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.get(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "ko-KR,ko;q=0.9",
          Referer: "http://www.ewha.ac.kr/",
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchUrl(res.headers.location).then(resolve).catch(reject);
        }
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      }
    );
    req.on("error", reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error("timeout")); });
  });
}

function parseMenu(html) {
  const today = new Date();
  const kst = new Date(today.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  const todayStr = `${yyyy}.${mm}.${dd}`;
  const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
  const todayDay = dayNames[kst.getUTCDay()];

  const result = { date: todayStr, day: todayDay, cafeterias: [] };

  const tablePattern = /<table[\s\S]*?<\/table>/gi;
  const tables = html.match(tablePattern) || [];

  for (let tIdx = 0; tIdx < tables.length; tIdx++) {
    const table = tables[tIdx];

    const headerRowMatch = table.match(/<tr[^>]*>([\s\S]*?)<\/tr>/i);
    if (!headerRowMatch) continue;

    const thTexts = [];
    const thPattern = /<th[^>]*>([\s\S]*?)<\/th>/gi;
    let thMatch;
    while ((thMatch = thPattern.exec(headerRowMatch[1])) !== null) {
      thTexts.push(thMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
    }

    if (thTexts.length === 0) continue;

    let todayCol = -1;
    thTexts.forEach((t, i) => {
      if (t.includes(todayDay) || t.includes(dd) || t.includes(todayStr.slice(5))) {
        todayCol = i;
      }
    });

    if (todayCol === -1) continue;

    const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    let rowCount = 0;
    const menuItems = [];

    while ((rowMatch = rowPattern.exec(table)) !== null) {
      if (rowCount === 0) { rowCount++; continue; }

      const tds = [];
      const tdPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let tdMatch;
      while ((tdMatch = tdPattern.exec(rowMatch[1])) !== null) {
        tds.push(tdMatch[1].replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim());
      }

      if (tds.length === 0) { rowCount++; continue; }

      const label = tds[0] || "";
      const menuText = tds[todayCol] || tds[todayCol - 1] || "";

      if (menuText && menuText !== "-") {
        menuItems.push({ label, menu: menuText });
      }
      rowCount++;
    }

    if (menuItems.length > 0) {
      const beforeTable = html.slice(Math.max(0, html.indexOf(table) - 300), html.indexOf(table));
      const headingMatch = beforeTable.match(/<h[2-4][^>]*>([^<]+)<\/h[2-4]>/i);
      const cafeName = headingMatch ? headingMatch[1].trim() : `식당 ${tIdx + 1}`;
      result.cafeterias.push({ name: cafeName, menus: menuItems });
    }
  }

  if (result.cafeterias.length === 0) {
    result.debug = {
      html_length: html.length,
      tables_found: tables.length,
      today_str: todayStr,
      today_day: todayDay,
      first_table_headers: (() => {
        if (tables.length === 0) return null;
        const t = tables[0];
        const ths = [];
        const p = /<th[^>]*>([\s\S]*?)<\/th>/gi;
        let m;
        while ((m = p.exec(t)) !== null) ths.push(m[1].replace(/<[^>]+>/g, "").trim());
        return ths;
      })(),
      date_samples: (html.match(/\d{4}[.]\d{2}[.]\d{2}/g) || []).slice(0, 10),
      keyword_점심: html.indexOf("점심"),
      keyword_저녁: html.indexOf("저녁"),
      html_sample: tables[0] ? tables[0].slice(0, 800) : html.slice(10000, 10800),
    };
    result.error = "파싱 실패";
  }

  return result;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  try {
    const html = await fetchUrl(EWHA_URL);
    const menuData = parseMenu(html);
    res.status(200).json({ success: true, ...menuData, fetched_at: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

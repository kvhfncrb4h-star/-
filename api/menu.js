const https = require("https");
const http = require("http");

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "ko-KR,ko;q=0.9",
        Referer: "http://www.ewha.ac.kr/",
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    });
    req.on("error", reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error("timeout")); });
  });
}

function getMealClass(kstH, kstM) {
  const t = kstH * 60 + kstM;
  if (t < 9 * 60 + 21)  return "breakfast";
  if (t < 13 * 60 + 51) return "lunch";
  if (t < 18 * 60 + 46) return "dinner";
  return "breakfast";
}

function getWeekMonday(date) {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}

function decodeMenuText(raw) {
  // 순서 중요: HTML 태그 먼저 제거 → &lt;&gt; 는 나중에 변환
  return raw
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
    .replace(/<[a-zA-Z][^>]*>/g, "").replace(/<\/[a-zA-Z][^>]*>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .trim();
}

function parseMenu(html, targetDayStr, mealClass) {
  const cafeterias = [];

  // 식당명 추출
  const cafeNames = [...html.matchAll(/<h5[^>]*class="[^"]*b-h5-tit[^"]*"[^>]*>([\s\S]*?)<\/h5>/gi)]
    .map(m => m[1].replace(/<[^>]+>/g, "").replace(/[\n\t\r]/g, " ").replace(/\s+/g, " ").trim());

  // b-menu-wrap 블록으로 식당 분리
  const wrapPattern = /<div[^>]+class="[^"]*b-menu-wrap[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]+class="[^"]*b-menu-wrap|<footer|$)/gi;
  const wraps = [...html.matchAll(wrapPattern)];
  const sources = wraps.length > 0 ? wraps.map(m => m[1]) : [html];

  sources.forEach((src, idx) => {
    // 날짜별 li 찾기
    const dayBlocks = [...src.matchAll(/<li[^>]+class="[^"]*b-menu-day[^"]*"[^>]*>([\s\S]*?)<\/li>/gi)];

    for (const dayMatch of dayBlocks) {
      const dayBlock = dayMatch[1];

      // 날짜 확인
      const dateMatch = dayBlock.match(/\((\d{2}\.\d{2})\)/);
      if (!dateMatch || !targetDayStr.endsWith(dateMatch[1])) continue;

      // 끼니 div 찾기: class에 mealClass(breakfast/lunch/dinner) 포함된 div
      const mealDivPattern = new RegExp(
        `<div[^>]+class="[^"]*${mealClass}[^"]*"[^>]*>([\\s\\S]*?)<\\/div>\\s*\\n?\\s*<\\/div>`,
        "i"
      );
      const mealDiv = dayBlock.match(mealDivPattern);

      let menuText = "";
      if (mealDiv) {
        const preMatch = mealDiv[1].match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
        if (preMatch) menuText = decodeMenuText(preMatch[1]);
      }

      // fallback: pre 태그 직접 찾기
      if (!menuText) {
        const allDivs = [...dayBlock.matchAll(/<div[^>]+class="[^"]*b-menu-[^"]*"[^>]*>([\s\S]*?)<\/pre>/gi)];
        for (const d of allDivs) {
          if (d[0].includes(mealClass)) {
            const preMatch = d[0].match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
            if (preMatch) { menuText = decodeMenuText(preMatch[1]); break; }
          }
        }
      }

      const menuLines = menuText
        ? menuText.split("\n").map(l => l.trim()).filter(l => l.length > 0)
        : [];

      cafeterias.push({
        name: cafeNames[idx] || `식당 ${idx + 1}`,
        menu: menuLines,
      });
      break;
    }
  });

  return cafeterias;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=300");

  try {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const kstH = kst.getUTCHours();
    const kstM = kst.getUTCMinutes();
    const isNextDay = (kstH * 60 + kstM) >= 18 * 60 + 46;
    const targetKst = isNextDay ? new Date(kst.getTime() + 24 * 60 * 60 * 1000) : kst;

    const mm = String(targetKst.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(targetKst.getUTCDate()).padStart(2, "0");
    const dayNames = ["일","월","화","수","목","금","토"];
    const mealClass = getMealClass(kstH, kstM);
    const mealLabel = { breakfast: "조식", lunch: "중식", dinner: "석식" }[mealClass];
    const srDt = getWeekMonday(targetKst);

    const url = `http://www.ewha.ac.kr/ewha/life/restaurant.do?mode=view&articleNo=900&article.offset=0&articleLimit=10&srDt=${srDt}`;
    const html = await fetchUrl(url);
    const cafeterias = parseMenu(html, `${mm}.${dd}`, mealClass);

    res.status(200).json({
      success: true,
      date: `${targetKst.getUTCFullYear()}.${mm}.${dd}(${dayNames[targetKst.getUTCDay()]})${isNextDay ? " 내일" : ""}`,
      meal_type: isNextDay ? "조식(내일)" : mealLabel,
      kst_time: `${String(kstH).padStart(2,"0")}:${String(kstM).padStart(2,"0")}`,
      cafeterias,
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

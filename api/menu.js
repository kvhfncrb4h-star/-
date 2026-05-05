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

// KST 현재시각 기준 끼니 판단
// ~09:20 아침 / 09:21~13:50 점심 / 13:51~18:45 저녁 / 18:46~ 다음날아침
function getMealClass(kstH, kstM) {
  const time = kstH * 60 + kstM;
  if (time < 9 * 60 + 21)  return "breakfast";
  if (time < 13 * 60 + 51) return "lunch";
  if (time < 18 * 60 + 46) return "dinner";
  return "breakfast"; // 18:46~ → 다음날 아침
}

// 이번 주 월요일 날짜 계산 (srDt 파라미터용)
function getWeekMonday(date) {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=일, 1=월
  const diff = day === 0 ? -6 : 1 - day; // 월요일로
  d.setUTCDate(d.getUTCDate() + diff);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}

function parseMenu(html, targetDayStr, mealClass) {
  // HTML 구조:
  // <li class="b-menu-day mon">
  //   <div class="b-day">월 (05.04)</div>
  //   <div class="b-menu b-menu-b breakfast"><pre>메뉴\n...</pre></div>
  //   <div class="b-menu b-menu-l lunch"><pre>메뉴\n...</pre></div>
  //   <div class="b-menu b-menu-d dinner"><pre>메뉴\n...</pre></div>
  // </li>

  const cafeterias = [];

  // 식당별 b-menu-wrap 블록 추출
  const menuWrapPattern = /<div[^>]+class="[^"]*b-menu-wrap[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]+class="[^"]*b-menu-wrap|$)/gi;
  const wrapMatches = [...html.matchAll(menuWrapPattern)];

  // b-menu-wrap이 없으면 전체 html에서 직접 파싱
  const sources = wrapMatches.length > 0
    ? wrapMatches.map(m => m[1])
    : [html];

  // 식당명 추출 (h5.b-h5-tit01)
  const cafeNamePattern = /<h5[^>]*class="[^"]*b-h5-tit[^"]*"[^>]*>([\s\S]*?)<\/h5>/gi;
  const cafeNames = [...html.matchAll(cafeNamePattern)]
    .map(m => m[1].replace(/<[^>]+>/g, "").trim());

  sources.forEach((src, idx) => {
    // 날짜별 li 블록 추출
    const dayPattern = /<li[^>]+class="[^"]*b-menu-day[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
    const dayMatches = [...src.matchAll(dayPattern)];

    for (const dayMatch of dayMatches) {
      const dayBlock = dayMatch[1];

      // 날짜 확인 (MM.DD 형태)
      const dateMatch = dayBlock.match(/\((\d{2}\.\d{2})\)/);
      if (!dateMatch) continue;
      if (!targetDayStr.endsWith(dateMatch[1])) continue;

      // 해당 끼니 블록 추출
      const mealPattern = new RegExp(
        `<div[^>]+class="[^"]*b-menu[^"]*${mealClass}[^"]*"[^>]*>([\\s\\S]*?)<\\/div>\\s*<\\/div>`,
        "i"
      );
      const mealMatch = dayBlock.match(mealPattern);

      let menuText = "";
      if (mealMatch) {
        // pre 태그에서 텍스트 추출
        const preMatch = mealMatch[1].match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
        if (preMatch) {
          menuText = preMatch[1]
            .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
            .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
            .replace(/<[^>]+>/g, "")
            .trim();
        }
      }

      // 그래도 없으면 해당 클래스 div 안의 pre 직접 찾기
      if (!menuText) {
        const altPattern = new RegExp(
          `<div[^>]+class="[^"]*${mealClass}[^"]*"[^>]*>[\\s\\S]*?<pre[^>]*>([\\s\\S]*?)<\\/pre>`,
          "i"
        );
        const altMatch = dayBlock.match(altPattern);
        if (altMatch) {
          menuText = altMatch[1]
            .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
            .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
            .replace(/<[^>]+>/g, "")
            .trim();
        }
      }

      const menuLines = menuText
        ? menuText.split("\n").map(l => l.trim()).filter(l => l)
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
  res.setHeader("Cache-Control", "s-maxage=600");

  try {
    // KST 계산
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const kstH = kst.getUTCHours();
    const kstM = kst.getUTCMinutes();

    const isNextDay = (kstH * 60 + kstM) >= 18 * 60 + 46;
    const targetKst = isNextDay
      ? new Date(kst.getTime() + 24 * 60 * 60 * 1000)
      : kst;

    const mm = String(targetKst.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(targetKst.getUTCDate()).padStart(2, "0");
    const dayNames = ["일","월","화","수","목","금","토"];
    const dayName = dayNames[targetKst.getUTCDay()];
    const targetDayStr = `${mm}.${dd}`; // ex) "05.06"
    const mealClass = getMealClass(kstH, kstM);
    const mealLabel = { breakfast: "조식", lunch: "중식", dinner: "석식" }[mealClass];

    // 이번 주 월요일 기준 srDt
    const srDt = getWeekMonday(targetKst);
    const EWHA_URL = `http://www.ewha.ac.kr/ewha/life/restaurant.do?mode=view&articleNo=900&article.offset=0&articleLimit=10&srDt=${srDt}`;

    const html = await fetchUrl(EWHA_URL);
    const cafeterias = parseMenu(html, targetDayStr, mealClass);

    res.status(200).json({
      success: true,
      date: `${targetKst.getUTCFullYear()}.${mm}.${dd}(${dayName})${isNextDay ? " 내일" : ""}`,
      meal_type: isNextDay ? `조식(내일)` : mealLabel,
      kst_time: `${String(kstH).padStart(2,"0")}:${String(kstM).padStart(2,"0")}`,
      cafeterias,
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

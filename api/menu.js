const https = require("https");
const http = require("http");

const EWHA_URL =
  "http://www.ewha.ac.kr/ewha/life/restaurant.do?mode=view&articleNo=900&article.offset=0&articleLimit=10";

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

// 현재 KST 기준 끼니 판단
// ~09:20 아침 / 09:21~13:50 점심 / 13:51~18:45 저녁 / 18:46~ 다음날아침
function getMealType(kstDate) {
  const h = kstDate.getUTCHours();
  const m = kstDate.getUTCMinutes();
  const time = h * 60 + m;
  if (time < 9 * 60 + 21) return "아침";
  if (time < 13 * 60 + 51) return "점심";
  if (time < 18 * 60 + 46) return "저녁";
  return "아침"; // 18:46 이후 → 다음날 아침 메뉴
}

function parseMenu(html) {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  const todayStr = `${yyyy}.${mm}.${dd}`;
  const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
  const todayDay = dayNames[kst.getUTCDay()];
  const rawMealType = getMealType(kst);
  const isNextDay = (kst.getUTCHours() * 60 + kst.getUTCMinutes()) >= 18 * 60 + 46;
  const targetKst = isNextDay ? new Date(kst.getTime() + 24 * 60 * 60 * 1000) : kst;
  const mealType = rawMealType;

  const tyyyy = targetKst.getUTCFullYear();
  const tmm = String(targetKst.getUTCMonth() + 1).padStart(2, "0");
  const tdd = String(targetKst.getUTCDate()).padStart(2, "0");
  const displayDate = isNextDay ? `${tyyyy}.${tmm}.${tdd} (내일)` : todayStr;

  const result = {
    date: displayDate,
    day: dayNames[targetKst.getUTCDay()],
    meal_type: isNextDay ? "아침(내일)" : mealType,
    cafeterias: [],
  };

  // 식당 탭 블록 추출: div.b-txt-box 또는 div.b-info-wrap 단위
  // HTML 구조: 각 식당마다 h5.b-h5-tit01(식당명) + pre(메뉴텍스트) 반복
  
  // 식당명 + 메뉴 블록 패턴
  const cafeBlocks = [];
  const blockPattern = /<h5[^>]*class="[^"]*b-h5-tit01[^"]*"[^>]*>([\s\S]*?)<\/h5>([\s\S]*?)(?=<h5[^>]*class="[^"]*b-h5-tit01|$)/gi;
  let blockMatch;
  while ((blockMatch = blockPattern.exec(html)) !== null) {
    const name = blockMatch[1].replace(/<[^>]+>/g, "").trim();
    const body = blockMatch[2];
    cafeBlocks.push({ name, body });
  }

  for (const block of cafeBlocks) {
    const { name, body } = block;

    // pre 태그에서 메뉴 텍스트 추출
    const preMatches = [...body.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi)];
    if (preMatches.length === 0) continue;

    // 운영시간 pre (첫 번째) + 메뉴 pre들
    // 운영시간 패턴: 아침: HH:MM-HH:MM\n점심: HH:MM-HH:MM\n저녁: HH:MM-HH:MM
    let operatingHours = null;
    let menuPres = [];

    for (const pre of preMatches) {
      const text = pre[1].replace(/<[^>]+>/g, "").replace(/&[^;]+;/g, " ").trim();
      if (text.includes("아침") && text.includes("점심") && (text.includes("저녁") || text.includes("석식"))) {
        operatingHours = text;
      } else if (text.length > 5) {
        menuPres.push(text);
      }
    }

    // 탭 콘텐츠에서 날짜별 메뉴 찾기
    // 날짜 링크: ?mode=view&articleNo=900...&srDt=YYYY-MM-DD 형태로 주간 탭 존재
    // 현재 날짜의 메뉴만 추출하기 위해 날짜 탭 확인
    
    // 메뉴 텍스트에서 아침/점심/저녁 섹션 분리
    const menus = { 아침: [], 점심: [], 저녁: [] };
    
    for (const menuText of menuPres) {
      const lines = menuText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      
      let currentSection = null;
      for (const line of lines) {
        if (/^(조식|아침)/.test(line)) { currentSection = "아침"; continue; }
        if (/^(중식|점심)/.test(line)) { currentSection = "점심"; continue; }
        if (/^(석식|저녁)/.test(line)) { currentSection = "저녁"; continue; }
        // 날짜 헤더 줄 스킵
        if (/^\d{4}[.\-]\d{2}[.\-]\d{2}/.test(line)) continue;
        if (/^(월|화|수|목|금|토|일)$/.test(line)) continue;
        
        if (currentSection && line.length > 0 && line !== "-") {
          menus[currentSection].push(line);
        } else if (!currentSection && line.length > 0) {
          // 섹션 구분 없으면 점심으로
          menus["점심"].push(line);
        }
      }
    }

    // 아무 메뉴도 없으면 raw 텍스트 전체를 점심으로
    const hasAny = Object.values(menus).some(m => m.length > 0);
    if (!hasAny && menuPres.length > 0) {
      menus["점심"] = menuPres[0].split(/\r?\n/).map(l => l.trim()).filter(l => l && l !== "-");
    }

    result.cafeterias.push({
      name,
      operating_hours: operatingHours,
      current_meal: mealType,
      menus,
      // 현재 끼니 메뉴만 강조
      today_menu: menus[mealType] || [],
    });
  }

  // 파싱 실패 시 디버그
  if (result.cafeterias.length === 0) {
    // pre 태그 전체 추출해서 디버그
    const allPres = [...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi)]
      .map(m => m[1].replace(/<[^>]+>/g, "").trim())
      .filter(t => t.length > 10)
      .slice(0, 5);

    const h5s = [...html.matchAll(/<h5[^>]*>([\s\S]*?)<\/h5>/gi)]
      .map(m => m[1].replace(/<[^>]+>/g, "").trim())
      .slice(0, 10);

    result.debug = {
      html_length: html.length,
      h5_tags: h5s,
      pre_samples: allPres,
      around_아침: html.slice(Math.max(0, html.indexOf("아침") - 100), html.indexOf("아침") + 300),
    };
    result.error = "파싱 실패";
  }

  return result;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=600"); // 10분 캐시

  try {
    const html = await fetchUrl(EWHA_URL);
    const menuData = parseMenu(html);
    res.status(200).json({ success: true, ...menuData, fetched_at: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

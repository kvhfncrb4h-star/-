// Vercel Serverless Function: /api/menu.js
// 이화여대 식단 크롤러 프록시
// 배포: vercel.com 에 무료로 배포 가능

const https = require("https");
const http = require("http");

// 날짜별 articleNo 매핑은 필요 없음 — 이 URL은 주간 식단을 모두 포함
const EWHA_URL =
  "http://www.ewha.ac.kr/ewha/life/restaurant.do?mode=view&articleNo=900&article.offset=0&articleLimit=10";

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "ko-KR,ko;q=0.9",
          Referer: "http://www.ewha.ac.kr/",
        },
      },
      (res) => {
        // 리다이렉트 처리
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          return fetchUrl(res.headers.location).then(resolve).catch(reject);
        }

        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      }
    );
    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
  });
}

function parseMenu(html) {
  // 오늘 날짜
  const today = new Date();
  const todayStr = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, "0")}.${String(today.getDate()).padStart(2, "0")}`;

  const result = {
    date: todayStr,
    cafeterias: [],
    raw_length: html.length,
  };

  // 식당 섹션 파싱 (탭별로 구분)
  // 이화여대 식단 페이지 HTML 구조 기반
  const cafeteriaPatterns = [
    { name: "학생문화관 식당", id: "tab1" },
    { name: "ECC 식당", id: "tab2" },
    { name: "E-House 식당", id: "tab3" },
    { name: "교직원 식당", id: "tab4" },
    { name: "생활관 식당", id: "tab5" },
  ];

  // 테이블에서 날짜 열과 메뉴 파싱
  // 이화 식단 페이지: <table> 안에 날짜(th)와 메뉴(td)가 있음
  const tableRegex = /<table[\s\S]*?<\/table>/gi;
  const tables = html.match(tableRegex) || [];

  const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
  const todayDay = dayNames[today.getDay()];

  tables.forEach((table, idx) => {
    // th 헤더에서 날짜 열 인덱스 찾기
    const headerMatch = table.match(/<tr[^>]*>([\s\S]*?)<\/tr>/i);
    if (!headerMatch) return;

    const headers = [];
    const thMatches = headerMatch[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi);
    let colIdx = 0;
    let todayColIdx = -1;

    for (const th of thMatches) {
      const text = th[1].replace(/<[^>]+>/g, "").trim();
      headers.push(text);
      if (text.includes(todayDay) || text.includes(todayStr.slice(5))) {
        todayColIdx = colIdx;
      }
      colIdx++;
    }

    if (todayColIdx === -1) return;

    // tbody rows에서 오늘 컬럼 추출
    const rows = table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
    const menuItems = [];

    for (const row of rows) {
      const tds = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
      if (tds.length === 0) continue;

      // 첫 번째 td가 구분(아침/점심/저녁)인 경우
      const label = tds[0]
        ? tds[0][1].replace(/<[^>]+>/g, "").trim()
        : "";
      const targetTd = tds[todayColIdx] || tds[todayColIdx - 1];
      if (!targetTd) continue;

      const menuText = targetTd[1]
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .trim();

      if (menuText && menuText !== "-" && menuText !== "") {
        menuItems.push({ label, menu: menuText });
      }
    }

    if (menuItems.length > 0) {
      result.cafeterias.push({
        name: cafeteriaPatterns[idx]?.name || `식당 ${idx + 1}`,
        menus: menuItems,
      });
    }
  });

  // 파싱 실패 시 대체 텍스트 검색
  if (result.cafeterias.length === 0) {
    // 날짜 기반 섹션 텍스트 검색
    const dateSection = html.match(
      new RegExp(todayStr.replace(/\./g, "\\.") + "[\\s\\S]{0,2000}")
    );
    if (dateSection) {
      const text = dateSection[0]
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500);
      result.cafeterias.push({
        name: "식단 정보",
        menus: [{ label: "오늘의 식단", menu: text }],
      });
    } else {
      result.error =
        "오늘의 식단을 파싱하지 못했습니다. 학교 사이트 구조가 변경되었을 수 있습니다.";
    }
  }

  return result;
}

module.exports = async (req, res) => {
  // CORS 허용 (Scriptable 앱에서 호출하기 위해)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=1800"); // 30분 캐시

  try {
    const html = await fetchUrl(EWHA_URL);
    const menuData = parseMenu(html);

    res.status(200).json({
      success: true,
      ...menuData,
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
      date: new Date().toLocaleDateString("ko-KR"),
    });
  }
};

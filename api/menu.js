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

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  try {
    const html = await fetchUrl(EWHA_URL);

    // pre 태그 전부 추출 (메뉴 구조 파악용)
    const pres = [...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi)]
      .map(m => m[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim())
      .filter(t => t.length > 10);

    // h5 태그 추출 (식당명)
    const h5s = [...html.matchAll(/<h5[^>]*>([\s\S]*?)<\/h5>/gi)]
      .map(m => m[1].replace(/<[^>]+>/g, "").trim());

    // 이용안내 pre 찾기 (시간 정보)
    const operatingPres = pres.filter(t => t.includes("아침") && t.includes("점심"));
    
    // 나머지 pre (실제 메뉴)
    const menuPres = pres.filter(t => !(t.includes("아침") && t.includes("점심") && t.length < 200));

    res.status(200).json({
      success: true,
      total_pres: pres.length,
      h5_tags: h5s,
      operating_pres: operatingPres,
      // 첫 3개 메뉴 pre 원문 (줄바꿈 보존)
      menu_pre_samples: menuPres.slice(0, 3),
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

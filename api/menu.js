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

    // 점심 키워드 주변 2000자 추출해서 구조 파악
    const idx점심 = html.indexOf("점심");
    const idx저녁 = html.indexOf("저녁");
    const idx아침 = html.indexOf("아침");

    res.status(200).json({
      success: true,
      html_length: html.length,
      // 점심 앞뒤 2000자 (HTML 구조 파악용)
      around_점심: html.slice(Math.max(0, idx점심 - 500), idx점심 + 1500),
      around_아침: html.slice(Math.max(0, idx아침 - 200), idx아침 + 500),
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

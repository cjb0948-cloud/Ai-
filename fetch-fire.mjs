// 소방청_화재정보서비스(getOcByfrstFireSmrzPcnd)를 호출해 data/fire-daily.json 으로 저장합니다.
// 인증키는 GitHub Secrets(DATA_GO_KR_KEY)로만 전달되며 파일에 기록되지 않습니다.
import fs from "node:fs";

const RAW_KEY = process.env.DATA_GO_KR_KEY;
if (!RAW_KEY) { console.error("DATA_GO_KR_KEY 가 설정되지 않았습니다."); process.exit(1); }
const KEY = RAW_KEY.includes("%") ? decodeURIComponent(RAW_KEY) : RAW_KEY;

const BASE = "https://apis.data.go.kr/1661000/FireInformationService/getOcByfrstFireSmrzPcnd";
const OUT = "data/fire-daily.json";
const FETCH_DAYS = 7;   // 매 실행마다 새로 받아오는 최근 일수(오늘 포함)
const KEEP_DAYS = 60;   // 파일에 보관하는 최대 일수

function ymdKST(offset) {
  const d = new Date(Date.now() + 9 * 3600 * 1000 - offset * 86400 * 1000);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function pickItems(j) {
  const body = (j && j.response && j.response.body) || (j && j.body) || {};
  let items = body.items;
  if (items && !Array.isArray(items) && items.item !== undefined) items = items.item;
  if (!items) return { rows: [], total: Number(body.totalCount || 0) };
  if (!Array.isArray(items)) items = [items];
  return { rows: items, total: Number(body.totalCount || items.length) };
}

async function fetchDay(ymd) {
  const rows = [];
  for (let page = 1; page <= 50; page++) {
    const u = new URL(BASE);
    u.searchParams.set("ServiceKey", KEY);
    u.searchParams.set("pageNo", String(page));
    u.searchParams.set("numOfRows", "1000");
    u.searchParams.set("resultType", "json");
    u.searchParams.set("ocrn_ymd", ymd);
    const res = await fetch(u);
    const text = await res.text();
    let j;
    try { j = JSON.parse(text); }
    catch { throw new Error(`HTTP ${res.status}, JSON이 아닌 응답: ${text.slice(0, 120).replace(KEY, "***")}`); }
    const header = j.response && j.response.header;
    if (header && header.resultCode && !["00", "0", "INFO-000"].includes(String(header.resultCode))) {
      throw new Error(`API 오류 ${header.resultCode}: ${header.resultMsg}`);
    }
    const { rows: got, total } = pickItems(j);
    rows.push(...got);
    if (!got.length || rows.length >= total) break;
  }
  return rows;
}

let old = { days: {} };
try { old = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch {}
const days = { ...(old.days || {}) };

let ok = 0, fail = 0;
for (let i = 0; i < FETCH_DAYS; i++) {
  const ymd = ymdKST(i);
  try {
    const rows = await fetchDay(ymd);
    if (rows.length) days[ymd] = rows; else delete days[ymd];
    ok++;
    console.log(`${ymd}: ${rows.length}행`);
  } catch (e) {
    fail++;
    console.error(`${ymd}: 실패 - ${e.message}`);
  }
}
if (!ok) { console.error("모든 날짜 조회에 실패했습니다."); process.exit(1); }

const keep = Object.keys(days).sort().reverse().slice(0, KEEP_DAYS);
const trimmed = {};
keep.sort().forEach(k => { trimmed[k] = days[k]; });

if (JSON.stringify(trimmed) === JSON.stringify(old.days || {})) {
  console.log("변경 없음");
} else {
  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    source: "소방청_화재정보서비스(공공데이터포털)",
    updated: new Date().toISOString(),
    days: trimmed
  }));
  console.log("data/fire-daily.json 갱신");
}

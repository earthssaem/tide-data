#!/usr/bin/env node
// 기상청 태풍 자료 수집 (기상자료개방포털 data.kma.go.kr, 인증키 없이 공개된 다운로드 기능 사용)
//
//   node tools/kma/typhoon.mjs --year 2022 --no 11        (2022년 제11호 힌남노)
//
// 받는 자료
//  1) 태풍정보(pgmNo=689): 발표마다의 중심위치·중심기압·최대풍속·강풍반경·진행방향·이동속도
//     - 둘째 열(예보시간) 0 = 실황 분석 위치, 12·24…120 = 예보 위치(70% 확률반경 포함)
//     - 포털 안내: "발표시간, 예보시간 등 시간 단위: KST"
//  2) 태풍경로(pgmNo=704): 분석시각별 위·경도·등급(파일에 시간대 표기 없음)
// 원본 파일(CP949)을 그대로 data/raw/kma/typhoon/ 에 보관하고, 웹앱용 UTF-8 CSV를 따로 만든다.
// 태풍 중심기압은 태풍 중심의 값이며 부산의 관측 기압이 아니다(웹앱에서도 기상 그래프에 쓰지 않음).
//
// 공식 '베스트트랙(사후 재분석)'은 기상청 API허브(apihub.kma.go.kr)에서 제공되며 별도 인증키가 필요해 여기서는 받지 않는다.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = 'https://data.kma.go.kr';

if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, ['--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(r.status ?? 1);
}

function args(argv) {
  const o = { year: 2022, no: 11, out: join(ROOT, 'data', 'raw', 'kma', 'typhoon'), stationLat: 35.09638, stationLon: 129.03527, stationName: '부산 조위관측소(DT_0005)' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => argv[++i];
    if (a === '--year') o.year = Number(v());
    else if (a === '--no') o.no = Number(v());
    else if (a === '--out') o.out = v();
    else throw new Error(`알 수 없는 옵션: ${a}`);
  }
  return o;
}

// 쿠키 유지 fetch
const jar = new Map();
async function req(path, { method = 'GET', form = null } = {}) {
  const headers = { 'User-Agent': 'tide-data-lab/1.0 (education)', Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
  let body;
  if (form) { body = new URLSearchParams(form).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8'; }
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(BASE + path, { method, headers, body, redirect: 'follow' });
      for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
      const buf = Buffer.from(await res.arrayBuffer());
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return { status: res.status, buf, type: res.headers.get('content-type') || '' };
    } catch (e) {
      if (attempt === 4) throw new Error(`${path} 요청 실패: ${e.cause?.code || e.message}`);
      await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempt - 1)));
    }
  }
}

const COMMON = { stnIds: '_0', elementCds: 'TYP', serviceSe: 'F00102', dataFormCd: 'F00503', lrgClssCd: 'WRN' };

async function downloadCsv(pagePath, form) {
  await req(pagePath);
  const r = await req(form.__endpoint, { method: 'POST', form: { ...form, __endpoint: undefined } });
  const path = r.buf.toString('utf8').trim();
  if (!path.endsWith('.csv')) throw new Error(`다운로드 파일 경로를 받지 못했습니다: ${path.slice(0, 120)}`);
  const f = await req('/download/fileDownload.do', { method: 'POST', form: { file: path } });
  if (f.status !== 200 || !f.buf.length) throw new Error('파일 다운로드 실패');
  return f.buf;
}

const decoder = new TextDecoder('euc-kr');
const csvRows = (buf) => decoder.decode(buf).replace(/\r/g, '').split('\n').filter(Boolean).map((l) => l.split(','));

function haversineKm(a, b, c, d) {
  const R = 6371.0088, t = (x) => (x * Math.PI) / 180;
  const h = Math.sin(t(c - a) / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(t(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const pad = (n) => String(n).padStart(2, '0');
function koTime(s) { // "2022년 09월 06일 06시" → "2022-09-06 06:00"
  const m = /(\d{4})년\s*(\d{2})월\s*(\d{2})일\s*(\d{2})시/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:00` : null;
}
function addHours(t, h) {
  const d = new Date(`${t.replace(' ', 'T')}:00Z`);
  d.setUTCHours(d.getUTCHours() + h);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:00`;
}
const num = (v) => (v == null || v === '' || v === '-' || v === 'null' ? '' : String(Number(v)));

async function main() {
  const o = args(process.argv.slice(2));
  const tag = `${o.year}-${pad(o.no)}`;
  const outRaw = join(o.out, tag);
  mkdirSync(outRaw, { recursive: true });
  const fetchedAt = new Date().toISOString();

  // 태풍 목록(이름 확인)
  await req('/data/typhoonData/typTrack.do?pgmNo=704');
  const list = JSON.parse((await req('/data/typhoonData/processTypListAjax.do', { method: 'POST', form: { ...COMMON, mddlClssCd: 'WRN08', pgmNo: '704', menuNo: '859', startDt: o.year, endDt: o.year, searchYear: o.year } })).buf.toString('utf8'));
  const entry = list.typList.find((t) => Number(t.typNo) === o.no);
  if (!entry) throw new Error(`${o.year}년 제${o.no}호 태풍을 목록에서 찾지 못했습니다.`);
  console.log('태풍:', entry.typNameLst);

  // 1) 태풍정보
  const infoBuf = await downloadCsv('/data/typhoonData/typInfoTYList.do?pgmNo=689', {
    __endpoint: '/data/typhoonData/downloadTypTYDataCSV.do', ...COMMON, fileType: 'csv', mddlClssCd: 'WRN04', pgmNo: '689', menuNo: '776',
    pageIndex: '1', schListCnt: '10', typYear: String(o.year), typNo: String(o.no), startDt: String(o.year), endDt: String(o.year),
  });
  writeFileSync(join(outRaw, 'kma_typhoon_info_original_cp949.csv'), infoBuf);
  // 2) 태풍경로
  const trackBuf = await downloadCsv('/data/typhoonData/typTrack.do?pgmNo=704', {
    __endpoint: '/data/typhoonData/downloadTypTrackCSV.do', ...COMMON, fileType: 'csv', mddlClssCd: 'WRN08', pgmNo: '704', menuNo: '859',
    startDt: String(o.year), endDt: String(o.year), searchYear: String(o.year), typYear: String(o.year), typNo: String(o.no), typNameLst: entry.typNameLst,
  });
  writeFileSync(join(outRaw, 'kma_typhoon_track_original_cp949.csv'), trackBuf);

  // ── 정리 ──
  const info = csvRows(infoBuf);
  const head = info[0];
  const rows = info.slice(1).map((r) => ({
    issued: koTime(r[0]), lead: Number(r[1]), lat: Number(r[2]), lon: Number(r[3]), pressure: r[4], vmax: r[5], radius: r[7],
    strength: r[8], size: r[9], dir: r[10], speed: r[11], prob70: r[12],
  })).filter((r) => r.issued && Number.isFinite(r.lead));
  const analysis = rows.filter((r) => r.lead === 0);
  const forecast = rows.filter((r) => r.lead > 0);
  const dist = (r) => haversineKm(o.stationLat, o.stationLon, r.lat, r.lon);
  const closest = analysis.reduce((b, r) => (!b || dist(r) < dist(b) ? r : b), null);

  const typDir = join(o.out, tag);
  writeFileSync(join(typDir, 'typhoon_analysis_kst.csv'), [
    `# 기상청 태풍정보(기상자료개방포털 pgmNo=689) 중 예보시간 0 = 실황 분석 위치. ${entry.typNameLst}. 시각 KST(포털 안내).`,
    '# pressure_hpa = 태풍 중심기압(태풍 중심의 값, 부산 관측 기압 아님), max_wind_ms = 중심부근 최대풍속',
    'time,lat,lon,pressure_hpa,max_wind_ms,gale_radius_km,strength,size,direction,speed_kmh,dist_to_station_km',
    ...analysis.map((r) => [r.issued, r.lat, r.lon, num(r.pressure), num(r.vmax), num(r.radius), r.strength, r.size, r.dir, num(r.speed), dist(r).toFixed(1)].join(',')),
  ].join('\n') + '\n');
  writeFileSync(join(typDir, 'typhoon_forecast_kst.csv'), [
    `# 기상청 태풍정보 중 예보시간 12~120시간 = 예보 위치(실제 경로 아님). ${entry.typNameLst}. 시각 KST.`,
    'issued,lead_h,valid,lat,lon,pressure_hpa,max_wind_ms,prob70_radius_km',
    ...forecast.map((r) => [r.issued, r.lead, addHours(r.issued, r.lead), r.lat, r.lon, num(r.pressure), num(r.vmax), num(r.prob70)].join(',')),
  ].join('\n') + '\n');

  // 태풍경로 파일의 시간대 대조: 태풍정보(KST) 실황 위치와 같은 위치가 몇 시간 차이로 나오는지
  const track = csvRows(trackBuf).slice(1).map((r) => ({ t: r[2], lat: parseFloat(r[3]), lon: parseFloat(r[4]), grade: r[5] }));
  const offsets = {};
  for (const tr of track) {
    const same = analysis.filter((a) => Math.abs(a.lat - tr.lat) < 0.01 && Math.abs(a.lon - tr.lon) < 0.01);
    if (same.length !== 1) continue; // 정체해 같은 위치가 여러 번 나오면 대조에서 뺀다
    const m = same[0];
    const h = (Date.parse(`${m.issued.replace(' ', 'T')}:00Z`) - Date.parse(`${tr.t.replace(' ', 'T')}:00Z`)) / 3600e3;
    offsets[h] = (offsets[h] || 0) + 1;
  }
  const meta = {
    format: 'kma-typhoon-fetch', fetchedAt, source: 'https://data.kma.go.kr (기상자료개방포털)', typhoon: entry.typNameLst, year: o.year, no: o.no,
    files: {
      info: { original: 'kma_typhoon_info_original_cp949.csv', page: `${BASE}/data/typhoonData/typInfoTYList.do?pgmNo=689`, header: head, rows: rows.length, timeZone: 'KST (포털 안내 "발표시간, 예보시간 등 시간 단위: KST")' },
      track: { original: 'kma_typhoon_track_original_cp949.csv', page: `${BASE}/data/typhoonData/typTrack.do?pgmNo=704`, rows: track.length, timeZone: '파일에 표기 없음', positionMatchOffsetHours: offsets, inferred: Object.keys(offsets).length === 1 && Number(Object.keys(offsets)[0]) === 9 ? 'UTC로 추정(같은 위치가 태풍정보 KST보다 9시간 이른 시각으로 기록됨)' : '판단 불가' },
    },
    analysisPoints: analysis.length,
    forecastPoints: forecast.length,
    announcements: new Set(rows.map((r) => r.issued)).size,
    closestAnalysisToStation: closest ? { time_kst: closest.issued, lat: closest.lat, lon: closest.lon, dist_km: Number(dist(closest).toFixed(1)), note: `${o.stationName}까지의 거리. 실황 분석 시각(3~6시간 간격) 중 가장 가까운 위치이며 실제 최근접 시각은 그 사이일 수 있음` } : null,
    notObtained: ['베스트트랙(사후 재분석): 기상청 API허브 인증키 필요 — 받지 않음'],
  };
  writeFileSync(join(typDir, 'meta.json'), JSON.stringify(meta, null, 1));
  console.log(`실황 분석 ${analysis.length}개, 예보 ${forecast.length}개(발표 ${meta.announcements}회), 태풍경로 ${track.length}개`);
  console.log('태풍경로 파일 시간 대조:', JSON.stringify(offsets), '→', meta.files.track.inferred);
  if (closest) console.log(`부산 조위관측소와 가장 가까운 실황 분석 위치: ${closest.issued} KST, ${dist(closest).toFixed(1)} km`);
  console.log(`저장: ${typDir}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });

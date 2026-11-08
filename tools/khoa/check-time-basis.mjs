#!/usr/bin/env node
// 시간대 확인: 수집한 공공데이터포털 응답의 시각이 한국 표준시(KST, UTC+9)인지 공식 자료와 대조한다.
// 그래프 모양이 비슷한지만 보는 대신, 시각이 명시된 공식 자료의 '같은 시각 값'과 비교하고
// −12~+12시간 어긋남을 모두 시험해 0시간이 유일한 최적인지 확인한다. 시각을 고치지는 않는다(보고만 함).
//
//   node tools/khoa/check-time-basis.mjs --fetch      공식 자료를 받아 reference/에 저장한 뒤 비교
//   node tools/khoa/check-time-basis.mjs              저장해 둔 reference/로 다시 비교(네트워크 없음)
//
// 대조 자료(인증키 필요 없음)
//  1) 국립해양조사원 조석표 PDF(바다누리, getDownTidePdfData.do) — 표지에 "시 각 : 9hE", 매시 예측 조고 표 포함
//     → API 예측 조위(tideFcstTime)와 같은 시각 값 비교. PDF 글자 추출에 pdftotext(poppler)가 필요(--fetch 때만).
//  2) 바다누리 해양정보 관측소 상세(tide-chart.do 등) — 실시간 표시의 마지막 시각을 받은 시각(UTC)과 비교해 KST임을 확인
//     → API 관측 조위·조위관측소 기압·풍속과 같은 시각 값 비교
//  3) ASOS: 활용가이드에 시간대 표기가 없어 일사량(icsr)과 계산한 태양 위치, 조위관측소 기압(1·2로 KST 확인)과의 1시간 변화량을 비교
// 태풍 시각은 기상자료개방포털 태풍정보 안내("시간 단위: KST")로 확인(data/raw/kma/typhoon/*/meta.json).

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readRawPage } from '../lib/rawpack.mjs';
import { parseResponse } from './khoa-api.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const o = { raw: join(ROOT, 'data', 'raw', 'khoa-2025-26'), raw22: join(ROOT, 'data', 'raw', 'khoa'), fetch: false };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--fetch') o.fetch = true;
  else if (a === '--raw') o.raw = process.argv[++i];
  else throw new Error(`알 수 없는 옵션: ${a}`);
}
const OUT = join(o.raw, 'time-check');
const REF = join(OUT, 'reference');
mkdirSync(REF, { recursive: true });

const STATIONS = [
  { id: 'DT_0001', name: '인천', asos: '112', asosName: '인천', lat: 37.4776, lon: 126.6244 },
  { id: 'DT_0005', name: '부산', asos: '159', asosName: '부산', lat: 35.1047, lon: 129.032 },
  { id: 'DT_0006', name: '묵호', asos: '106', asosName: '동해', lat: 37.5071, lon: 129.1243 },
];
const YEARS = [2025, 2026];
const WEB_DATES = ['20251015', '20260115', '20260920'];
const WEB22 = ['20220905', '20220906', '20220907'];
const KHOA = 'https://www.khoa.go.kr';
const keyOf = (s) => s.slice(0, 16); // 'YYYY-MM-DD HH:MM'
const toMs = (k) => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10), +k.slice(11, 13), +k.slice(14, 16) || 0);

// ───────── 1. 공식 자료 받기(--fetch) ─────────
async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'tide-data-time-check' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

function parseTideTable(txt, year) {
  const days = {};
  let month = null;
  for (const line of txt.split('\n')) {
    const h = line.match(/(\d{1,2})월\s+[A-Z]{3,}/);
    if (h && /\b20\d\d\b/.test(line)) { month = +h[1]; continue; }
    if (!month) continue;
    const r = line.match(/^\s*(\d{1,2})((?:\s+-?\d+){24})\s*$/);
    if (!r) continue;
    days[`${year}-${String(month).padStart(2, '0')}-${String(+r[1]).padStart(2, '0')}`] = r[2].trim().split(/\s+/).map(Number);
  }
  return days;
}

async function fetchAll() {
  const tmp = join(ROOT, 'data', 'raw-work', 'time-ref');
  mkdirSync(tmp, { recursive: true });
  for (const st of STATIONS) {
    for (const y of [...YEARS, ...(st.id === 'DT_0005' ? [2022] : [])]) {
      const url = `${KHOA}/swtc/down/getDownTidePdfData.do?type=not_all&obsPostId=${st.id}&obsPostName=${encodeURIComponent(st.name)}&year=${y}`;
      const buf = await get(url);
      const pdf = join(tmp, `tide-table-${st.id}-${y}.pdf`);
      writeFileSync(pdf, buf);
      const txt = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' });
      const timeLabel = (txt.match(/시 각 : (\S+)/) || [])[1] || null;
      const datum = (txt.match(/조고의 기준면 : ([^\n]+?)\s{2,}|조고의 기준면 : ([^\n]+)/) || []).slice(1).find(Boolean)?.trim() || null;
      const days = parseTideTable(txt, y);
      writeFileSync(join(REF, `tide-table-${st.id}-${y}.json`), JSON.stringify({
        source: '국립해양조사원 조석표(바다누리 해양정보 서비스)', url, fetchedAt: new Date().toISOString(),
        sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length, timeLabel, datum,
        note: '매시 예측 조고(cm) 표를 pdftotext로 추출. 일자별 0~23시 값', days,
      }) + '\n');
      console.log(`조석표 ${st.name} ${y}: 시각 ${timeLabel}, 기준면 ${datum}, ${Object.keys(days).length}일`);
    }
    const web = { source: '바다누리 해양정보 관측소 상세', station: st.id, fetchedAt: null, tide: {}, pred: {}, pressure: {}, wind: {}, latest: null };
    for (const d of [...WEB_DATES, ...(st.id === 'DT_0005' ? WEB22 : [])]) {
      const q = `obsPostId=${st.id}&searchDate=${d}&searchKey=day`;
      const t = JSON.parse((await get(`${KHOA}/oceandata/oceaninfo/detail/tide-chart.do?${q}`)).toString('utf8'));
      for (const r of t.tideObs || []) if (r.obs_value != null) web.tide[keyOf(r.obs_time)] = r.obs_value;
      for (const r of t.tidePre || []) if (r.obs_time.endsWith(':00') && r.obs_value != null) web.pred[keyOf(r.obs_time)] = r.obs_value;
      if (d.startsWith('2022')) continue;
      const p = JSON.parse((await get(`${KHOA}/oceandata/oceaninfo/detail/airtemp-airpress-chart.do?${q}`)).toString('utf8'));
      for (const r of p.airPress || []) if (r.obs_time.endsWith(':00') && r.obs_value != null) web.pressure[keyOf(r.obs_time)] = r.obs_value;
      const w = JSON.parse((await get(`${KHOA}/oceandata/oceaninfo/detail/wind-direct-speed-chart.do?${q}`)).toString('utf8'));
      for (const r of w.windDirSpeed || []) if (r.obs_time.endsWith(':00') && r.obs_wspeed != null) web.wind[keyOf(r.obs_time)] = r.obs_wspeed;
    }
    // 실시간 표시 시각 확인: 오늘(KST) 자료의 마지막 시각 ↔ 지금(UTC)
    const now = new Date();
    const kstToday = new Date(now.getTime() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
    const t = JSON.parse((await get(`${KHOA}/oceandata/oceaninfo/detail/tide-chart.do?obsPostId=${st.id}&searchDate=${kstToday}&searchKey=day`)).toString('utf8'));
    const last = (t.tideObs || []).filter((r) => r.obs_value != null).map((r) => r.obs_time).sort().pop() || null;
    web.fetchedAt = now.toISOString();
    web.latest = { lastLabel: last, fetchedAtUtc: now.toISOString(), minutesBehindIfKst: last ? Math.round((now.getTime() - (toMs(last) - 9 * 3600e3)) / 60000) : null, minutesBehindIfUtc: last ? Math.round((now.getTime() - toMs(last)) / 60000) : null };
    writeFileSync(join(REF, `web-${st.id}.json`), JSON.stringify(web) + '\n');
    console.log(`바다누리 ${st.name}: 마지막 표시 ${last} / 받은 시각 ${now.toISOString()} (KST라면 ${web.latest.minutesBehindIfKst}분 전)`);
  }
}

// ───────── 2. 비교 ─────────
function apiMap(rawDir, ds, st, field, timeField) {
  const m = new Map();
  const man = JSON.parse(readFileSync(join(rawDir, 'manifest.json'), 'utf8'));
  for (const [k, r] of Object.entries(man.requests)) {
    const [d, s] = k.split('|');
    if (d !== ds || s !== st || r.status !== 'ok') continue;
    for (const f of r.files || []) {
      const p = parseResponse(readRawPage(rawDir, f).rawText);
      if (!p.ok) continue;
      for (const it of p.items) {
        const t = it[timeField], v = it[field];
        if (t == null || v == null || v === '') continue;
        m.set(toMs(String(t).slice(0, 16)), Number(v));
      }
    }
  }
  return m;
}

function offsets(a, b, tol, stepMs = 3600e3, range = 12) {
  const res = [];
  for (let h = -range; h <= range; h++) {
    let n = 0, s = 0, mx = 0, same = 0;
    for (const [t, v] of a) {
      const w = b.get(t + h * stepMs);
      if (w == null) continue;
      const e = Math.abs(v - w); n++; s += e; mx = Math.max(mx, e); if (e <= tol) same++;
    }
    if (n) res.push({ h, n, mae: s / n, max: mx, same });
  }
  res.sort((x, y) => x.mae - y.mae);
  return { zero: res.find((r) => r.h === 0) || null, best: res[0], second: res[1] };
}

function toa(tUtc, lat, lon) {
  const d = new Date(tUtc); const doy = Math.floor((tUtc - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5);
  const g = (2 * Math.PI / 365) * (doy - 1 + (d.getUTCHours() - 12) / 24);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const ha = (((d.getUTCHours() * 60 + d.getUTCMinutes() + eqt + 4 * lon) / 4 - 180) * Math.PI) / 180, la = (lat * Math.PI) / 180;
  return Math.max(0, Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(ha));
}
function corr(a, b) {
  const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < n; i++) { ab += (a[i] - ma) * (b[i] - mb); aa += (a[i] - ma) ** 2; bb += (b[i] - mb) ** 2; }
  return ab / Math.sqrt(aa * bb);
}

function compareAll() {
  const R = { checkedAt: new Date().toISOString(), rule: '0시간 어긋남이 유일한 최적이고, 공식 자료의 시각 표기가 KST(9hE)일 때 확인으로 본다', results: [] };
  const line = [];
  const fmt = (x) => `0시간: 평균 차 ${x.zero.mae.toFixed(2)}, 최대 ${x.zero.max.toFixed(2)}, 같은 값 ${x.zero.same}/${x.zero.n} · 최적 ${x.best.h}시간 · 다음 ${x.second.h}시간(평균 차 ${x.second.mae.toFixed(2)})`;
  const add = (o2) => { R.results.push(o2); line.push(`| ${o2.item} | ${o2.reference} | ${o2.detail} | ${o2.ok ? '확인' : '확인 안 됨'} |`); };
  for (const st of STATIONS) {
    // 예측 ↔ 조석표
    const tab = new Map(); let timeLabel = new Set(), datum = new Set();
    for (const y of YEARS) {
      const f = join(REF, `tide-table-${st.id}-${y}.json`);
      if (!existsSync(f)) continue;
      const j = JSON.parse(readFileSync(f, 'utf8'));
      timeLabel.add(j.timeLabel); datum.add(j.datum);
      for (const [d, arr] of Object.entries(j.days)) arr.forEach((v, h) => tab.set(toMs(`${d} ${String(h).padStart(2, '0')}:00`), v));
    }
    const pred = apiMap(o.raw, 'forecast', st.id, 'tdlvHgt', 'predcDt');
    if (tab.size && pred.size) {
      const x = offsets(pred, tab, 0.5);
      add({ station: st.id, item: `${st.name} 예측 조위(tideFcstTime)`, reference: `조석표 PDF 매시 예측 조고(시각 표기 ${[...timeLabel].join(',')}, 기준면 ${[...datum].join(',')})`, detail: `${fmt(x)} cm`, ok: x.best.h === 0 && [...timeLabel].every((t) => t === '9hE') && x.zero.same === x.zero.n, ...x });
    }
    const wf = join(REF, `web-${st.id}.json`);
    if (existsSync(wf)) {
      const web = JSON.parse(readFileSync(wf, 'utf8'));
      const L = web.latest;
      const liveOk = L && L.minutesBehindIfKst >= 0 && L.minutesBehindIfKst < 60;
      add({ station: st.id, item: `바다누리 ${st.name} 실시간 표시 시각`, reference: `받은 시각 ${L?.fetchedAtUtc} (UTC)`, detail: `마지막 표시 ${L?.lastLabel} → KST라면 ${L?.minutesBehindIfKst}분 전, UTC라면 ${L?.minutesBehindIfUtc}분 전`, ok: !!liveOk });
      const m = (o2) => new Map(Object.entries(o2).map(([k, v]) => [toMs(k), Number(v)]));
      const tideAll = m(web.tide);
      const tide00 = new Map([...tideAll].filter(([t]) => new Date(t).getUTCMinutes() === 0));
      const obs = apiMap(o.raw, 'hourly', st.id, 'tdlvVl', 'obsrvnDt');
      if (st.id === 'DT_0005' && existsSync(join(o.raw22, 'manifest.json'))) for (const [k, v] of apiMap(o.raw22, 'hourly', st.id, 'tdlvVl', 'obsrvnDt')) obs.set(k, v);
      const x = offsets(obs, tide00, 0.5);
      // 5분 단위: 정시 앞뒤 30분 평균과 비교
      const mean = (t) => { let s = 0, n = 0; for (let u = t - 30 * 60e3; u <= t + 30 * 60e3; u += 5 * 60e3) { const v = tideAll.get(u); if (v == null) return null; s += v; n++; } return s / n; };
      const fine = [];
      for (let dm = -60; dm <= 60; dm += 5) { let n = 0, s = 0; for (const [t, v] of obs) { const r = mean(t + dm * 60e3); if (r == null) continue; n++; s += Math.abs(v - r); } if (n) fine.push({ dm, mae: s / n, n }); }
      fine.sort((p, q) => p.mae - q.mae);
      add({ station: st.id, item: `${st.name} 관측 조위(hourlyTide)`, reference: '바다누리 관측 조위(5분 간격 표시) 정시 값', detail: `${fmt(x)} cm · 정시 앞뒤 30분 평균과 비교한 최적 어긋남 ${fine[0]?.dm}분(평균 차 ${fine[0]?.mae.toFixed(2)} cm). 1시간 자료는 짧은 출렁임을 거른 값이라 순간값과 몇 cm 다를 수 있음`, ok: x.best.h === 0 && Math.abs(fine[0]?.dm ?? 99) <= 5 && !!liveOk, ...x, fine: fine.slice(0, 3) });
      const pw = m(web.pressure), ww = m(web.wind);
      const ap = apiMap(o.raw, 'airpress', st.id, 'atmpr', 'obsrvnDt');
      const with22 = (mp, ds, code, f, tf) => { if (st.id === 'DT_0005' && existsSync(join(o.raw22, 'manifest.json'))) for (const [k, v] of apiMap(o.raw22, ds, code, f, tf)) mp.set(k, v); return mp; };
      const aw = apiMap(o.raw, 'wind', st.id, 'wspd', 'obsrvnDt');
      const xp = offsets(ap, pw, 0.05), xw = offsets(aw, ww, 0.05);
      add({ station: st.id, item: `${st.name} 조위관측소 기압(surveyAirPress)`, reference: '바다누리 기압 정시 값', detail: `${fmt(xp)} hPa`, ok: xp.best.h === 0 && xp.zero.same === xp.zero.n && !!liveOk, ...xp });
      add({ station: st.id, item: `${st.name} 조위관측소 풍속(surveyWind)`, reference: '바다누리 풍속 정시 값', detail: `${fmt(xw)} m/s`, ok: xw.best.h === 0 && xw.zero.same === xw.zero.n && !!liveOk, ...xw });
      // ASOS ↔ 태양 위치, ↔ 조위관측소 기압 변화량
      const icsr = with22(apiMap(o.raw, 'asos', st.asos, 'icsr', 'tm'), 'asos', st.asos, 'icsr', 'tm'); // 부산은 2022-09 포함
      const ts = [...icsr.keys()], vs = [...icsr.values()];
      const solar = [];
      for (let h = -12; h <= 12; h++) {
        const b = ts.map((t) => { let s = 0; for (let k = 0; k < 12; k++) s += toa(t - 9 * 3600e3 + h * 3600e3 - (k + 0.5) * 300e3, st.lat, st.lon); return s / 12; });
        solar.push({ h, r: corr(vs, b) });
      }
      solar.sort((p, q) => q.r - p.r);
      const s0 = solar.find((r) => r.h === 0), sUtc = solar.find((r) => r.h === -9);
      add({ station: st.id, item: `ASOS ${st.asos} ${st.asosName} 일사량(icsr)`, reference: '계산한 태양 위치(대기권 밖 일사), 시각을 KST로 가정', detail: `일사 자료 ${vs.length}개 · KST 가정 상관 ${s0.r.toFixed(3)} · 최적 ${solar[0].h}시간 · 다음 ${solar[1].h}시간(${solar[1].r.toFixed(3)}) · UTC 가정 ${sUtc.r.toFixed(3)}`, ok: solar[0].h === 0 });
      const pa = with22(apiMap(o.raw, 'asos', st.asos, 'pa', 'tm'), 'asos', st.asos, 'pa', 'tm');
      const d1 = (mp) => new Map([...mp].filter(([t]) => mp.has(t - 3600e3)).map(([t, v]) => [t, v - mp.get(t - 3600e3)]));
      const xd = offsets(d1(pa), d1(with22(new Map(ap), 'airpress', st.id, 'atmpr', 'obsrvnDt')), 0.05);
      add({ station: st.id, item: `ASOS ${st.asos} ${st.asosName} 현지기압(pa)`, reference: `${st.name} 조위관측소 기압(위에서 KST 확인)의 1시간 변화량`, detail: `0시간 평균 차 ${xd.zero.mae.toFixed(3)} hPa(${xd.zero.n}개) · 최적 ${xd.best.h}시간 · 다음 ${xd.second.h}시간(${xd.second.mae.toFixed(3)})`, ok: xd.best.h === 0 });
    }
  }
  const allOk = R.results.every((r) => r.ok);
  R.confirmed = allOk;
  writeFileSync(join(OUT, 'result.json'), JSON.stringify(R, (k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v), 1) + '\n');
  const md = `# 시간대 확인 결과 (${R.checkedAt.slice(0, 10)})

수집 원본: \`${o.raw.replace(ROOT + '/', '')}\` · 판단 기준: ${R.rule}.
시각은 고치지 않았습니다(어긋남을 찾으면 보고만 합니다).

| 자료 | 대조한 공식 자료 | 결과 | 판정 |
|---|---|---|---|
${line.join('\n')}

- 태풍 시각: 기상자료개방포털 태풍정보 안내 "발표시간, 예보시간 등 시간 단위: KST" (data/raw/kma/typhoon/2022-11/meta.json). 앱은 이 태풍정보(실황 분석 위치)만 씁니다.
- 결론: ${allOk ? '모든 항목이 KST(UTC+9)로 확인되었습니다.' : '확인되지 않은 항목이 있습니다. 해당 자료의 시각 비교 기능은 켜지 않습니다.'}
`;
  writeFileSync(join(OUT, 'README.md'), md);
  console.log(md);
  return allOk;
}

if (o.fetch) await fetchAll();
process.exit(compareAll() ? 0 : 1);

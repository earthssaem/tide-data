#!/usr/bin/env node
// 국립해양조사원 조위관측소 목록 받기 + 수집 후보 관측소 계획 만들기
//
//   node tools/khoa/stations.mjs fetch      공식 목록(공공데이터포털 15146602 「조위관측소 운영 현황」 CSV) 내려받기
//   node tools/khoa/stations.mjs plan       tools/khoa/candidates.json의 후보마다 가장 가까운 ASOS 지점을 골라
//                                           data/stations/plan.json 작성(위치·거리·고도 기록)
//
// 기상 자료 원칙: 각 조위관측소의 자체 기상 관측을 먼저 쓰고, 없을 때만 그 관측소에서 가장 가까운
// ASOS를 관측소마다 따로 고른다(부산 ASOS를 다른 지역에 공통으로 쓰지 않음).

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, ['--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(r.status ?? 1);
}

const RAW = join(ROOT, 'data', 'raw', 'khoa', 'stations');
const FILE_URL = 'https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003216350&fileDetailSn=1';
const PAGE = 'https://www.data.go.kr/data/15146602/fileData.do';

export function haversineKm(a, b, c, d) {
  const R = 6371.0088, t = (x) => (x * Math.PI) / 180;
  const h = Math.sin(t(c - a) / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(t(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function parseKhoaStations(buf) {
  const text = new TextDecoder('euc-kr').decode(buf).replace(/\r/g, '');
  const [head, ...lines] = text.split('\n').filter((l) => l.trim());
  return { header: head.split(','), stations: lines.map((l) => l.split(',')).map((r) => ({ code: r[0], type: r[1], name: r[2], lat: Number(r[3]), lon: Number(r[4]), nameEn: r[5] })) };
}

/** 기간 중 운영 중이던 ASOS 이력 행 중 가장 가까운 것 */
export function nearestAsos(lat, lon, rows, periodStart, periodEnd, maxKm = 40) {
  const active = rows.filter((r) => (!r.start || r.start <= periodEnd) && (!r.end || r.end >= periodStart));
  const ranked = active.map((r) => ({ ...r, distKm: haversineKm(lat, lon, r.lat, r.lon) })).sort((a, b) => a.distKm - b.distKm);
  const best = ranked[0] || null;
  return { best: best && best.distKm <= maxKm ? best : null, nearest3: ranked.slice(0, 3).map((r) => ({ stn: r.stn, name: r.name, distKm: Number(r.distKm.toFixed(1)) })) };
}

async function fetchList() {
  let buf;
  for (let i = 1; i <= 4; i++) {
    try {
      const res = await fetch(FILE_URL, { headers: { 'User-Agent': 'tide-data-lab/1.0 (education)' } });
      buf = Buffer.from(await res.arrayBuffer());
      if (res.ok && buf.length > 500) break;
    } catch (e) { if (i === 4) throw e; }
    await new Promise((r) => setTimeout(r, 2000 * i));
  }
  mkdirSync(RAW, { recursive: true });
  writeFileSync(join(RAW, 'khoa_tide_stations_original_cp949.csv'), buf);
  const parsed = parseKhoaStations(buf);
  writeFileSync(join(RAW, 'khoa_tide_stations.json'), JSON.stringify({ source: PAGE, file: FILE_URL, title: '해양수산부 국립해양조사원_조위관측소 운영 현황', fetchedAt: new Date().toISOString(), ...parsed }, null, 1));
  console.log(`조위관측소 ${parsed.stations.length}곳 저장: ${RAW}`);
}

function plan() {
  const cand = JSON.parse(readFileSync(join(ROOT, 'tools', 'khoa', 'candidates.json'), 'utf8'));
  const khoa = JSON.parse(readFileSync(join(RAW, 'khoa_tide_stations.json'), 'utf8'));
  const asosPath = join(ROOT, 'data', 'raw', 'kma', 'station', 'asos_stations.json');
  if (!existsSync(asosPath)) throw new Error('ASOS 지점 목록이 없습니다. 먼저 node tools/kma/asos-stations.mjs를 실행하세요.');
  const asos = JSON.parse(readFileSync(asosPath, 'utf8'));
  const out = [];
  for (const c of cand.stations) {
    const s = khoa.stations.find((x) => x.code === c.code);
    if (!s) { console.warn(`공식 목록에 없는 코드: ${c.code}`); continue; }
    const { best, nearest3 } = nearestAsos(s.lat, s.lon, asos.rows, cand.period.start, cand.period.end, cand.asosMaxKm || 40);
    out.push({
      code: s.code, name: s.name, nameEn: s.nameEn, type: s.type, sea: c.sea, lat: s.lat, lon: s.lon, note: c.note || '',
      asos: best ? {
        stn: best.stn, name: best.name, lat: best.lat, lon: best.lon, elevation_m: best.elevation_m, barometerHeight_m: best.barometerHeight_m,
        address: best.address, distKm: Number(best.distKm.toFixed(1)), validFrom: best.start, validTo: best.end,
      } : null,
      asosCandidates: nearest3,
    });
  }
  const dir = join(ROOT, 'data', 'stations');
  mkdirSync(dir, { recursive: true });
  const planObj = {
    format: 'tide-station-plan', version: 1, builtAt: new Date().toISOString(), period: cand.period,
    sources: { tideStations: khoa.source, asosStations: asos.source },
    rule: '기상: 조위관측소 자체 관측 우선. 없으면 기간 중 운영한 ASOS 가운데 가장 가까운 지점(최대 ' + (cand.asosMaxKm || 40) + ' km)을 관측소마다 따로 선정',
    stations: out,
  };
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(planObj, null, 1));
  console.log('관측소\t해역\tASOS(거리 km, 해발 m)');
  for (const s of out) console.log(`${s.code} ${s.name}\t${s.sea}\t${s.asos ? `${s.asos.stn} ${s.asos.name} (${s.asos.distKm} km, ${s.asos.elevation_m} m)` : '가까운 ASOS 없음'}`);
}

const cmd = process.argv[2];
if (cmd === 'fetch') await fetchList();
else if (cmd === 'plan') plan();
else { console.log('사용: node tools/khoa/stations.mjs fetch | plan'); process.exit(1); }

#!/usr/bin/env node
// 기상청 종관기상관측(ASOS) 지점 목록·이력 받기 (기상자료개방포털 '관측지점정보', 인증키 불필요)
//   node tools/kma/asos-stations.mjs
// 결과: data/raw/kma/station/asos_stations_original_cp949.csv (원본 그대로), asos_stations.json (정리본)
// 원본 열: 지점, 시작일, 종료일, 지점명, 지점주소, 관리관서, 위도, 경도, 노장해발고도(m), 기압계·기온계·풍속계·강우계 높이(관측장비 지상높이 m)
// 같은 지점이 이전하면 기간별로 여러 행이 있다(시작일~종료일).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, ['--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(r.status ?? 1);
}
const BASE = 'https://data.kma.go.kr';
const jar = new Map();
async function req(path, form) {
  for (let i = 1; i <= 4; i++) {
    try {
      const headers = { 'User-Agent': 'tide-data-lab/1.0 (education)', Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
      let body;
      if (form) { body = new URLSearchParams(form).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8'; }
      const res = await fetch(BASE + path, { method: form ? 'POST' : 'GET', headers, body });
      for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const k = kv.indexOf('='); jar.set(kv.slice(0, k), kv.slice(k + 1)); }
      const buf = Buffer.from(await res.arrayBuffer());
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return buf;
    } catch (e) {
      if (i === 4) throw new Error(`${path}: ${e.cause?.code || e.message}`);
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

await req('/tmeta/stn/selectStnList.do?pgmNo=123');
const tree = (await req('/cmmn/stnGroupTreeListLayer.do', { mddlClssCd: 'SFC01', serviceSe: 'F00101', pgmNo: '123', stnIds: '' })).toString('utf8');
const ids = [...new Set([...tree.matchAll(/stnId : "([1-9]\d*)"/g)].map((m) => m[1]))].sort((a, b) => a - b);
if (ids.length < 50) throw new Error(`ASOS 지점 목록이 너무 적습니다(${ids.length}).`);
const csv = await req('/tmeta/stn/selectStnListDownload.do', {
  fileType: 'csv', pageIndex: '1', schListCnt: '1000', mddlClssCd: 'SFC01', stnIds: ids.join(','), serviceSe: 'F00101', pgmNo: '123', txtStnNm: '종관기상관측',
});
const out = join(ROOT, 'data', 'raw', 'kma', 'station');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'asos_stations_original_cp949.csv'), csv);
const text = new TextDecoder('euc-kr').decode(csv).replace(/\r/g, '');
const lines = text.split('\n').filter((l) => l.trim());
const head = lines[0].split(',');
const rows = lines.slice(1).map((l) => l.split(',')).filter((r) => /^\d+$/.test(r[0])).map((r) => ({
  stn: r[0], start: r[1] || null, end: r[2] || null, name: r[3], address: r[4], office: r[5],
  lat: Number(r[6]), lon: Number(r[7]), elevation_m: r[8] === '' ? null : Number(r[8]),
  barometerHeight_m: r[9] === '' ? null : Number(r[9]), windSensorHeight_m: r[11] === '' ? null : Number(r[11]),
}));
writeFileSync(join(out, 'asos_stations.json'), JSON.stringify({ source: `${BASE}/tmeta/stn/selectStnList.do?pgmNo=123 (종관기상관측 관측지점정보 CSV)`, fetchedAt: new Date().toISOString(), header: head, stations: ids.length, rows }, null, 1));
console.log(`ASOS 지점 ${ids.length}곳, 이력 행 ${rows.length}개 저장: ${out}`);

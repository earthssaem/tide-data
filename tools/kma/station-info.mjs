#!/usr/bin/env node
// 기상청 지상관측 지점정보(기상자료개방포털 지점 상세 페이지)에서 위치·해발고도를 읽어 저장
//   node tools/kma/station-info.mjs --stn 159
// 결과: data/raw/kma/station/<지점>.json (원본 페이지 HTML도 함께 보관)

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, ['--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(r.status ?? 1);
}

const argv = process.argv.slice(2);
const stn = argv[argv.indexOf('--stn') + 1] || '159';
const url = `https://data.kma.go.kr/tmeta/stn/selectStnDetail.do?pgmNo=82&isSelectStn=Y&stdStnNo=${encodeURIComponent(stn)}`;

let html = '';
for (let i = 1; i <= 4; i++) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'tide-data-lab/1.0 (education)' } });
    html = await res.text();
    if (res.ok) break;
  } catch (e) {
    if (i === 4) { console.error('지점정보 페이지를 불러오지 못했습니다:', e.cause?.code || e.message); process.exit(1); }
    await new Promise((r) => setTimeout(r, 2000 * i));
  }
}
const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ');
const L = text.split('\n').map((l) => l.trim()).filter(Boolean);
const after = (label) => { const i = L.indexOf(label); return i >= 0 ? L[i + 1] : null; };
const lat = Number(/위도\s*:\s*([\d.]+)/.exec(text)?.[1]);
const lon = Number(/경도\s*:\s*([\d.]+)/.exec(text)?.[1]);
const info = {
  source: url,
  fetchedAt: new Date().toISOString(),
  stationId: after('표준지점번호'),
  name: after('지점명(한글)'),
  address: after('새주소'),
  lat: Number.isFinite(lat) ? lat : null,
  lon: Number.isFinite(lon) ? lon : null,
  elevation_m: Number(after('해발고도(m)')) || null,
  observationStart: after('관측개시일'),
  intervalMinutes: Number(after('관측주기(분)')) || null,
  notes: '해발고도는 관측장소의 높이이며 기압계 높이가 아닐 수 있음(페이지에 기압계 높이 표기 없음).',
};
if (info.stationId !== stn || info.lat == null || info.elevation_m == null) {
  console.error('지점정보를 해석하지 못했습니다:', JSON.stringify(info));
  process.exit(1);
}
const out = join(ROOT, 'data', 'raw', 'kma', 'station');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, `${stn}.json`), JSON.stringify(info, null, 1));
writeFileSync(join(out, `${stn}_page.html`), html);
console.log(JSON.stringify(info, null, 1));

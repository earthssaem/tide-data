#!/usr/bin/env node
// 기능 확인용 "예시 데이터" 생성기(사례 형식 3)
// ─────────────────────────────────────────────────────────────
// 이 스크립트가 만드는 값은 실제 관측값이 아니다.
//  - 관측소·기상관측소·태풍은 모두 가상이며, 연도(2098~2099년)도 실제 자료와 구분하기 위해 일부러 고른 값이다.
//  - 조위는 조화분조의 합으로 만든 가상 곡선(예측)에 가상 기상 효과와 잡음을 더한 것(관측)이다.
//  - 달의 위상 시각은 Meeus 계산식으로 계산한 값이다.
// 실행: node tools/make-sample-data.mjs
//   → data/cases/sample-2099/ (모든 자료) , data/cases/test-minimal/ (기상·태풍·달의 위상 없음, 결측 포함)
// ─────────────────────────────────────────────────────────────

import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { moonPhasesBetween } from './lib/moon.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'cases');
const H = 3600e3, D = 24 * H, KST = 9 * H;
const kst = (y, mo, d, h = 0) => Date.UTC(y, mo - 1, d, h) - KST;
const p2 = (n) => String(n).padStart(2, '0');
const fmt = (t) => { const d = new Date(t + KST); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; };
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = rng(20990901);
const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand());

// 분조 주기(시간)
const PER = { M2: 12.4206012, S2: 12, N2: 12.65834751, K2: 11.96723606, K1: 23.93447213, O1: 25.81933871, P1: 24.06588766 };
const STATIONS = [
  { id: 'SAMPLE_W', name: '인천(가상)', nameEn: 'Incheon (sample)', sea: '서해', lat: 37.2, lon: 126.4, z0: 460, amp: { M2: 280, S2: 110, N2: 50, K2: 30, K1: 38, O1: 30, P1: 12 } },
  { id: 'SAMPLE_S', name: '부산(가상)', nameEn: 'Busan (sample)', sea: '남해', lat: 34.9, lon: 128.6, z0: 70, amp: { M2: 40, S2: 22, N2: 9, K2: 6, K1: 6, O1: 4, P1: 2 } },
  { id: 'SAMPLE_E', name: '묵호(가상)', nameEn: 'Mukho (sample)', sea: '동해', lat: 37.6, lon: 129.1, z0: 20, amp: { M2: 7, S2: 3, N2: 2, K2: 1, K1: 5, O1: 6, P1: 2 } },
];
const T0 = kst(2098, 10, 1);
function pred(st, t) {
  const h = (t - T0) / H;
  let v = st.z0;
  let k = 0;
  for (const [c, a] of Object.entries(st.amp)) { v += a * Math.cos((2 * Math.PI * h) / PER[c] - (k += 0.7)); }
  return v;
}
// 가상 태풍(기간 A: 2099-08-15~19)
const TY = [[kst(2099, 8, 14, 0), 28.0, 125.5, 960, 40], [kst(2099, 8, 15, 6), 31.0, 126.8, 955, 42], [kst(2099, 8, 16, 0), 33.6, 128.0, 962, 38], [kst(2099, 8, 16, 9), 34.8, 128.7, 968, 35], [kst(2099, 8, 16, 18), 36.4, 129.6, 978, 30], [kst(2099, 8, 17, 12), 39.5, 132.5, 990, 24]];
const tyNear = (t) => Math.exp(-(((t - kst(2099, 8, 16, 9)) / (9 * H)) ** 2));

function writeCase(dir, { id, title, notice, minimal }) {
  if (existsSync(dir)) rmSync(dir, { recursive: true });
  mkdirSync(dir, { recursive: true });
  const t1 = kst(2099, 10, 1);
  const stations = [];
  for (const st of STATIONS) {
    mkdirSync(join(dir, 'stations', st.id), { recursive: true });
    const P = [], O = [];
    for (let t = T0; t < t1; t += H) {
      const p = pred(st, t);
      P.push(`${fmt(t)},${p.toFixed(2)},1`);
      const season = 12 * Math.sin((2 * Math.PI * (t - T0)) / (365 * D));
      const missing = minimal && st.id === 'SAMPLE_S' && t >= kst(2099, 9, 14) && t < kst(2099, 9, 14, 6);
      O.push(missing ? `${fmt(t)},,9` : `${fmt(t)},${Math.round(p + 15 + season + gauss() * 3)},1`);
    }
    const head = (f) => [`# 기능 확인용 예시 데이터(가상, 실제 관측값 아님) — ${st.name}`, `time,${f},qc`];
    writeFileSync(join(dir, 'stations', st.id, 'predicted.csv'), [...head('pred_cm'), ...P].join('\n') + '\n');
    writeFileSync(join(dir, 'stations', st.id, 'observed.csv'), [...head('tide_cm'), ...O].join('\n') + '\n');
    const spec = (kind, f) => ({ file: `stations/${st.id}/${kind}.csv`, adapter: 'csv-tide', kind, label: kind === 'observed' ? '관측 조위' : '예측 조위', stationId: st.id, datum: 'UNCONFIRMED', datumLabel: '가상(예시)', datumConfirmed: false, unit: 'cm', intervalMinutes: 60, time: { column: 'time', offset: '+09:00' }, value: { column: f }, quality: { column: 'qc', ok: ['1'], bad: ['3'], missing: ['9'] }, missingValues: [''], meta: { provider: '예시 데이터 생성기(가상)', title: '기능 확인용 예시 데이터', identifier: `sample-${st.id}` } });
    const datasets = { observed: spec('observed', 'tide_cm'), predicted: spec('predicted', 'pred_cm'), weather: { provided: false } };
    if (st.id === 'SAMPLE_S' && !minimal) datasets.weather = weatherSpec(dir, `stations/${st.id}/weather.csv`, kst(2099, 9, 1), t1, false);
    stations.push({ id: st.id, name: st.name, nameEn: st.nameEn, sea: st.sea, lat: st.lat, lon: st.lon, note: '가상 관측소', datasets, timeShiftFlags: [] });
  }
  // 과거 비교 기간(2099-08): 가상 남해 관측 + 기상 + 태풍
  mkdirSync(join(dir, 'past', 'SAMPLE_S-2099-08'), { recursive: true });
  const S = STATIONS[1];
  const O = [];
  for (let t = kst(2099, 8, 1); t < kst(2099, 9, 1); t += H) O.push(`${fmt(t)},${Math.round(pred(S, t) + 10 + 70 * tyNear(t) + gauss() * 3)},1`);
  writeFileSync(join(dir, 'past', 'SAMPLE_S-2099-08', 'observed.csv'), ['# 기능 확인용 예시 데이터(가상)', 'time,tide_cm,qc', ...O].join('\n') + '\n');
  const past = {
    id: 'SAMPLE_S-2099-08', stationId: 'SAMPLE_S', label: '부산(가상) 2099년 8월', period: { start: '2099-08-01', end: '2099-08-31' },
    datasets: {
      observed: { ...stations[1].datasets.observed, file: 'past/SAMPLE_S-2099-08/observed.csv' },
      weather: minimal ? { provided: false } : weatherSpec(dir, 'past/SAMPLE_S-2099-08/weather.csv', kst(2099, 8, 1), kst(2099, 9, 1), true),
      typhoon: { provided: false },
    },
  };
  if (!minimal) {
    writeFileSync(join(dir, 'past', 'SAMPLE_S-2099-08', 'typhoon_track.csv'), ['# 가상 태풍(예시)', 'time,lat,lon,pressure_hpa,max_wind_ms', ...TY.map(([t, la, lo, p, w]) => `${fmt(t)},${la},${lo},${p},${w}`)].join('\n') + '\n');
    past.datasets.typhoon = { name: '가상 태풍 예시', year: 2099, label: '가상 태풍(예시)', note: '기능 확인용 가상 태풍', track: { file: 'past/SAMPLE_S-2099-08/typhoon_track.csv', kind: '가상 경로(예시)', time: { column: 'time', offset: '+09:00' }, latColumn: 'lat', lonColumn: 'lon', pressureColumn: 'pressure_hpa', windColumn: 'max_wind_ms' }, meta: { provider: '예시 데이터 생성기(가상)', title: '가상 태풍(예시)', identifier: 'sample-typhoon' } };
  }
  if (!minimal) {
    const NAMES = { new: '삭', first: '상현', full: '망', last: '하현' };
    writeFileSync(join(dir, 'moon.csv'), ['# 달의 위상(계산값, 예시 사례용)', 'time,phase,lunar', ...moonPhasesBetween(kst(2098, 9, 10), kst(2099, 10, 20)).map((p) => `${fmt(Math.round(p.t / 60000) * 60000)},${NAMES[p.phase]},`)].join('\n') + '\n');
  }
  const months = [];
  for (let y = 2098, m = 10; y < 2099 || m <= 9; m++) { if (m > 12) { m = 1; y++; } months.push(`${y}-${p2(m)}`); if (y === 2099 && m === 9) break; }
  const cfg = {
    formatVersion: 3, kind: 'tide-assessment', id, dataVersion: `${id}-1`, isSample: true, sampleNotice: notice, title,
    timezone: { label: 'KST', name: '한국 표준시(UTC+9)', offsetMinutes: 540 },
    timeBasis: minimal ? { confirmed: false, note: '예시: 시간대 확인 안 됨(시각 연결 끔 시험용)' } : { confirmed: true, tide: true, weather: true, typhoon: true, note: '예시 데이터(가상)', evidence: '' },
    representative: 'SAMPLE_S', period: { start: '2098-10-01', end: '2099-09-30' }, months, stations, past,
    recentTyphoonCheck: { text: '예시: 이 기간 가까이 지난 가상 태풍 없음.' },
    moonPhases: minimal ? { provided: false } : { file: 'moon.csv', adapter: 'csv-moon', time: { column: 'time', offset: '+09:00' }, phaseColumn: 'phase', lunarColumn: 'lunar', meta: { provider: 'Meeus 계산식(예시 사례)', identifier: 'moon-calc-meeus' } },
    defaults: { month: '2099-09', inq1: { start: '2099-09-10 00:00', end: '2099-09-13 00:00', count: { start: '2099-09-11 02:00', end: '2099-09-12 02:00' } }, inq2: { start: '2099-09-10 00:00', end: '2099-09-13 00:00' }, inq4: { a: { start: '2099-08-14 00:00', end: '2099-08-19 00:00' }, b: { start: '2099-09-20 00:00', end: '2099-09-25 00:00' } } },
    description: { provider: '예시 데이터 생성기(가상)', datumNote: '가상 자료' },
  };
  writeFileSync(join(dir, 'case.json'), JSON.stringify(cfg, null, 1) + '\n');
}

function weatherSpec(dir, rel, t0, t1, storm) {
  const rows = [];
  for (let t = t0; t < t1; t += H) {
    const n = storm ? tyNear(t) : 0;
    const ps = 1012 + 3 * Math.sin((2 * Math.PI * (t - t0)) / (5 * D)) - 45 * n + gauss() * 0.4;
    const ws = Math.max(0, 2.5 + 16 * n + gauss() * 0.8);
    const wd = ((storm && n > 0.2 ? 110 : 250) + gauss() * 25 + 360) % 360;
    rows.push(`${fmt(t)},${ps.toFixed(1)},${(ps - 3).toFixed(1)},${ws.toFixed(1)},${Math.round(wd)}`);
  }
  writeFileSync(join(dir, rel), ['# 기능 확인용 예시 데이터(가상 기상)', 'time,pressure_sea_hpa,pressure_station_hpa,wind_ms,wind_dir_deg', ...rows].join('\n') + '\n');
  return {
    file: rel, adapter: 'csv-weather', intervalMinutes: 60, station: { id: 'SAMPLE-WX', name: '가상 기상관측소', lat: 34.95, lon: 128.7, note: '가상' },
    time: { column: 'time', offset: '+09:00' },
    fields: { pressureSea: { column: 'pressure_sea_hpa', unit: 'hPa', label: '해면기압' }, pressureStation: { column: 'pressure_station_hpa', unit: 'hPa', label: '현지기압' }, windSpeed: { column: 'wind_ms', unit: 'm/s', label: '풍속' }, windDir: { column: 'wind_dir_deg', unit: 'deg', label: '풍향' } },
    missingValues: [''], meta: { provider: '예시 데이터 생성기(가상)', title: '가상 기상', identifier: 'sample-weather' },
  };
}

writeCase(join(ROOT, 'sample-2099'), { id: 'sample-2099', title: '예시 사례 (기능 확인용 예시 데이터)', notice: '실제 관측값이 아닌 가상 자료입니다(교사용 기능 시험 전용).', minimal: false });
writeCase(join(ROOT, 'test-minimal'), { id: 'test-minimal', title: '검증용 사례 (기상·태풍·달의 위상 없음, 시간대 미확인)', notice: '검증용 가상 자료입니다.', minimal: true });
console.log('예시 사례를 만들었습니다: data/cases/sample-2099, data/cases/test-minimal');

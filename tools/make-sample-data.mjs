#!/usr/bin/env node
// 기능 확인용 "예시 데이터" 생성기
// ─────────────────────────────────────────────────────────────
// 이 스크립트가 만드는 값은 실제 관측값이 아니다.
//  - 관측소·기상관측소·태풍은 모두 가상이며, 연도(2099년)도 실제 자료와 구분하기 위해 일부러 고른 값이다.
//  - 조위는 조화분조(M2, S2, N2, K2, K1, O1, P1)의 합으로 만든 가상 곡선에 가상 기상 효과와 잡음을 더한 것이다.
//  - 달의 위상 시각은 Meeus(Astronomical Algorithms, 2판, 49장) 계산식으로 2099년에 대해 계산한 값이다.
//    (주요 보정항만 사용, 오차 수 분 이내) 실제 사례에서는 한국천문연구원 등 공식 자료로 교체한다.
// 실행: node tools/make-sample-data.mjs  → data/cases/sample-2099/ 에 CSV 생성
// ─────────────────────────────────────────────────────────────

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'cases', 'sample-2099');
mkdirSync(OUT, { recursive: true });

const H = 3600e3;
const KST = 9 * H;
const kst = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - KST;
const p2 = (n) => String(n).padStart(2, '0');
function fmtKST(t) {
  const d = new Date(t + KST);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

// ── 결정적 난수 (mulberry32) ──
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20990901);
const gauss = () => {
  const u = Math.max(rand(), 1e-12), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

import { moonPhasesBetween } from './lib/moon.mjs';

// ── 가상 관측소 ──
const STATION = { lat: 34.80, lon: 127.90 };
const WX_STATION = { lat: 34.95, lon: 128.03 };

// ── 가상 태풍 경로 (KST) ──
const WAYPOINTS = [
  [kst(2099, 9, 17, 0), 24.5, 124.0, 965, 38],
  [kst(2099, 9, 18, 0), 27.5, 125.0, 955, 42],
  [kst(2099, 9, 19, 0), 30.3, 126.3, 952, 43],
  [kst(2099, 9, 20, 0), 33.0, 127.7, 958, 40],
  [kst(2099, 9, 20, 12), 34.5, 128.2, 966, 36],
  [kst(2099, 9, 21, 0), 36.2, 129.4, 976, 31],
  [kst(2099, 9, 22, 0), 39.6, 132.9, 988, 24],
  [kst(2099, 9, 22, 18), 42.0, 136.0, 994, 20],
];
function typhoonAt(t) {
  if (t < WAYPOINTS[0][0] || t > WAYPOINTS[WAYPOINTS.length - 1][0]) return null;
  for (let i = 0; i < WAYPOINTS.length - 1; i++) {
    const a = WAYPOINTS[i], b = WAYPOINTS[i + 1];
    if (t >= a[0] && t <= b[0]) {
      const f = (t - a[0]) / (b[0] - a[0]);
      return { lat: a[1] + (b[1] - a[1]) * f, lon: a[2] + (b[2] - a[2]) * f, pc: a[3] + (b[3] - a[3]) * f, vmax: a[4] + (b[4] - a[4]) * f };
    }
  }
  return null;
}
function distBearing(lat1, lon1, lat2, lon2) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  const d = 2 * R * Math.asin(Math.sqrt(a));
  const y = Math.sin(dLon) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos(dLon);
  const brg = (Math.atan2(y, x) / r + 360) % 360; // 1 → 2 방위
  return { d, brg };
}
const PN = 1011;
function stormAt(t, site) {
  const ty = typhoonAt(t);
  if (!ty) return { p: PN, v: 0, from: null };
  const { d, brg } = distBearing(ty.lat, ty.lon, site.lat, site.lon);
  const Rm = 70, B = 1.3, r = Math.max(d, 5);
  const p = ty.pc + (PN - ty.pc) * Math.exp(-((Rm / r) ** B));
  const v = (r < Rm ? ty.vmax * (r / Rm) : ty.vmax * (Rm / r) ** 0.62) * 0.75;
  const from = (brg + 70 + 360) % 360; // 반시계 회전 + 유입각 20°
  return { p, v, from };
}

// ── 조석 (가상 조화상수) ──
const CONST = [
  // 이름, 각속도(°/h), 진폭(cm)
  ['M2', 28.9841042, 62], ['S2', 30.0, 27], ['N2', 28.4397295, 12], ['K2', 30.0821373, 7],
  ['K1', 15.0410686, 21], ['O1', 13.9430356, 16], ['P1', 14.9589314, 7],
];
const Z0 = 92;
const tRef = kst(2099, 9, 1);
const phases = moonPhasesBetween(kst(2099, 8, 10), kst(2099, 10, 20));
const firstNew = phases.find((p) => p.phase === 'new' && p.t > kst(2099, 9, 1));
const springT = firstNew.t + 1.6 * 24 * H; // 사리는 삭·망 약 1~2일 뒤에 오도록 설정(가상)
const phi = {};
for (const [name, w] of CONST) {
  const hrs = (springT - tRef) / H;
  phi[name] = name === 'M2' || name === 'S2' || name === 'K2' ? (w * hrs) % 360 : null;
}
phi.N2 = (CONST[2][1] * ((springT + 3.5 * 24 * H - tRef) / H)) % 360; // 근지점 효과는 별도 위상
phi.K1 = (CONST[4][1] * ((kst(2099, 9, 8, 3) - tRef) / H)) % 360;
phi.O1 = (CONST[5][1] * ((kst(2099, 9, 8, 3) - tRef) / H)) % 360;
phi.P1 = phi.K1;
function astroTide(t) {
  const hrs = (t - tRef) / H;
  let s = Z0;
  for (const [name, w, A] of CONST) s += A * Math.cos(((w * hrs - phi[name]) * Math.PI) / 180);
  return s;
}

// ── 시계열 생성 ──
const T0 = kst(2099, 8, 29), T1 = kst(2099, 10, 4); // 관측: 8/29 00:00 ~ 10/3 23:00
let ar = 0;
const obsRows = [], predRows = [];
let surgeLag = 0;
for (let t = T0; t < T1; t += H) {
  const pred = astroTide(t);
  const st = stormAt(t, STATION);
  const ib = (PN - st.p) * 1.0;
  let wind = 0;
  if (st.from != null) {
    const onshore = Math.cos(((st.from - 120) * Math.PI) / 180); // 동남동풍일 때 해안으로 불어온다고 가정(가상 해안)
    wind = onshore > 0 ? 0.16 * st.v * st.v * onshore : 0.05 * st.v * st.v * onshore;
  }
  surgeLag = 0.45 * surgeLag + 0.55 * (ib + wind);
  ar = 0.92 * ar + gauss() * 1.6;
  const obs = pred + surgeLag + ar + gauss() * 0.8;
  obsRows.push({ t, v: Math.round(obs), qc: '1' });
  predRows.push({ t, v: Math.round(pred) / 100 });
}

// 결측·오류 자리 만들기 (검증용)
const dropTimes = new Set();
for (let h = 9; h <= 13; h++) dropTimes.add(kst(2099, 9, 14, h));        // 행 자체가 없는 5시간 결측
for (const r of obsRows) {
  if (r.t === kst(2099, 9, 25, 4)) { r.v = ''; r.qc = '9'; }               // 값 비어 있음(결측)
  if (r.t === kst(2099, 9, 21, 2)) { r.v = ''; r.qc = '9'; }               // 탐구 3 구간 결측
  if (r.t === kst(2099, 9, 27, 21)) { r.v = 9999; r.qc = '3'; }            // 오류값
  if (r.t === kst(2099, 9, 5, 16)) { r.v = r.v + 6; r.qc = '2'; }          // 품질 의심
}

const header = [
  '# 기능 확인용 예시 데이터 — 실제 관측값이 아닙니다. (tools/make-sample-data.mjs로 생성)',
];
writeFileSync(join(OUT, 'observed.csv'), [
  ...header,
  '# 관측소: EX-A(가상), 시간대: KST(UTC+9), 단위: cm, 기준면: 예시 기준면(EX-DATUM), qc: 1 정상 / 2 의심 / 3 오류 / 9 결측',
  'time,tide_cm,qc',
  ...obsRows.filter((r) => !dropTimes.has(r.t)).map((r) => `${fmtKST(r.t)},${r.v},${r.qc}`),
].join('\n') + '\n');

writeFileSync(join(OUT, 'predicted.csv'), [
  ...header,
  '# 관측소: EX-A(가상), 시간대: KST(UTC+9), 단위: m (앱 전처리에서 cm로 변환), 기준면: 예시 기준면(EX-DATUM)',
  'time,pred_m',
  ...predRows.map((r) => `${fmtKST(r.t)},${r.v.toFixed(2)}`),
].join('\n') + '\n');

// 기상 자료 (태풍 전후 기간만)
const W0 = kst(2099, 9, 15), W1 = kst(2099, 9, 26);
const wxRows = [];
let par = 0;
for (let t = W0; t < W1; t += H) {
  if (t === kst(2099, 9, 19, 7) || t === kst(2099, 9, 19, 8)) continue; // 결측(행 없음)
  const st = stormAt(t, WX_STATION);
  const hrs = (t - tRef) / H;
  par = 0.95 * par + gauss() * 0.25;
  const p = st.p + 0.8 * Math.cos(((30 * hrs - 300) * Math.PI) / 180) + par;
  const amb = { u: 2.0 + gauss() * 0.6, v: 1.0 + gauss() * 0.6 }; // 약한 배경바람
  let u = amb.u, vv = amb.v;
  if (st.from != null) {
    const toward = ((st.from + 180) * Math.PI) / 180;
    u += st.v * Math.sin(toward); vv += st.v * Math.cos(toward);
  }
  const speed = Math.hypot(u, vv);
  const from = ((Math.atan2(-u, -vv) * 180) / Math.PI + 360) % 360;
  const dirStr = t === kst(2099, 9, 20, 21) ? '' : Math.round(from) % 360;
  wxRows.push(`${fmtKST(t)},${p.toFixed(1)},${speed.toFixed(1)},${dirStr}`);
}
writeFileSync(join(OUT, 'weather.csv'), [
  ...header,
  '# 기상관측지점: EX-W(가상), 시간대: KST(UTC+9), 기압 hPa, 풍속 m/s, 풍향 도(바람이 불어오는 방향, 북=0°)',
  'time,pressure_hpa,wind_ms,wind_dir_deg',
  ...wxRows,
].join('\n') + '\n');

// 달의 위상
const NAMES = { new: '삭', first: '상현', full: '망', last: '하현' };
writeFileSync(join(OUT, 'moon.csv'), [
  '# 예시 사례용 달의 위상 시각: Meeus 계산식으로 계산(2099년, KST). 실제 사례에서는 공식 자료로 교체하세요.',
  'time,phase,lunar',
  ...moonPhasesBetween(kst(2099, 8, 15), kst(2099, 10, 15)).map((p) => `${fmtKST(Math.round(p.t / 60000) * 60000)},${NAMES[p.phase]},`),
].join('\n') + '\n');

// 태풍 경로 (6시간 간격)
const track = [];
for (let t = WAYPOINTS[0][0]; t <= WAYPOINTS[WAYPOINTS.length - 1][0]; t += 6 * H) {
  const ty = typhoonAt(t);
  track.push(`${fmtKST(t)},${ty.lat.toFixed(1)},${ty.lon.toFixed(1)},${Math.round(ty.pc)},${Math.round(ty.vmax)}`);
}
writeFileSync(join(OUT, 'typhoon_track.csv'), [
  ...header,
  '# 가상 태풍 A의 가상 경로, 시간대: KST(UTC+9), 중심기압 hPa, 최대풍속 m/s',
  'time,lat,lon,pressure_hpa,max_wind_ms',
  ...track,
].join('\n') + '\n');

console.log('예시 데이터 생성 완료:', OUT);
console.log('사리 기준 시각(가상):', fmtKST(springT));

// ── 검증용 최소 사례(test-minimal) ──
// 관측 조위만 정상 제공. 시각은 UTC로, 단위는 m로 기록해 전처리 변환을 확인한다.
// 예측 조위는 일부러 다른 기준면으로 표시해 잔차가 계산되지 않아야 함을 확인한다.
// 기상·달의 위상 자료는 제공하지 않는다.
const OUT2 = join(OUT, '..', 'test-minimal');
mkdirSync(OUT2, { recursive: true });
const fmtUTC = (t) => fmtKST(t - KST);
const M0 = kst(2099, 9, 18), M1 = kst(2099, 9, 24);
const minimalObs = obsRows.filter((r) => r.t >= M0 && r.t < M1);
writeFileSync(join(OUT2, 'observed_utc_m.csv'), [
  '# 검증용 예시 데이터 — 실제 관측값이 아닙니다. 시각은 UTC, 단위는 m',
  'datetime_utc,level_m,flag',
  ...minimalObs.map((r) => `${fmtUTC(r.t)},${r.v === '' ? '' : (Number(r.v) / 100).toFixed(2)},${r.qc}`),
].join('\n') + '\n');
writeFileSync(join(OUT2, 'predicted_other_datum.csv'), [
  '# 검증용: 기준면이 다른 예측 조위(잔차 계산 금지 확인용)',
  'time,pred_cm',
  ...predRows.filter((r) => r.t >= M0 && r.t < M1).map((r) => `${fmtKST(r.t)},${Math.round(r.v * 100 + 40)}`),
].join('\n') + '\n');
console.log('검증용 사례 생성 완료:', OUT2);

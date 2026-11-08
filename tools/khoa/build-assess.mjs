#!/usr/bin/env node
// 수행평가 사례 만들기(형식 3): 인천·부산·묵호 1년(예측·관측 조위) + 부산 기상(ASOS) + 부산 2022년 9월(관측·기상·태풍)
//
//   node tools/khoa/build-assess.mjs              → data/cases/khoa-assess-2025-26/
//   (--set-default: 학생 앱 기본 사례로 지정)
//
// 원칙
//  - 응답에 없는 값은 만들지 않는다(결측은 빈 칸). 시각은 고치지 않는다.
//  - 예측·관측 조위의 시각 어긋남을 날마다 검사해 보고서에 '확인 필요'로만 표시한다(자동 보정 없음).
//  - 시간대 확인 결과(data/raw/khoa-2025-26/time-check/result.json)가 모두 '확인'일 때만 timeBasis.confirmed=true.
//  - 관측 조위의 높이 기준면은 문서에 없으므로 미확인. 예측 조위는 조석표의 기준면 표기를 함께 적는다.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATASETS, dateRange } from './khoa-api.mjs';
import { loadDataset, buildSeries, hourlyCompleteness, addDays, fmtNum } from './build-case.mjs';
import { buildWeather } from './weather-build.mjs';
import { moonPhasesBetween } from '../lib/moon.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const o = {
  raw: join(ROOT, 'data', 'raw', 'khoa-2025-26'), raw22: join(ROOT, 'data', 'raw', 'khoa'), casesDir: join(ROOT, 'data', 'cases'),
  plan: join(ROOT, 'data', 'stations', 'plan-2025-26.json'), caseId: 'khoa-assess-2025-26', setDefault: false,
  typhoonDir: join(ROOT, 'data', 'raw', 'kma', 'typhoon', '2022-11'), typhoonCheck: join(ROOT, 'data', 'raw', 'kma', 'typhoon', '2026-09-check'),
  minCm: -300, maxCm: 1500,
};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--set-default') o.setDefault = true;
  else if (a === '--case-id') o.caseId = process.argv[++i];
  else if (a === '--cases-dir') o.casesDir = process.argv[++i];
  else throw new Error(`알 수 없는 옵션: ${a}`);
}

const REP = 'DT_0005';
const PAST = { start: '2022-09-01', end: '2022-09-30' };
const DEFAULTS = {
  month: '2026-09',
  inq4: { a: ['2022-09-04', '2022-09-09'], b: ['2022-09-25', '2022-09-30'] },
};
const TIDE_TABLE_DATUM = { DT_0001: '평균해면 아래 464 cm', DT_0005: '평균해면 아래 65 cm', DT_0006: '평균해면 아래 19 cm' };

const plan = JSON.parse(readFileSync(o.plan, 'utf8'));
const manifest = JSON.parse(readFileSync(join(o.raw, 'manifest.json'), 'utf8'));
const manifest22 = JSON.parse(readFileSync(join(o.raw22, 'manifest.json'), 'utf8'));
const dates = dateRange(plan.period.start, plan.period.end);
const dates22 = dateRange(PAST.start, PAST.end);
const outDir = join(o.casesDir, o.caseId);
if (existsSync(outDir)) rmSync(outDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

const tzCheckPath = join(o.raw, 'time-check', 'result.json');
const tzCheck = existsSync(tzCheckPath) ? JSON.parse(readFileSync(tzCheckPath, 'utf8')) : null;
const tyMeta = JSON.parse(readFileSync(join(o.typhoonDir, 'meta.json'), 'utf8'));
const typhoonKst = /KST/.test(tyMeta.files?.info?.timeZone || '');

function seriesCsv(src, code, name, field, series, datumNote) {
  return [
    `# 출처: 국립해양조사원, ${DATASETS[src].title} (data.go.kr ${DATASETS[src].datasetId})`,
    `# 관측소 ${code}(${name}), 단위 cm(문서 명시), 시각 KST(공식 자료와 대조해 확인: data/raw/khoa-2025-26/time-check), 높이 기준면: ${datumNote}`,
    '# qc: 1 응답값 / 3 오류·충돌(값 비움) / 9 응답에 값 없음. 응답에 없는 시각은 행을 만들지 않음',
    `time,${field},qc`,
    ...series.map((p) => `${p.time},${fmtNum(p.value)},${p.flag === 'ok' ? 1 : p.flag === 'missing' ? 9 : 3}`),
  ].join('\n') + '\n';
}

function tideSpec(file, kind, label, code, src, field, datumLabel) {
  return {
    file, adapter: 'csv-tide', kind, label, stationId: code,
    datum: 'UNCONFIRMED', datumLabel, datumConfirmed: false,
    unit: 'cm', intervalMinutes: 60, time: { column: 'time', offset: '+09:00' }, value: { column: field },
    quality: { column: 'qc', ok: ['1'], bad: ['3'], missing: ['9'], labels: { 1: '응답값', 3: '오류·충돌', 9: '값 없음' } },
    missingValues: [''],
    meta: { provider: '국립해양조사원', title: DATASETS[src].title, identifier: `data.go.kr ${DATASETS[src].datasetId}` },
  };
}

// 날마다 관측−예측의 시각 어긋남 검사(보고만): 하루 평균을 뺀 두 곡선의 −6~+6시간 상관
function timeShiftCheck(obs, pred) {
  const P = new Map(pred.series.filter((p) => p.value != null).map((p) => [p.time, p.value]));
  const O = new Map(obs.series.filter((p) => p.value != null).map((p) => [p.time, p.value]));
  const shift = (t, h) => { const d = new Date(Date.parse(`${t.replace(' ', 'T')}:00Z`) + h * 3600e3); return d.toISOString().slice(0, 16).replace('T', ' '); };
  const flags = [];
  const byDay = new Map();
  for (const t of O.keys()) { const d = t.slice(0, 10); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(t); }
  for (const [d, ts] of byDay) {
    if (ts.length < 20) continue;
    const res = [];
    for (let h = -6; h <= 6; h++) {
      const a = [], b = [];
      for (const t of ts) { const v = P.get(shift(t, h)); if (v != null) { a.push(O.get(t)); b.push(v); } }
      if (a.length < 18) continue;
      const ma = a.reduce((x, y) => x + y) / a.length, mb = b.reduce((x, y) => x + y) / b.length;
      let ab = 0, aa = 0, bb = 0;
      for (let i = 0; i < a.length; i++) { ab += (a[i] - ma) * (b[i] - mb); aa += (a[i] - ma) ** 2; bb += (b[i] - mb) ** 2; }
      res.push({ h, r: ab / Math.sqrt(aa * bb || 1) });
    }
    res.sort((x, y) => y.r - x.r);
    const r0 = res.find((x) => x.h === 0);
    if (res[0] && res[0].h !== 0 && Math.abs(res[0].h) >= 2 && res[0].r > 0.8 && (!r0 || res[0].r - r0.r > 0.2)) flags.push({ date: d, bestShiftHours: res[0].h, rBest: +res[0].r.toFixed(3), rZero: r0 ? +r0.r.toFixed(3) : null });
  }
  return flags;
}

const asosInfo = (ps) => (ps.asos ? { name: ps.asos.name, lat: ps.asos.lat, lon: ps.asos.lon, elevation_m: ps.asos.elevation_m, address: ps.asos.address, source: plan.sources.asosStations } : null);
function weatherFor(ps, raw, man, ds, sdir, rel) {
  const so = { raw, station: ps.code, stationName: ps.name, asosStation: ps.asos.stn, weather: 'asos' };
  const w = buildWeather(so, man, ds, { tideStation: { lat: ps.lat, lon: ps.lon }, asosStationInfo: asosInfo(ps) });
  if (!w.source) return null;
  const csv = w.csv.replace('# 시각: 응답 그대로(문서에 시간대 미기재 — KST로 해석)', '# 시각: KST(활용가이드에 표기 없음 — 태양 위치·조위관측소 기압과 대조해 확인: data/raw/khoa-2025-26/time-check)');
  writeFileSync(join(sdir, 'weather.csv'), csv);
  w.spec.file = rel;
  w.spec.station.note = `조위관측소에서 ${ps.asos.distKm} km · 해발 ${ps.asos.elevation_m} m · ${ps.asos.address}`;
  return w;
}

const stations = [];
const report = [];
for (const ps of plan.stations) {
  const so = { raw: o.raw, station: ps.code, stationName: ps.name, minCm: o.minCm, maxCm: o.maxCm };
  const sdir = join(outDir, 'stations', ps.code);
  mkdirSync(sdir, { recursive: true });
  const hourly = loadDataset(so, manifest, 'hourly', dates);
  const forecast = loadDataset(so, manifest, 'forecast', dates);
  const obs = buildSeries(so, hourly, DATASETS.hourly.valueFields.tide_cm, '관측 조위');
  const pred = buildSeries(so, forecast, DATASETS.forecast.valueFields.pred_cm, '예측 조위');
  const obsComp = hourlyCompleteness(obs.series, dates, hourly.days);
  const predComp = hourlyCompleteness(pred.series, dates, forecast.days);
  const predDatum = `조석표 기준면(${TIDE_TABLE_DATUM[ps.code] || '미확인'})과 같은 값`;
  writeFileSync(join(sdir, 'observed.csv'), seriesCsv('hourly', ps.code, ps.name, 'tide_cm', obs.series, '문서에 없음(미확인)'));
  writeFileSync(join(sdir, 'predicted.csv'), seriesCsv('forecast', ps.code, ps.name, 'pred_cm', pred.series, predDatum));
  const shifts = timeShiftCheck(obs, pred);
  // 10분 간격 예측(받은 달만, 대표 관측소): 정시 값이 1시간 예측과 같은지 확인
  let pred10 = null;
  const f10 = loadDataset(so, manifest, 'forecast10', dates);
  if (f10.rows.length) {
    pred10 = buildSeries(so, f10, DATASETS.forecast10.valueFields.pred_cm, '예측 조위(10분)');
    const P = new Map(pred.series.map((p) => [p.time, p.value]));
    let n = 0, mx = 0;
    for (const p of pred10.series) if (p.time.endsWith(':00') && P.has(p.time) && p.value != null) { n++; mx = Math.max(mx, Math.abs(p.value - P.get(p.time))); }
    pred10.check = { comparedHours: n, maxDiffCm: Math.round(mx * 1000) / 1000 };
    pred10.months = [...new Set(pred10.series.filter((p) => p.value != null).map((p) => p.time.slice(0, 7)))].sort();
    writeFileSync(join(sdir, 'predicted10.csv'), seriesCsv('forecast10', ps.code, ps.name, 'pred_cm', pred10.series, predDatum).replace('time,pred_cm,qc', `# 10분 간격(min=10). 받은 달: ${pred10.months.join(', ')} · 정시 값과 1시간 예측 비교 ${n}개, 최대 차 ${pred10.check.maxDiffCm} cm\ntime,pred_cm,qc`));
  }
  const w = ps.code === REP ? weatherFor(ps, o.raw, manifest, dates, sdir, `stations/${ps.code}/weather.csv`) : null;
  stations.push({
    id: ps.code, name: ps.name, nameEn: ps.nameEn, sea: ps.sea, lat: ps.lat, lon: ps.lon, note: ps.note,
    datasets: {
      observed: tideSpec(`stations/${ps.code}/observed.csv`, 'observed', '관측 조위', ps.code, 'hourly', 'tide_cm', '미확인(문서에 없음)'),
      predicted: tideSpec(`stations/${ps.code}/predicted.csv`, 'predicted', '예측 조위', ps.code, 'forecast', 'pred_cm', `조석표 기준면(${TIDE_TABLE_DATUM[ps.code] || '미확인'})`),
      weather: w ? w.spec : { provided: false },
      ...(pred10 ? { predicted10: { ...tideSpec(`stations/${ps.code}/predicted10.csv`, 'predicted', '예측 조위(10분 간격)', ps.code, 'forecast10', 'pred_cm', `조석표 기준면(${TIDE_TABLE_DATUM[ps.code] || '미확인'})`), intervalMinutes: 10, months: pred10.months } } : {}),
    },
    timeShiftFlags: shifts,
  });
  report.push({ pred10: pred10 ? { months: pred10.months, ...pred10.check } : null, code: ps.code, name: ps.name, sea: ps.sea, obs: obsComp, pred: predComp, obsIssues: obs.issues.length, predIssues: pred.issues.length, shifts, weather: w ? { station: w.station.name, completeness: w.completeness } : null });
}

// 부산 2022년 9월(관측 조위·기상·태풍)
const busan = plan.stations.find((s) => s.code === REP);
const pdir = join(outDir, 'past', 'DT_0005-2022-09');
mkdirSync(pdir, { recursive: true });
const so22 = { raw: o.raw22, station: REP, stationName: busan.name, minCm: o.minCm, maxCm: o.maxCm };
const hourly22 = loadDataset(so22, manifest22, 'hourly', dates22);
const obs22 = buildSeries(so22, hourly22, DATASETS.hourly.valueFields.tide_cm, '관측 조위');
const obs22Comp = hourlyCompleteness(obs22.series, dates22, hourly22.days);
writeFileSync(join(pdir, 'observed.csv'), seriesCsv('hourly', REP, busan.name, 'tide_cm', obs22.series, '문서에 없음(미확인)'));
const w22 = weatherFor(busan, o.raw22, manifest22, dates22, pdir, 'past/DT_0005-2022-09/weather.csv');
// 태풍(실황 분석 위치, KST)
const trackSrc = readFileSync(join(o.typhoonDir, 'typhoon_analysis_kst.csv'), 'utf8');
writeFileSync(join(pdir, 'typhoon_track.csv'), trackSrc);
// 기간별 태풍 확인용 경로(기상청 태풍경로 CSV, 시각은 UTC로 해석 → KST로 바꿔 저장). 거리 확인에만 쓴다.
const typhoonTracks = [];
for (const dir of [join(ROOT, 'data', 'raw', 'kma', 'typhoon', '2022-09-check'), o.typhoonCheck]) {
  const m = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  for (const t of m.typhoons) {
    const pts = readFileSync(join(dir, t.file), 'utf8').trim().split('\n').slice(1).map((l) => l.split(',')).filter((r) => r.length > 4).map((r) => {
      const k = new Date(Date.parse(`${r[2].replace(' ', 'T')}:00Z`) + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
      return [k, Number(r[3].replace('N', '')), Number(r[4].replace('E', ''))];
    });
    typhoonTracks.push({ name: t.name, points: pts, source: `${dir.replace(ROOT + '/', '')}/${t.file}` });
  }
}

// 달의 위상(계산값, KST)
const KST = 9 * 3600e3;
const NAMES = { new: '삭', first: '상현', full: '망', last: '하현' };
const iso = (t) => new Date(Math.round(t / 60000) * 60000 + KST).toISOString().slice(0, 16).replace('T', ' ');
const phases = [
  ...moonPhasesBetween(Date.parse('2022-08-10T00:00:00Z'), Date.parse('2022-10-20T00:00:00Z')),
  ...moonPhasesBetween(Date.parse('2025-09-10T00:00:00Z'), Date.parse('2026-10-20T00:00:00Z')),
];
writeFileSync(join(outDir, 'moon.csv'), ['# 달의 위상 시각(KST): Meeus 계산식으로 계산한 값(오차 약 1~2분). 공식 자료(한국천문연구원)로 확인·교체 권장', 'time,phase,lunar',
  ...phases.map((p) => `${iso(p.t)},${NAMES[p.phase]},`)].join('\n') + '\n');

// 기본 탐구 1 구간: 분석 연월 안에서 고른다(3일 + 그 안의 24시간 세는 구간). 세는 구간의 경계 ±1.5시간에 극값이 없게 한다.
function extremes(series, t0, t1) {
  const pts = series.filter((p) => p.value != null && p.time >= t0 && p.time < t1);
  const out = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1].value, b = pts[i].value, c = pts[i + 1].value;
    if ((b > a && b >= c) || (b < a && b <= c)) out.push(pts[i].time);
  }
  return out;
}
function defaultWindows(month) {
  const pred = readFileSync(join(outDir, 'stations', REP, 'predicted.csv'), 'utf8').split('\n').filter((l) => /^\d{4}-/.test(l)).map((l) => l.split(',')).map((r) => ({ time: r[0], value: r[1] === '' ? null : Number(r[1]) }));
  const d0 = `${month}-10`;
  const start = `${d0} 00:00`, end = `${addDays(d0, 3)} 00:00`;
  const ex = extremes(pred, start, end).map((t) => Date.parse(`${t.replace(' ', 'T')}:00Z`));
  let best = null;
  for (let h = 24; h <= 24 + 12; h++) {
    const c0 = Date.parse(`${d0}T00:00:00Z`) + h * 3600e3, c1 = c0 + 24 * 3600e3;
    const near = Math.min(...ex.map((t) => Math.min(Math.abs(t - c0), Math.abs(t - c1)))) / 3600e3;
    if (!best || near > best.near) best = { c0, near };
  }
  const f = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
  return { inq1: { start, end, count: { start: f(best.c0), end: f(best.c0 + 24 * 3600e3) } }, inq2: { start, end } };
}
const win = defaultWindows(DEFAULTS.month);

const tzItems = tzCheck ? tzCheck.results : [];
const tzConfirmed = !!tzCheck?.confirmed && typhoonKst;
const builtAt = new Date().toISOString();
const months = [];
for (let d = plan.period.start; d <= plan.period.end; d = addDays(`${d.slice(0, 7)}-28`, 5).slice(0, 7) + '-01') months.push(d.slice(0, 7));

const caseJson = {
  formatVersion: 3,
  kind: 'tide-assessment',
  id: o.caseId,
  dataVersion: `${o.caseId}-${builtAt.slice(0, 10)}`,
  isSample: false,
  title: '조석 수행평가 · 인천·부산·묵호 2025년 10월~2026년 9월 + 부산 2022년 9월',
  timezone: { label: 'KST', name: '한국 표준시(UTC+9)', offsetMinutes: 540 },
  timeBasis: {
    confirmed: tzConfirmed,
    checkedAt: tzCheck?.checkedAt || null,
    evidence: 'data/raw/khoa-2025-26/time-check/README.md',
    tide: !!tzCheck?.confirmed, weather: !!tzCheck?.confirmed, typhoon: typhoonKst,
    note: tzConfirmed
      ? '조위(예측·관측)는 국립해양조사원 조석표(시각 9hE)·바다누리 관측값과, ASOS는 태양 위치·조위관측소 기압과 대조해 KST로 확인. 태풍 시각은 기상자료개방포털 안내(KST).'
      : '시간대가 확인되지 않은 자료가 있어 시각 비교 기능을 켜지 않습니다.',
    items: tzItems.map((r) => ({ item: r.item, ok: r.ok })),
  },
  representative: REP,
  period: plan.period,
  months,
  stations,
  past: {
    id: 'DT_0005-2022-09',
    stationId: REP,
    label: `${busan.name} 2022년 9월`,
    period: PAST,
    datasets: {
      observed: tideSpec('past/DT_0005-2022-09/observed.csv', 'observed', '관측 조위', REP, 'hourly', 'tide_cm', '미확인(문서에 없음)'),
      weather: w22 ? w22.spec : { provided: false },
      typhoon: {
        name: '힌남노(HINNAMNOR)', year: 2022, label: tyMeta.typhoon,
        note: '경로는 기상청 태풍정보의 실황 분석 위치(예보 아님). 시각 KST(기상자료개방포털 안내).',
        track: { file: 'past/DT_0005-2022-09/typhoon_track.csv', kind: '실황 분석 위치(기상청 태풍정보)', time: { column: 'time', offset: '+09:00' }, latColumn: 'lat', lonColumn: 'lon', pressureColumn: 'pressure_hpa', windColumn: 'max_wind_ms', note: '기상청이 발표 때마다 분석한 태풍 중심 위치(예보시간 0). 예보 경로·베스트트랙 아님' },
        meta: { provider: '기상청 기상자료개방포털(data.kma.go.kr) 태풍정보', title: `${tyMeta.typhoon} 태풍정보(실황 분석)`, identifier: `KMA typhoon 2022-11, 수집 ${tyMeta.fetchedAt.slice(0, 10)}` },
      },
    },
  },
  typhoonTracks: {
    note: '기상청 기상자료개방포털 태풍경로(CSV). 파일에 시간대 표기가 없어 UTC로 해석해 KST로 바꿈(제11호 힌남노 위치를 태풍정보 KST와 맞춰 확인). 기간 확인은 앞뒤 하루를 포함해 거리만 봄',
    tracks: typhoonTracks,
  },
  moonPhases: { file: 'moon.csv', adapter: 'csv-moon', time: { column: 'time', offset: '+09:00' }, phaseColumn: 'phase', lunarColumn: 'lunar', meta: { provider: 'Meeus 계산식으로 계산한 값(공식 자료 아님)', title: '달의 위상 시각(계산값)', identifier: 'moon-calc-meeus' } },
  defaults: {
    month: DEFAULTS.month,
    inq1: win.inq1,
    inq2: win.inq2,
    inq4: { a: { start: `${DEFAULTS.inq4.a[0]} 00:00`, end: `${DEFAULTS.inq4.a[1]} 00:00` }, b: { start: `${DEFAULTS.inq4.b[0]} 00:00`, end: `${DEFAULTS.inq4.b[1]} 00:00` } },
  },
  description: {
    provider: '국립해양조사원(KHOA)·기상청(KMA), 공공데이터포털 오픈API 및 기상자료개방포털',
    period: `${plan.period.start} ~ ${plan.period.end} (부산 과거 비교: ${PAST.start} ~ ${PAST.end})`,
    interval: '1시간',
    predictedText: '해당 지역의 조석 특성과 달·태양의 주기적인 영향을 바탕으로 계산한 해수면 높이입니다.',
    datumNote: '관측 조위의 높이 기준면은 자료 문서에 없어 확인되지 않았습니다. 관측소마다 기준면이 달라 조위 숫자로 지역끼리 해수면 높낮이를 비교할 수 없습니다.',
    identifier: `${o.caseId} (변환 ${builtAt.slice(0, 10)})`,
  },
};
writeFileSync(join(outDir, 'case.json'), JSON.stringify(caseJson, null, 1) + '\n');

// 보고서
const pct = (c) => `${c.valid}/${c.expected}`;
const wx = (w) => (w ? Object.values(w.completeness).map((c) => `${c.label} ${c.valid}/${c.expected}`).join(', ') : '—');
const md = `# 자료 확보 현황 — ${o.caseId}

- 만든 시각: ${builtAt}
- 기간: ${plan.period.start} ~ ${plan.period.end} (${dates.length}일), 부산 과거 비교 ${PAST.start} ~ ${PAST.end}
- 시간대: ${tzConfirmed ? 'KST 확인' : '확인 안 됨 — 시각 비교 기능 끔'} (${caseJson.timeBasis.evidence})

| 관측소 | 해역 | 관측 조위 | 예측 조위 | 시각 어긋남 의심(날짜) | 기상(ASOS) |
|---|---|---|---|---|---|
${report.map((r) => `| ${r.code} ${r.name} | ${r.sea} | ${pct(r.obs)} | ${pct(r.pred)} | ${r.shifts.length ? r.shifts.map((s) => `${s.date}(${s.bestShiftHours > 0 ? '+' : ''}${s.bestShiftHours}h)`).join(', ') : '없음'} | ${r.weather ? `${r.weather.station}: ${wx(r.weather)}` : '—'} |`).join('\n')}
| ${REP} 부산 2022-09 | 남해 | ${pct(obs22Comp)} | — | — | ${w22 ? `${w22.station.name}: ${wx(w22)}` : '—'} |

${report.filter((r) => r.pred10).map((r) => `- ${r.code} ${r.name} 10분 간격 예측: ${r.pred10.months.join(', ')} (정시 값 ${r.pred10.comparedHours}개를 1시간 예측과 비교, 최대 차 ${r.pred10.maxDiffCm} cm)`).join('\n')}
- 시각 어긋남 의심: 날마다 하루 평균을 뺀 관측·예측 곡선의 상관이 0시간이 아닌 곳(2시간 이상)에서 뚜렷이 커지는 날. 표시만 하고 시각은 고치지 않습니다.
- 결측은 채우지 않았습니다.
`;
writeFileSync(join(outDir, 'availability.md'), md);

const regPath = join(o.casesDir, 'index.json');
const reg = existsSync(regPath) ? JSON.parse(readFileSync(regPath, 'utf8')) : { formatVersion: 1, defaultCase: o.caseId, cases: [] };
reg.cases = reg.cases.filter((c) => c.id !== o.caseId);
reg.cases.unshift({ id: o.caseId, path: o.caseId, label: '조석 수행평가 · 인천·부산·묵호 2025-10~2026-09 + 부산 2022-09 (국립해양조사원·기상청 자료)', enabled: true, sample: false });
if (o.setDefault) reg.defaultCase = o.caseId;
writeFileSync(regPath, JSON.stringify(reg, null, 2) + '\n');
console.log(`사례: ${relative(ROOT, outDir)}/`);
console.log(md);

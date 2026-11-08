#!/usr/bin/env node
// 수집한 원본 응답(data/raw/khoa) → 웹앱 사례 파일(data/cases/<사례>/) + 품질 보고서
//
//   node tools/khoa/build-case.mjs --start 2022-09-01 --end 2022-09-30
//   node tools/khoa/build-case.mjs --start 2022-09-01 --end 2022-09-30 --set-default   (학생 앱의 기본 사례로 지정)
//
// 원칙
//  - 응답에 없는 값은 만들지 않는다(0이나 예시값으로 채우지 않음). 결측은 빈 칸으로 둔다.
//  - 같은 시각 중복: 값이 같으면 하나만, 다르면 그 시각을 '충돌'로 표시하고 값을 비운다.
//  - 문서·응답으로 확인할 수 없는 정보(높이 기준면, 시간대 등)는 '미확인'으로 표시한다.
//  - 기준면이 확인되지 않으면 웹앱에서 잔차(관측 − 예측)를 계산하지 않도록 datumConfirmed:false로 기록한다.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATASETS, parseResponse, dateRange } from './khoa-api.mjs';
import { moonPhasesBetween } from '../lib/moon.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function parseArgs(argv) {
  const o = {
    raw: join(ROOT, 'data', 'raw', 'khoa'), casesDir: join(ROOT, 'data', 'cases'), station: 'DT_0005', stationName: '부산', start: null, end: null,
    caseId: null, observed: 'auto', predicted: 'auto', setDefault: false, typhoon: '힌남노(HINNAMNOR)', typhoonYear: 2022,
    minCm: -300, maxCm: 1500,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => argv[++i];
    if (a === '--raw') o.raw = v();
    else if (a === '--cases-dir') o.casesDir = v(); // 검증용
    else if (a === '--station') o.station = v();
    else if (a === '--station-name') o.stationName = v();
    else if (a === '--start') o.start = v();
    else if (a === '--end') o.end = v();
    else if (a === '--case-id') o.caseId = v();
    else if (a === '--observed') o.observed = v();
    else if (a === '--predicted') o.predicted = v();
    else if (a === '--set-default') o.setDefault = true;
    else if (a === '--typhoon') o.typhoon = v();
    else if (a === '--typhoon-year') o.typhoonYear = Number(v());
    else if (a === '--inq1') o.inq1 = v(); // 예: 2022-09-13,2022-09-16
    else if (a === '--inq3') o.inq3 = v(); // 예: 2022-09-04,2022-09-08
    else throw new Error(`알 수 없는 옵션: ${a}`);
  }
  if (!o.start || !o.end) throw new Error('--start, --end가 필요합니다.');
  o.caseId = o.caseId || `khoa-${o.station.toLowerCase().replace('_', '')}-${o.start.slice(0, 7)}`;
  return o;
}

// ───────── 원본 읽기 ─────────
function loadDataset(o, manifest, dsKey, dates) {
  const ds = DATASETS[dsKey];
  const days = {};
  const rows = [];
  for (const date of dates) {
    const st = manifest.requests[`${dsKey}|${o.station}|${date}`];
    days[date] = st ? st.status : 'not-collected';
    if (!st || st.status !== 'ok') continue;
    for (const f of st.files || []) {
      const page = JSON.parse(readFileSync(join(o.raw, f), 'utf8'));
      const r = parseResponse(page.rawText);
      if (!r.ok) continue;
      for (const it of r.items) rows.push({ date, page: f, item: it });
    }
  }
  return { ds, days, rows };
}

function canonicalTime(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(s || '').trim());
  if (!m) return null;
  return { key: `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`, sec: m[6] ? Number(m[6]) : 0, minute: Number(m[5]) };
}

function numOrNull(v) {
  if (v == null) return { v: null, bad: false };
  const s = String(v).trim();
  if (s === '' || s === '-' || s.toLowerCase() === 'null') return { v: null, bad: false };
  const n = Number(s);
  return Number.isFinite(n) ? { v: n, bad: false } : { v: null, bad: true };
}

/** 시계열 정리 + 품질 점검 */
function buildSeries(o, loaded, field, label) {
  const { ds, rows } = loaded;
  const issues = [];
  const byTime = new Map();
  const names = new Map();
  const coords = new Map();
  for (const { date, item } of rows) {
    names.set(item.obsvtrNm, (names.get(item.obsvtrNm) || 0) + 1);
    if (item.lat != null && item.lot != null) coords.set(`${item.lat},${item.lot}`, (coords.get(`${item.lat},${item.lot}`) || 0) + 1);
    const ct = canonicalTime(item[ds.timeField]);
    if (!ct) { issues.push({ type: '시각 형식 오류', detail: `${date}: "${item[ds.timeField]}"` }); continue; }
    if (!ct.key.startsWith(date)) issues.push({ type: '요청일과 다른 날짜', detail: `${date} 요청 → ${ct.key}` });
    if (ct.sec !== 0) issues.push({ type: '초 단위 시각', detail: ct.key + `:${ct.sec}` });
    const { v, bad } = numOrNull(item[field]);
    let value = v, flag = v == null ? 'missing' : 'ok';
    if (bad) { flag = 'error'; issues.push({ type: '숫자가 아닌 값', detail: `${ct.key}: "${item[field]}"` }); }
    if (value != null && (value < o.minCm || value > o.maxCm)) {
      issues.push({ type: '허용 범위 밖 값(오류값으로 처리)', detail: `${ct.key}: ${value} cm` });
      value = null; flag = 'error';
    }
    const prev = byTime.get(ct.key);
    if (prev) {
      if (prev.value === value) { issues.push({ type: '중복(같은 값, 하나만 사용)', detail: ct.key }); continue; }
      issues.push({ type: '중복(값 충돌, 결측 처리)', detail: `${ct.key}: ${prev.value} / ${value}` });
      byTime.set(ct.key, { time: ct.key, value: null, flag: 'conflict', minute: ct.minute });
      continue;
    }
    byTime.set(ct.key, { time: ct.key, value, flag, minute: ct.minute });
  }
  const series = [...byTime.values()].sort((a, b) => (a.time < b.time ? -1 : 1));
  return { label, field, series, issues, names: Object.fromEntries(names), coords: Object.fromEntries(coords) };
}

function hourlyCompleteness(series, dates, dayStatus) {
  const have = new Map(series.map((p) => [p.time, p]));
  const missingTimes = [];
  const offHour = series.filter((p) => p.minute !== 0).map((p) => p.time);
  let expected = 0, valid = 0;
  for (const d of dates) {
    for (let h = 0; h < 24; h++) {
      const t = `${d} ${String(h).padStart(2, '0')}:00`;
      expected++;
      const p = have.get(t);
      if (p && p.value != null) valid++;
      else missingTimes.push({ t, reason: !p ? (dayStatus[d] === 'ok' ? '응답에 없음' : `수집 상태: ${dayStatus[d]}`) : p.flag === 'conflict' ? '중복 값 충돌' : p.flag === 'error' ? '오류값' : '값 없음' });
    }
  }
  // 연속 구간으로 묶기
  const ranges = [];
  for (const m of missingTimes) {
    const last = ranges[ranges.length - 1];
    const prevT = last && new Date(last.to.replace(' ', 'T') + 'Z').getTime();
    const curT = new Date(m.t.replace(' ', 'T') + 'Z').getTime();
    if (last && curT - prevT === 3600e3 && last.reason === m.reason) { last.to = m.t; last.hours++; } else ranges.push({ from: m.t, to: m.t, hours: 1, reason: m.reason });
  }
  return { expected, valid, missing: missingTimes.length, ranges, offHour };
}

function addDays(d, n) { return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10); }
/** 탐구 구간: 지정값 → 기본값(기간 안일 때) → 기간 첫 n일 */
function pickRange(arg, dflt, dates, n) {
  const [a, b] = arg ? arg.split(',') : dflt;
  if (dates.includes(a) && (dates.includes(b) || b === addDays(dates[dates.length - 1], 1))) return { start: `${a} 00:00`, end: `${b} 00:00` };
  return { start: `${dates[0]} 00:00`, end: `${addDays(dates[0], Math.min(n, dates.length))} 00:00` };
}

function fmtNum(v) { return v == null ? '' : String(Math.round(v * 100) / 100); }

function main() {
  const o = parseArgs(process.argv.slice(2));
  const mPath = join(o.raw, 'manifest.json');
  if (!existsSync(mPath)) {
    console.error(`수집 기록(${relative(ROOT, mPath)})이 없습니다. 먼저 tools/khoa/collect.mjs로 자료를 수집하세요.`);
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(mPath, 'utf8'));
  const dates = dateRange(o.start, o.end);
  const loaded = {};
  for (const k of Object.keys(DATASETS)) loaded[k] = loadDataset(o, manifest, k, dates);
  const hasRows = (k) => loaded[k].rows.length > 0;

  // 관측: 품질처리된 1시간 조위(조석성과) 우선, 없으면 실시간 실측(품질처리 전)
  const obsSrc = o.observed !== 'auto' ? o.observed : hasRows('hourly') ? 'hourly' : hasRows('realtime') ? 'realtime' : null;
  // 예측: 조석예보(시계열) 우선, 없으면 실시간 응답의 예측 조위
  const predSrc = o.predicted !== 'auto' ? o.predicted : hasRows('forecast') ? 'forecast' : hasRows('realtime') ? 'realtime' : null;
  if (!obsSrc || !hasRows(obsSrc)) {
    console.error('관측 조위 원본 자료가 없습니다. 사례 파일을 만들지 않습니다(값을 만들어 채우지 않음).');
    console.error('수집 상태:', JSON.stringify(Object.fromEntries(Object.keys(DATASETS).map((k) => [k, loaded[k].days])), null, 1));
    process.exit(3);
  }
  const obs = buildSeries(o, loaded[obsSrc], DATASETS[obsSrc].valueFields.tide_cm, '관측 조위');
  const pred = predSrc && hasRows(predSrc) ? buildSeries(o, loaded[predSrc], DATASETS[predSrc].valueFields.pred_cm, '예측 조위') : null;
  const obsComp = hourlyCompleteness(obs.series, dates, loaded[obsSrc].days);
  const predComp = pred ? hourlyCompleteness(pred.series, dates, loaded[predSrc].days) : null;

  // 관측소 확인
  const stationCheck = {
    requestedCode: o.station, expectedName: o.stationName,
    observedNames: obs.names, predictedNames: pred?.names || null,
    nameMatches: Object.keys(obs.names).every((n) => n === o.stationName) && (!pred || Object.keys(pred.names).every((n) => n === o.stationName)),
    observedCoords: obs.coords, predictedCoords: pred?.coords || null,
  };
  const [latS, lonS] = (Object.entries(obs.coords).sort((a, b) => b[1] - a[1])[0]?.[0] || ',').split(',');
  const lat = latS ? Number(latS) : null, lon = lonS ? Number(lonS) : null;

  // 관측·예측 시각 대조(정확히 같은 시각만)
  let alignment = null;
  if (pred) {
    const pm = new Map(pred.series.map((p) => [p.time, p]));
    const both = obs.series.filter((p) => p.value != null && pm.get(p.time)?.value != null);
    const obsOnly = obs.series.filter((p) => !pm.has(p.time)).length;
    const predOnly = pred.series.filter((p) => !obs.series.some((q) => q.time === p.time)).length;
    const diffs = both.map((p) => p.value - pm.get(p.time).value);
    const mean = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null;
    alignment = {
      sameTimeBothValid: both.length, obsOnlyTimes: obsOnly, predOnlyTimes: predOnly,
      meanObsMinusPred_cm_referenceOnly: mean == null ? null : Math.round(mean * 10) / 10,
      note: '평균 차이는 참고 지표일 뿐이며 기준면 일치를 증명하지 않는다. 기준면이 문서로 확인되기 전에는 잔차를 계산하지 않는다.',
    };
  }

  // ───────── 파일 쓰기 ─────────
  const outDir = join(o.casesDir, o.caseId);
  mkdirSync(outDir, { recursive: true });
  const srcLine = (k) => `${DATASETS[k].title} (data.go.kr ${DATASETS[k].datasetId})`;
  writeFileSync(join(outDir, 'observed.csv'), [
    `# 출처: 국립해양조사원, ${srcLine(obsSrc)}`,
    `# 관측소 ${o.station}(${o.stationName}), 단위 cm(문서 명시), 시각: 응답 그대로(시간대 미확인 — KST로 해석), 높이 기준면: 미확인`,
    '# qc: 1 응답값 / 3 오류·충돌(값 비움) / 9 응답에 값 없음. 응답에 아예 없는 시각은 행을 만들지 않음',
    'time,tide_cm,qc',
    ...obs.series.map((p) => `${p.time},${fmtNum(p.value)},${p.flag === 'ok' ? 1 : p.flag === 'missing' ? 9 : 3}`),
  ].join('\n') + '\n');
  if (pred) {
    writeFileSync(join(outDir, 'predicted.csv'), [
      `# 출처: 국립해양조사원, ${srcLine(predSrc)}`,
      `# 예보지점 ${o.station}(${o.stationName}), 단위 cm(문서 명시), 시각: 응답 그대로(시간대 미확인 — KST로 해석), 높이 기준면: 미확인`,
      'time,pred_cm,qc',
      ...pred.series.map((p) => `${p.time},${fmtNum(p.value)},${p.flag === 'ok' ? 1 : p.flag === 'missing' ? 9 : 3}`),
    ].join('\n') + '\n');
  }
  // 달의 위상(계산값)
  const KST = 9 * 3600e3;
  const t0 = Date.parse(`${o.start}T00:00:00Z`) - KST - 20 * 86400e3;
  const t1 = Date.parse(`${o.end}T00:00:00Z`) - KST + 20 * 86400e3;
  const NAMES = { new: '삭', first: '상현', full: '망', last: '하현' };
  const iso = (t) => new Date(Math.round(t / 60000) * 60000 + KST).toISOString().slice(0, 16).replace('T', ' ');
  writeFileSync(join(outDir, 'moon.csv'), [
    '# 달의 위상 시각(KST): Meeus 계산식으로 계산한 값(오차 약 1~2분). 공식 자료(한국천문연구원 월력요항)로 확인·교체 권장',
    'time,phase,lunar',
    ...moonPhasesBetween(t0, t1).map((p) => `${iso(p.t)},${NAMES[p.phase]},`),
  ].join('\n') + '\n');

  const quality = {
    format: 'khoa-case-quality', builtAt: new Date().toISOString(), caseId: o.caseId,
    period: { start: o.start, end: o.end, days: dates.length },
    sources: { observed: obsSrc && { dataset: obsSrc, title: DATASETS[obsSrc].title, datasetId: DATASETS[obsSrc].datasetId, page: DATASETS[obsSrc].pageUrl }, predicted: predSrc && { dataset: predSrc, title: DATASETS[predSrc].title, datasetId: DATASETS[predSrc].datasetId, page: DATASETS[predSrc].pageUrl } },
    collectionStatus: Object.fromEntries(Object.keys(DATASETS).map((k) => [k, loaded[k].days])),
    station: stationCheck,
    observed: { rows: obs.series.length, ...obsComp, issues: obs.issues },
    predicted: pred ? { rows: pred.series.length, ...predComp, issues: pred.issues } : '자료 없음',
    alignment,
    metadata: {
      unit: 'cm (API 활용가이드 명시)',
      timeZone: '미확인 — API 문서에 시간대가 적혀 있지 않음. 앱에서는 KST(UTC+9)로 해석',
      datum: '미확인 — API 문서에 높이 기준면이 적혀 있지 않음. 바다누리 내려받기 안내: "조석기준면 결정 전 자료는 참고용으로만 사용"',
      residual: '기준면 미확인이므로 웹앱에서 잔차를 계산하지 않음(case.json datumConfirmed:false)',
      moonPhases: '계산값(Meeus) — 공식 자료 아님',
    },
  };
  writeFileSync(join(outDir, 'quality-report.json'), JSON.stringify(quality, null, 1));

  const pct = (c) => `${c.valid}/${c.expected}시간 (${((c.valid / c.expected) * 100).toFixed(1)}%)`;
  const rangesMd = (c) => (c.ranges.length ? c.ranges.map((r) => `  - ${r.from} ~ ${r.to} (${r.hours}시간, ${r.reason})`).join('\n') : '  - 없음');
  const issuesMd = (iss) => {
    if (!iss.length) return '  - 없음';
    const g = {};
    for (const i of iss) (g[i.type] = g[i.type] || []).push(i.detail);
    return Object.entries(g).map(([k, v]) => `  - ${k}: ${v.length}건 (${v.slice(0, 5).join('; ')}${v.length > 5 ? ' …' : ''})`).join('\n');
  };
  writeFileSync(join(outDir, 'quality-report.md'), `# 자료 품질 보고서 — ${o.caseId}

- 만든 시각: ${quality.builtAt}
- 기간: ${o.start} ~ ${o.end} (${dates.length}일), 관측소 ${o.station}(${o.stationName})
- 관측 조위 출처: ${obsSrc ? srcLine(obsSrc) : '없음'}
- 예측 조위 출처: ${predSrc ? srcLine(predSrc) : '없음'}

## 관측소 확인
- 응답의 관측소명(관측): ${JSON.stringify(obs.names)}
- 응답의 관측소명(예측): ${pred ? JSON.stringify(pred.names) : '—'}
- 요청한 이름(${o.stationName})과 일치: ${stationCheck.nameMatches ? '예' : '아니오 — 확인 필요'}
- 좌표(응답): ${JSON.stringify(obs.coords)}

## 관측 조위
- 확보: ${pct(obsComp)}, 응답 행 ${obs.series.length}
- 누락 구간:
${rangesMd(obsComp)}
- 점검 결과:
${issuesMd(obs.issues)}
${obsComp.offHour.length ? `- 정시가 아닌 시각: ${obsComp.offHour.length}건` : ''}

## 예측 조위
${pred ? `- 확보: ${pct(predComp)}, 응답 행 ${pred.series.length}
- 누락 구간:
${rangesMd(predComp)}
- 점검 결과:
${issuesMd(pred.issues)}` : '- 자료 없음'}

## 관측·예측 대조
${alignment ? `- 같은 시각에 두 값이 모두 있는 시각: ${alignment.sameTimeBothValid}
- 관측에만 있는 시각: ${alignment.obsOnlyTimes}, 예측에만 있는 시각: ${alignment.predOnlyTimes}
- (참고) 관측 − 예측 평균: ${alignment.meanObsMinusPred_cm_referenceOnly} cm — 기준면 일치의 증거가 아님` : '- 예측 자료가 없어 대조하지 않음'}

## 확인하지 못한 정보
- 시간대: ${quality.metadata.timeZone}
- 높이 기준면: ${quality.metadata.datum}
- 따라서 잔차(관측 − 예측)는 계산하지 않음. 기준면을 공식 문서로 확인하면 case.json의 datumConfirmed를 true로 바꾸고 근거를 description.datumSource에 적는다.
- 달의 위상: ${quality.metadata.moonPhases}
- 태풍 경로·주요 시각, 기상(기압·바람) 자료: 아직 넣지 않음
`);

  // case.json
  const caseJson = {
    formatVersion: 1,
    id: o.caseId,
    dataVersion: `${o.caseId}-${quality.builtAt.slice(0, 10)}`,
    isSample: false,
    title: `${o.stationName} ${o.start.slice(0, 7).replace('-', '년 ')}월 · 태풍 ${o.typhoon}`,
    timezone: { label: 'KST', name: '한국 표준시(UTC+9) — API 문서에 시간대 미기재(미확인), KST로 해석', offsetMinutes: 540 },
    station: { id: o.station, name: o.stationName, lat, lon, note: '좌표는 API 응답값' },
    description: {
      provider: '국립해양조사원(KHOA), 공공데이터포털 오픈API',
      title: [srcLine(obsSrc), predSrc ? srcLine(predSrc) : null].filter(Boolean).join(' / '),
      period: `${o.start} ~ ${o.end}`,
      interval: '1시간',
      datumLabel: '미확인(API 문서에 높이 기준면 미기재)',
      datumSource: '',
      identifier: `${o.caseId} (수집 ${quality.builtAt.slice(0, 10)})`,
    },
    datasets: {
      observed: {
        file: 'observed.csv', adapter: 'csv-tide', kind: 'observed', label: '관측 조위', stationId: o.station,
        datum: 'UNCONFIRMED', datumLabel: '미확인', datumConfirmed: false,
        unit: 'cm', intervalMinutes: 60, time: { column: 'time', offset: '+09:00' }, value: { column: 'tide_cm' },
        quality: { column: 'qc', ok: ['1'], bad: ['3'], missing: ['9'], labels: { 1: '응답값', 3: '오류·충돌', 9: '값 없음' } },
        missingValues: [''],
        meta: { provider: '국립해양조사원', title: srcLine(obsSrc), identifier: `data.go.kr ${DATASETS[obsSrc].datasetId}` },
      },
      predicted: pred ? {
        file: 'predicted.csv', adapter: 'csv-tide', kind: 'predicted', label: '천문조 예측 조위', stationId: o.station,
        datum: 'UNCONFIRMED', datumLabel: '미확인', datumConfirmed: false,
        unit: 'cm', intervalMinutes: 60, time: { column: 'time', offset: '+09:00' }, value: { column: 'pred_cm' },
        quality: { column: 'qc', ok: ['1'], bad: ['3'], missing: ['9'] },
        missingValues: [''],
        meta: { provider: '국립해양조사원', title: srcLine(predSrc), identifier: `data.go.kr ${DATASETS[predSrc].datasetId}` },
      } : { provided: false },
      weather: { provided: false },
      moonPhases: {
        file: 'moon.csv', adapter: 'csv-moon', time: { column: 'time', offset: '+09:00' }, phaseColumn: 'phase', lunarColumn: 'lunar',
        meta: { provider: 'Meeus 계산식으로 계산한 값(공식 자료 아님, 한국천문연구원 자료로 확인 권장)', title: '달의 위상 시각(계산값)', identifier: 'moon-calc-meeus' },
      },
      typhoon: { name: o.typhoon, year: o.typhoonYear, note: '태풍 경로와 주요 시각은 아직 넣지 않았습니다. 기상청 태풍 정보를 확인해 교사가 입력하세요.' },
    },
    inquiry1: pickRange(o.inq1, ['2022-09-13', '2022-09-16'], dates, 3),
    inquiry2: { start: `${o.start} 00:00`, end: `${addDays(o.end, 1)} 00:00` },
    inquiry3: { ...pickRange(o.inq3, ['2022-09-04', '2022-09-08'], dates, 5), keyTimes: [] },
  };
  writeFileSync(join(outDir, 'case.json'), JSON.stringify(caseJson, null, 2) + '\n');

  // 사례 목록 등록
  const regPath = join(o.casesDir, 'index.json');
  const reg = existsSync(regPath) ? JSON.parse(readFileSync(regPath, 'utf8')) : { formatVersion: 1, defaultCase: o.caseId, cases: [] };
  reg.cases = reg.cases.filter((c) => c.id !== o.caseId);
  reg.cases.push({ id: o.caseId, path: o.caseId, label: `${caseJson.title} (국립해양조사원 자료)`, enabled: true });
  if (o.setDefault) reg.defaultCase = o.caseId;
  writeFileSync(regPath, JSON.stringify(reg, null, 2) + '\n');

  console.log(`사례 파일: ${relative(ROOT, outDir)}/ (observed.csv${pred ? ', predicted.csv' : ''}, moon.csv, case.json, quality-report.md/json)`);
  console.log(`관측 조위 ${pct(obsComp)} · 누락 구간 ${obsComp.ranges.length}개 · 점검 항목 ${obs.issues.length}건`);
  if (pred) console.log(`예측 조위 ${pct(predComp)} · 누락 구간 ${predComp.ranges.length}개 · 점검 항목 ${pred.issues.length}건`);
  console.log(`관측소명 일치: ${stationCheck.nameMatches ? '예' : '아니오(보고서 확인)'} · 기준면·시간대: 미확인 → 잔차 계산 안 함`);
  console.log(o.setDefault ? '학생 앱의 기본 사례로 지정했습니다.' : `학생 앱에서 쓰려면 --set-default를 붙이거나 data/cases/index.json의 defaultCase를 "${o.caseId}"로 바꾸세요.`);
}

main();

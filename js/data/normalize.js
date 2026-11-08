// 원자료(CSV 행) → 앱 내부 표준 형식 변환 (전처리)
//
// 이 파일은 화면 코드와 분리되어 있다. 실제 자료 파일의 열 이름·단위·시간대가 다르면
// 사례 설정(case.json)의 데이터셋 항목만 고치면 된다. 새로운 파일 형식이 필요하면
// 이 파일에 어댑터를 추가하고 ADAPTERS에 등록한다.
//
// 내부 기준
//  - 시각: UTC epoch ms (표시할 때만 사례 시간대로 변환)
//  - 조위: cm (원자료 단위를 명시적으로 변환하고 그 내역을 conversions에 기록)
//  - 결측·오류값: null (절대 0으로 바꾸지 않음)

import { parseCSVObjects } from './csv.js';
import { parseDateTime, parseOffset, MINUTE } from '../util/time.js';

const LENGTH_TO_CM = { cm: 1, m: 100, mm: 0.1 };
const PRESSURE_TO_HPA = { hPa: 1, hpa: 1, mb: 1, kPa: 10, kpa: 10 };
const SPEED_TO_MS = { 'm/s': 1, ms: 1, knot: 0.514444, kt: 0.514444, 'km/h': 1 / 3.6 };

const DEFAULT_MISSING = ['', '-', '--', 'NaN', 'nan', 'NA', 'null', '-999', '-9999', '999.9', '9999'];

function timeOf(rec, timeSpec, issues) {
  const raw = rec[timeSpec.column];
  const offset = parseOffset(timeSpec.offset ?? '+00:00');
  if (Number.isNaN(offset)) throw new Error(`시간대 오프셋 형식 오류: ${timeSpec.offset}`);
  const t = parseDateTime(raw, offset);
  if (Number.isNaN(t)) {
    issues.push({ line: rec.__line, type: 'time', message: `시각을 읽을 수 없음: "${raw}"` });
    return null;
  }
  return t;
}

function numberOf(raw, missing) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (missing.includes(s)) return null;
  const v = Number(s.replace(/,/g, ''));
  return Number.isFinite(v) ? v : undefined; // undefined = 숫자가 아님(오류)
}

function sortAndDedupe(points, issues) {
  points.sort((a, b) => a.t - b.t);
  const out = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && prev.t === p.t) {
      issues.push({ line: p.line, type: 'duplicate', message: '같은 시각의 중복 자료 — 첫 번째 값만 사용' });
      continue;
    }
    out.push(p);
  }
  return out;
}

/**
 * 조위(관측·예측) 시계열 변환
 * @returns {{kind,label,stationId,datum,datumLabel,unit,sourceUnit,conversions,intervalMs,points,issues,meta}}
 */
export function normalizeTideSeries(csvText, spec) {
  const issues = [];
  const { records, header } = parseCSVObjects(csvText);
  for (const col of [spec.time.column, spec.value.column]) {
    if (!header.includes(col)) throw new Error(`"${spec.file}"에 "${col}" 열이 없습니다.`);
  }
  const unit = spec.unit;
  const factor = LENGTH_TO_CM[unit];
  if (factor == null) throw new Error(`지원하지 않는 조위 단위: ${unit}`);
  const conversions = factor === 1 ? [] : [`${unit} → cm (×${factor})`];
  const missing = spec.missingValues ?? DEFAULT_MISSING;
  const q = spec.quality || null;
  const range = spec.valueRange || null; // 원자료 단위가 아닌 cm 기준
  const intervalMs = spec.intervalMinutes * MINUTE;

  let points = [];
  for (const rec of records) {
    const t = timeOf(rec, spec.time, issues);
    if (t == null) continue;
    let qRaw = q ? rec[q.column] ?? '' : '';
    let quality = 'ok';
    if (q) {
      if (q.ok?.includes(qRaw)) quality = 'ok';
      else if (q.suspect?.includes(qRaw)) quality = 'suspect';
      else if (q.bad?.includes(qRaw)) quality = 'bad';
      else if (q.missing?.includes(qRaw)) quality = 'missing';
      else quality = q.unknownAs || 'suspect';
    }
    let v = numberOf(rec[spec.value.column], missing);
    if (v === undefined) {
      issues.push({ line: rec.__line, type: 'value', message: `숫자가 아닌 값: "${rec[spec.value.column]}" → 결측 처리` });
      v = null; quality = 'bad';
    }
    if (v === null && quality === 'ok') quality = 'missing';
    if (v != null) v = round6(v * factor);
    if (v != null && range && (v < range[0] || v > range[1])) {
      issues.push({ line: rec.__line, type: 'range', message: `허용 범위를 벗어난 값 ${v} cm → 오류값으로 결측 처리` });
      v = null; quality = 'bad';
    }
    if (quality === 'bad' || quality === 'missing') v = null;
    if (t % intervalMs !== 0 && spec.checkGrid !== false) {
      issues.push({ line: rec.__line, type: 'grid', message: '관측 간격 격자에 맞지 않는 시각' });
    }
    points.push({ t, v, q: quality, qRaw, line: rec.__line });
  }
  points = sortAndDedupe(points, issues).map(({ line, ...p }) => p);
  return {
    kind: spec.kind,
    label: spec.label,
    stationId: spec.stationId,
    datum: spec.datum,
    datumLabel: spec.datumLabel || spec.datum,
    // 기준면을 문서로 확인하지 못한 자료는 false — 잔차 계산을 막는다
    datumConfirmed: spec.datumConfirmed !== false && !!spec.datum,
    unit: 'cm',
    sourceUnit: unit,
    conversions,
    intervalMs,
    points,
    issues,
    qualityLabels: q?.labels || {},
    meta: spec.meta || {},
  };
}

function round6(v) { return Math.round(v * 1e6) / 1e6; }

/** 기상 자료 변환: 기압(hPa), 풍속(m/s), 풍향(도, 바람이 불어오는 방향) */
export function normalizeWeather(csvText, spec) {
  const issues = [];
  const { records } = parseCSVObjects(csvText);
  const missing = spec.missingValues ?? DEFAULT_MISSING;
  const fields = {};
  const conv = {};
  const conversions = [];
  const defs = {
    pressure: { table: PRESSURE_TO_HPA, unit: 'hPa', label: '기압' },
    windSpeed: { table: SPEED_TO_MS, unit: 'm/s', label: '풍속' },
    windDir: { table: { deg: 1, '°': 1 }, unit: '°', label: '풍향' },
  };
  for (const [key, def] of Object.entries(defs)) {
    const f = spec.fields?.[key];
    if (!f) continue;
    const factor = def.table[f.unit];
    if (factor == null) throw new Error(`지원하지 않는 ${def.label} 단위: ${f.unit}`);
    if (factor !== 1) conversions.push(`${def.label}: ${f.unit} → ${def.unit} (×${round6(factor)})`);
    conv[key] = factor;
    fields[key] = { unit: def.unit, label: def.label, column: f.column, range: f.range };
  }
  let points = [];
  for (const rec of records) {
    const t = timeOf(rec, spec.time, issues);
    if (t == null) continue;
    const p = { t, line: rec.__line };
    for (const [key, f] of Object.entries(fields)) {
      let v = numberOf(rec[f.column], missing);
      if (v === undefined) {
        issues.push({ line: rec.__line, type: 'value', message: `${f.label}: 숫자가 아닌 값 → 결측` });
        v = null;
      }
      if (v != null) v = round6(v * conv[key]);
      if (v != null && f.range && (v < f.range[0] || v > f.range[1])) {
        issues.push({ line: rec.__line, type: 'range', message: `${f.label}: 범위를 벗어난 값 ${v} → 오류값으로 결측 처리` });
        v = null;
      }
      if (key === 'windDir' && v != null) v = v % 360;
      p[key] = v;
    }
    points.push(p);
  }
  points = sortAndDedupe(points, issues).map(({ line, ...p }) => p);
  return {
    station: spec.station,
    intervalMs: spec.intervalMinutes * MINUTE,
    fields,
    conversions,
    points,
    issues,
    meta: spec.meta || {},
  };
}

const PHASES = {
  new: { key: 'new', label: '삭' }, first: { key: 'first', label: '상현' },
  full: { key: 'full', label: '망' }, last: { key: 'last', label: '하현' },
};
const PHASE_ALIASES = {
  new: 'new', '삭': 'new', 'new moon': 'new', '신월': 'new',
  first: 'first', '상현': 'first', 'first quarter': 'first',
  full: 'full', '망': 'full', 'full moon': 'full', '보름': 'full',
  last: 'last', '하현': 'last', 'last quarter': 'last', 'third quarter': 'last',
};

/** 달의 위상 자료 변환 → [{t, phase, label, lunar}] */
export function normalizeMoonPhases(csvText, spec) {
  const issues = [];
  const { records } = parseCSVObjects(csvText);
  const out = [];
  for (const rec of records) {
    const t = timeOf(rec, spec.time, issues);
    if (t == null) continue;
    const raw = (rec[spec.phaseColumn] || '').trim().toLowerCase();
    const key = PHASE_ALIASES[raw];
    if (!key) { issues.push({ line: rec.__line, type: 'phase', message: `알 수 없는 위상 이름: "${raw}"` }); continue; }
    const lunar = spec.lunarColumn ? (rec[spec.lunarColumn] || '').trim() || null : null;
    out.push({ t, phase: key, label: PHASES[key].label, lunar });
  }
  out.sort((a, b) => a.t - b.t);
  return { phases: out, issues, meta: spec.meta || {}, timeIncluded: spec.timeIncluded !== false };
}

/** 태풍 경로 변환 → [{t, lat, lon, pressure, maxWind}] */
export function normalizeTyphoonTrack(csvText, spec) {
  const issues = [];
  const { records } = parseCSVObjects(csvText);
  const missing = spec.missingValues ?? DEFAULT_MISSING;
  const out = [];
  for (const rec of records) {
    const t = timeOf(rec, spec.time, issues);
    if (t == null) continue;
    const num = (col) => {
      if (!col) return null;
      const v = numberOf(rec[col], missing);
      return v === undefined ? null : v;
    };
    out.push({
      t,
      lat: num(spec.latColumn),
      lon: num(spec.lonColumn),
      pressure: num(spec.pressureColumn),
      maxWind: num(spec.windColumn),
    });
  }
  out.sort((a, b) => a.t - b.t);
  return { track: out, issues };
}

export const ADAPTERS = {
  'csv-tide': normalizeTideSeries,
  'csv-weather': normalizeWeather,
  'csv-moon': normalizeMoonPhases,
  'csv-typhoon-track': normalizeTyphoonTrack,
};

export { PHASES };

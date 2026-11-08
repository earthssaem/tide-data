// 평가 설정(교사가 관측소별로 정하는 값)
// - 학생용 배포 기본값: data/assessment.json (교사용 메모 없음)
// - 교사용 화면에서 고친 설정: 이 브라우저(localStorage 'tideLabTeacher.v1.setup')에만 저장 → 미리보기에 사용
// - 학생에게 적용하려면 교사용 화면에서 '학생용 배포 파일'을 내보내 data/assessment.json을 바꾼다.
// 설정은 이미 수집해 둔 자료의 범위만 고를 수 있고, 없는 자료를 만들지 않는다.

import { parseDateTime, fmtDateTime, fmtRange, parts, DAY, HOUR } from '../util/time.js';
import { INQUIRIES, CONCLUSION, NEEDS_LABEL, activeQuestions } from '../content/questions.js';

export const SETUP_FORMAT = 'tide-lab-assessment-setup';
export const SETUP_VERSION = 1;
export const SETUP_URL = 'data/assessment.json';
export const TEACHER_SETUP_KEY = 'tideLabTeacher.v1.setup';

const STATION_ID = /^[A-Za-z0-9_-]{1,32}$/;
const MONTH = /^\d{4}-\d{2}$/;
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/** "YYYY-MM-DD HH:mm"(사례 시간대) */
export const fmtLocal = (t, tz) => fmtDateTime(t, tz);
export const parseLocal = (s, tz) => parseDateTime(s, tz.offsetMinutes);

export function monthKey(t, tz) {
  const p = parts(t, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

/** 한 달 범위 [그달 1일 00:00, 다음 달 1일 00:00) */
export function monthRange(key, tz) {
  const [y, m] = key.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const p2 = (n) => String(n).padStart(2, '0');
  return [parseLocal(`${y}-${p2(m)}-01 00:00`, tz), parseLocal(`${ny}-${p2(nm)}-01 00:00`, tz)];
}

/** 관측 자료가 있는 달 목록(자료가 하루 이상 있는 달) */
export function availableMonths(cd) {
  const pts = cd.observed.points;
  if (!pts.length) return [];
  const out = [];
  let key = monthKey(pts[0].t, cd.tz);
  const last = monthKey(pts[pts.length - 1].t, cd.tz);
  for (let guard = 0; guard < 240; guard++) {
    const [a, b] = monthRange(key, cd.tz);
    const n = pts.filter((p) => p.t >= a && p.t < b && p.v != null).length;
    if (n * cd.observed.intervalMs >= DAY) out.push({ key, valid: n, expected: Math.round((b - a) / cd.observed.intervalMs) });
    if (key === last) break;
    key = monthKey(b, cd.tz);
  }
  return out;
}

const rangeObj = (r, tz) => (r ? { start: fmtLocal(r[0], tz), end: fmtLocal(r[1], tz) } : null);

/** 사례 파일의 기간을 그대로 쓴 기본 설정(교사 검토 전 임시 후보) */
export function defaultStationSetup(cd, { enabled = true } = {}) {
  return {
    enabled,
    month: monthKey(cd.ranges.inq2[0], cd.tz),
    basic: rangeObj(cd.ranges.inq1, cd.tz),
    focus: rangeObj(cd.ranges.inq3, cd.tz),
    links: { moon: !!cd.availability.moonPhases, weather: !!cd.availability.weather, typhoon: !!cd.availability.typhoon },
    questions: {},
    reviewed: false,
    memo: '',
  };
}

function cleanRange(r) {
  if (!isObj(r) || typeof r.start !== 'string' || typeof r.end !== 'string') return null;
  return { start: r.start.slice(0, 25), end: r.end.slice(0, 25) };
}

const ALL_IDS = [...INQUIRIES.flatMap((d) => d.questions), ...CONCLUSION.questions].map((q) => q.id);

/** 관측소 설정 하나 정리(빈 값은 기본값으로) */
export function sanitizeStationSetup(raw, fallback) {
  const s = isObj(raw) ? raw : {};
  const links = isObj(s.links) ? s.links : {};
  const q = {};
  if (isObj(s.questions)) for (const id of ALL_IDS) if (typeof s.questions[id] === 'boolean') q[id] = s.questions[id];
  return {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : fallback.enabled,
    month: typeof s.month === 'string' && MONTH.test(s.month) ? s.month : fallback.month,
    basic: cleanRange(s.basic) || fallback.basic,
    focus: cleanRange(s.focus) || fallback.focus,
    links: {
      moon: typeof links.moon === 'boolean' ? links.moon : fallback.links.moon,
      weather: typeof links.weather === 'boolean' ? links.weather : fallback.links.weather,
      typhoon: typeof links.typhoon === 'boolean' ? links.typhoon : fallback.links.typhoon,
    },
    questions: q,
    reviewed: typeof s.reviewed === 'boolean' ? s.reviewed : false,
    memo: typeof s.memo === 'string' ? s.memo.slice(0, 5000) : '',
  };
}

/** 설정 파일 검사. 형식이 틀리면 예외 */
export function parseSetup(obj) {
  if (!isObj(obj) || obj.format !== SETUP_FORMAT) throw new Error('조석 데이터 탐구실의 평가 설정 파일이 아닙니다.');
  if (typeof obj.version !== 'number' || obj.version > SETUP_VERSION) throw new Error('이 앱에서 읽을 수 없는 설정 파일 버전입니다.');
  if (typeof obj.caseId !== 'string' || !obj.caseId) throw new Error('설정 파일에 사례(caseId)가 없습니다.');
  const stations = {};
  if (isObj(obj.stations)) {
    for (const [id, v] of Object.entries(obj.stations).slice(0, 200)) if (STATION_ID.test(id) && isObj(v)) stations[id] = v;
  }
  return {
    format: SETUP_FORMAT,
    version: SETUP_VERSION,
    caseId: obj.caseId.slice(0, 100),
    title: typeof obj.title === 'string' ? obj.title.slice(0, 200) : '',
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt.slice(0, 40) : '',
    reviewNote: typeof obj.reviewNote === 'string' ? obj.reviewNote.slice(0, 1000) : '',
    stations,
  };
}

/** 사례의 관측소 목록(여러 관측소 사례가 아니면 관측소 하나) */
export function caseEntries(cd) {
  if (cd.multi && Array.isArray(cd.stations)) return cd.stations;
  return [{ id: cd.station.id, name: cd.station.name, sea: cd.stationEntry?.sea || '', lat: cd.station.lat, lon: cd.station.lon, note: '', cd }];
}

/** 이 관측소에 적용할 설정(설정 파일이 없으면 모든 관측소 사용, 있으면 파일에 켠 관측소만) */
export function stationSetupFor(entry, cfg) {
  const fb = defaultStationSetup(entry.cd, { enabled: !cfg });
  return sanitizeStationSetup(cfg?.stations?.[entry.id], fb);
}

/**
 * 관측소 자료(CaseData)에 설정 적용: 분석 기간·관찰 구간과 자료 연결 여부.
 * 연결하지 않은 자료는 null로 두어 화면·보고서에서 '자료 미제공'으로 다룬다(값을 만들지 않음).
 */
export function applySetup(cd, st) {
  const tz = cd.tz;
  const month = monthRange(st.month, tz);
  const pr = (r, fb) => {
    if (!r) return fb;
    const a = parseLocal(r.start, tz), b = parseLocal(r.end, tz);
    return Number.isFinite(a) && Number.isFinite(b) && b > a ? [a, b] : fb;
  };
  const moon = st.links.moon ? cd.moon : null;
  const weather = st.links.weather ? cd.weather : null;
  const typhoon = st.links.typhoon ? cd.typhoon : null;
  return {
    ...cd,
    ranges: { inq1: pr(st.basic, cd.ranges.inq1), inq2: month, inq3: pr(st.focus, cd.ranges.inq3) },
    moon,
    weather,
    typhoon,
    keyTimes: typhoon ? cd.keyTimes : [],
    weatherDistanceKm: weather ? cd.weatherDistanceKm : null,
    availability: {
      ...cd.availability,
      moonPhases: !!moon && moon.phases.length > 0,
      weather: !!weather,
      typhoon: !!typhoon,
    },
    setup: st,
    raw: cd.raw || cd,
  };
}

/**
 * 사례 전체에 평가 설정 적용. 돌려주는 CaseData의 stations에는 모든 관측소가 있고(근거 그래프용),
 * 학생이 고를 수 있는 관측소는 enabled=true인 것만이다.
 */
export function applyAssessment(cd0, cfg) {
  const entries = caseEntries(cd0);
  const list = entries.map((e) => {
    const setup = stationSetupFor(e, cfg);
    return { ...e, setup, enabled: setup.enabled, rawCd: e.cd.raw || e.cd, cd: applySetup(e.cd.raw || e.cd, setup) };
  });
  for (const s of list) {
    s.cd.multi = !!cd0.multi;
    s.cd.stations = list;
    s.cd.stationEntry = s;
    s.cd.failedStations = cd0.failedStations || [];
  }
  return list.find((s) => s.id === cd0.station.id)?.cd || list[0].cd;
}

export const enabledStations = (cd) => (cd.stations || []).filter((s) => s.enabled);

/** 비교할 수 있는 관측소: 평가에 쓰는 관측소 중 같은 달을 분석하는 곳 */
export function compareCandidates(cd) {
  return enabledStations(cd).filter((s) => s.id !== cd.station.id && s.setup.month === cd.setup?.month);
}

// ───────────────────────── 설정 검증 ─────────────────────────

function missingRuns(points, t0, t1, step) {
  const have = new Set(points.filter((p) => p.t >= t0 && p.t < t1 && p.v != null).map((p) => p.t));
  const runs = [];
  let cur = null;
  let n = 0;
  for (let t = t0; t < t1; t += step) {
    if (!have.has(t)) {
      n++;
      if (cur && cur[1] === t - step) cur[1] = t; else { cur = [t, t]; runs.push(cur); }
    }
  }
  return { count: n, runs, expected: Math.round((t1 - t0) / step) };
}

/**
 * 관측소 설정 검증. raw: 설정을 적용하기 전의 관측소 자료
 * @returns {Array<{level:'error'|'warn'|'info'|'ok', area:string, text:string}>}
 */
export function validateStationSetup(raw, st) {
  const out = [];
  const tz = raw.tz;
  const add = (level, area, text) => out.push({ level, area, text });
  const obs = raw.observed;
  const step = obs.intervalMs;
  const d0 = obs.points[0]?.t, d1 = obs.points[obs.points.length - 1]?.t;
  const months = availableMonths(raw);
  const month = monthRange(st.month, tz);
  const mInfo = months.find((m) => m.key === st.month);
  if (!mInfo) add('error', '분석 기간', `${st.month}에는 확보한 관측 조위가 없습니다. 자료가 있는 달: ${months.map((m) => m.key).join(', ') || '없음'}`);
  else {
    const miss = missingRuns(obs.points, month[0], month[1], step);
    if (miss.count) add('warn', '분석 기간', `${st.month} 관측 조위 ${miss.expected - miss.count}/${miss.expected}개 — 결측 ${miss.count}개(${runsText(miss.runs, step, tz)}). 탐구 2의 불완전한 날로 표시됩니다.`);
    else add('ok', '분석 기간', `${st.month} 관측 조위 ${miss.expected}/${miss.expected}개(결측 없음)`);
  }
  const checkRange = (r, label, { minH, maxH, hint }) => {
    if (!r) { add('error', label, `${label}이 정해지지 않았습니다.`); return; }
    const a = parseLocal(r.start, tz), b = parseLocal(r.end, tz);
    if (!Number.isFinite(a) || !Number.isFinite(b)) { add('error', label, `${label}의 시각 형식이 올바르지 않습니다(예: 2022-09-13 00:00).`); return; }
    if (!(b > a)) { add('error', label, `${label}의 끝 시각이 시작 시각보다 늦어야 합니다.`); return; }
    if (a < month[0] || b > month[1]) add('error', label, `${label}(${fmtRange(a, b, tz)})이 분석할 달(${st.month}) 밖에 있습니다.`);
    if (d0 == null || a < d0 || b > d1 + step) add('error', label, `${label}이 확보한 자료 범위(${fmtRange(d0, d1, tz)}) 밖에 있습니다.`);
    const hours = (b - a) / HOUR;
    if (hours < minH || hours > maxH) add('warn', label, `${label} 길이 ${Math.round(hours)}시간 — ${hint}`);
    const miss = missingRuns(obs.points, a, b, step);
    if (miss.count) add('warn', label, `${label}에 결측 ${miss.count}개(${runsText(miss.runs, step, tz)}). 그래프에서 선이 끊기며 값은 채우지 않습니다.`);
    else add('ok', label, `${label} ${fmtRange(a, b, tz)} · 결측 없음`);
  };
  checkRange(st.basic, '기본 관찰 구간', { minH: 36, maxH: 96, hint: '연속 2~3일(48~72시간)을 권장합니다.' });
  checkRange(st.focus, '집중 관찰 구간', { minH: 24, maxH: 240, hint: '하루~열흘 사이를 권장합니다.' });
  // 달의 위상
  if (!st.links.moon) add('warn', '달의 위상', '달의 위상 자료가 연결되지 않았습니다. 탐구 2의 [달의 위상 자료 확인]과 문항 ⑤를 쓸 수 없습니다.');
  else if (!raw.moon) add('error', '달의 위상', '이 사례에는 달의 위상 자료 파일이 없습니다.');
  else {
    const ph = raw.moon.phases.filter((p) => p.t >= month[0] && p.t < month[1]);
    if (ph.length < 2) add('error', '달의 위상', `${st.month}에 해당하는 달의 위상 자료가 ${ph.length}개뿐입니다.`);
    else add('ok', '달의 위상', `${st.month} 위상 ${ph.length}개 연결 (${ph.map((p) => `${p.label} ${fmtDateTime(p.t, tz, { year: false })}`).join(', ')})`);
  }
  // 기상 자료(원인 확인 단계)
  if (!st.links.weather) add('warn', '기상 자료', '기상 자료가 연결되지 않았습니다. 탐구 5에서 기압·바람으로 확인할 수 없습니다.');
  else if (!raw.weather) add('error', '기상 자료', '이 관측소에는 기상 자료 파일이 없습니다.');
  else if (st.focus) {
    const a = parseLocal(st.focus.start, tz), b = parseLocal(st.focus.end, tz);
    const w = raw.weather;
    const keys = Object.keys(w.fields || {});
    const inR = w.points.filter((p) => p.t >= a && p.t < b);
    const exp = Math.round((b - a) / w.intervalMs);
    const cov = (k) => inR.filter((p) => p[k] != null).length;
    const pk = ['pressureSea', 'pressure', 'pressureStation'].find((k) => keys.includes(k));
    const parts2 = [pk && `${w.fields[pk].label || '기압'} ${cov(pk)}/${exp}`, keys.includes('windSpeed') && `풍속 ${cov('windSpeed')}/${exp}`, keys.includes('windDir') && `풍향 ${cov('windDir')}/${exp}`].filter(Boolean);
    const short = (pk && cov(pk) < exp) || (keys.includes('windSpeed') && cov('windSpeed') < exp);
    add(short ? 'warn' : 'ok', '기상 자료', `집중 관찰 구간의 ${w.station?.name || '기상 관측 지점'} 자료: ${parts2.join(', ')}${raw.weatherDistanceKm != null && raw.weatherDistanceKm >= 0.1 ? ` · 조위관측소에서 약 ${raw.weatherDistanceKm.toFixed(1)} km` : ''}`);
  }
  // 태풍
  if (!st.links.typhoon) add('info', '태풍 정보', '태풍 정보를 연결하지 않았습니다(태풍이 없는 사례로 진행).');
  else if (!raw.typhoon) add('error', '태풍 정보', '이 사례에는 태풍 정보 파일이 없습니다.');
  else add('ok', '태풍 정보', `${raw.typhoon.name} 경로 ${raw.typhoon.track.length}개 시각 연결`);
  // 문항이 필요로 하는 자료
  const avail = {
    predicted: raw.availability.predicted, residual: raw.availability.residual,
    weather: st.links.weather && raw.availability.weather,
    moonPhases: st.links.moon && raw.availability.moonPhases,
    typhoon: st.links.typhoon && raw.availability.typhoon,
  };
  for (const def of INQUIRIES) {
    activeQuestions(def, st).forEach((q, i) => {
      const miss = (q.needs || []).filter((k) => !avail[k]);
      if (!miss.length) return;
      const lvl = q.optional ? 'error' : 'warn';
      const why = miss.includes('residual') && raw.availability.predicted ? ` (${raw.residual?.problems?.[0] || ''})` : '';
      add(lvl, '문항', `탐구 ${def.no} 문항 ${i + 1}에 필요한 ${miss.map((k) => NEEDS_LABEL[k] || k).join(', ')}이(가) 없어 학생이 확인할 수 없습니다${why}. ${q.optional ? '이 문항을 끄세요.' : '문항을 끄거나 자료를 연결하세요.'}`);
    });
  }
  if (!raw.availability.predicted) add('info', '예측 조위', '예측 조위 자료가 없습니다. 잔차는 계산하지 않으며, 예측이 필요한 문항(탐구 5 선택 문항)은 쓸 수 없습니다.');
  if (!st.reviewed) add('info', '검토', '교사 검토 필요 — 임시 후보 설정입니다. 그래프와 결측을 확인한 뒤 [검토 완료]를 표시하세요.');
  return out;
}

function runsText(runs, step, tz) {
  const s = runs.slice(0, 3).map(([a, b]) => (a === b ? fmtDateTime(a, tz, { year: false }) : `${fmtDateTime(a, tz, { year: false })}~${fmtDateTime(b, tz, { year: false })}`));
  return s.join(', ') + (runs.length > 3 ? ` 외 ${runs.length - 3}곳` : '');
}

/** 학생용 배포 파일: 교사용 메모를 빼고 내보낸다 */
export function studentDeployment(cfg) {
  const out = { format: SETUP_FORMAT, version: SETUP_VERSION, caseId: cfg.caseId, title: cfg.title || '', updatedAt: new Date().toISOString(), reviewNote: cfg.reviewNote || '', stations: {} };
  for (const [id, s] of Object.entries(cfg.stations || {})) {
    const { memo, ...rest } = s;
    out.stations[id] = rest;
  }
  return out;
}

/** 교사 보관용 파일(메모 포함) */
export function teacherExport(cfg) {
  return { ...cfg, format: SETUP_FORMAT, version: SETUP_VERSION, updatedAt: new Date().toISOString(), forTeacher: true };
}

// ───────────────────────── 읽기·저장 ─────────────────────────

function ls() { try { return window.localStorage; } catch { return null; } }

export function loadTeacherSetup() {
  const s = ls();
  if (!s) return null;
  try {
    const raw = s.getItem(TEACHER_SETUP_KEY);
    return raw ? parseSetup(JSON.parse(raw)) : null;
  } catch { return null; }
}

export function saveTeacherSetup(cfg) {
  const s = ls();
  if (!s) return { ok: false, error: '이 브라우저에서는 저장할 수 없습니다.' };
  try {
    const json = JSON.stringify({ ...cfg, updatedAt: new Date().toISOString() });
    s.setItem(TEACHER_SETUP_KEY, json);
    return { ok: s.getItem(TEACHER_SETUP_KEY) === json, time: Date.now() };
  } catch (e) { return { ok: false, error: e.message }; }
}

export function clearTeacherSetup() {
  try { ls()?.removeItem(TEACHER_SETUP_KEY); } catch { /* 무시 */ }
}

/** 학생용 배포 기본 설정 읽기(없으면 예외 — 예시 데이터로 바꾸지 않는다) */
export async function loadDeployedSetup(readText) {
  let text;
  try { text = await readText(SETUP_URL); } catch (e) { throw new Error(`평가 설정 파일(${SETUP_URL})을 불러오지 못했습니다. ${e.message}`); }
  try { return parseSetup(JSON.parse(text)); } catch (e) { throw new Error(`평가 설정 파일(${SETUP_URL})이 올바르지 않습니다: ${e.message}`); }
}

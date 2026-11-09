// 평가 설정(교사가 정하는 값) — 형식 2(탐구 1~4 + 종합)
// - 학생용 배포 기본값: data/assessment.json (교사용 메모 없음)
// - 교사용 화면에서 고친 설정: 서버(로그인으로 보호) 또는 이 브라우저(localStorage 'tideLabTeacher.v1.setup')
// - 설정은 이미 수집해 둔 자료의 범위만 고를 수 있고, 없는 자료를 만들지 않는다.

import { parseDateTime, fmtDateTime, fmtRange, parts, DAY, HOUR } from '../util/time.js';
import { ALL_QUESTIONS, ALL_QUESTION_IDS, CIRCLED } from '../content/questions.js';

export const SETUP_FORMAT = 'tide-lab-assessment-setup';
export const SETUP_VERSION = 3;
// 형식 2: 탐구 1~4(예측과 실제 포함) 시절에 저장한 설정 — 읽기는 하지만, 교사 화면·미리보기에서는 새 기본값으로 바꾼다
export const SETUP_MIN_READ = 2;
export const SETUP_URL = 'data/assessment.json';
export const TEACHER_SETUP_KEY = 'tideLabTeacher.v1.setup';

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

const cleanRange = (r) => (isObj(r) && typeof r.start === 'string' && typeof r.end === 'string' ? { start: r.start.slice(0, 25), end: r.end.slice(0, 25) } : null);

/** 사례 파일의 기본값으로 만든 설정(교사 검토 전 임시 후보) */
export function defaultSetup(ad) {
  const d = ad.defaults;
  return {
    format: SETUP_FORMAT, version: SETUP_VERSION, caseId: ad.id, title: '', updatedAt: '', reviewNote: '', reviewed: false, memo: '',
    questions: {},
    month: d.month,
    inq1: { start: d.inq1.start, end: d.inq1.end, countStart: d.inq1.count.start },
    inq2: { start: d.inq2.start, end: d.inq2.end },
    inq4: { a: { ...d.inq4.a }, b: { ...d.inq4.b } },
  };
}

/** 설정 파일 검사(형식이 틀리면 예외). 빠진 값은 fallback으로 */
export function parseSetup(obj, fallback = null) {
  if (!isObj(obj) || obj.format !== SETUP_FORMAT) throw new Error('조석 데이터 탐구실의 평가 설정 파일이 아닙니다.');
  if (typeof obj.version !== 'number' || obj.version > SETUP_VERSION) throw new Error('이 앱에서 읽을 수 없는 설정 파일 버전입니다.');
  if (obj.version < SETUP_MIN_READ) throw new Error('이전 구성(관측소 선택·탐구 1~5)의 설정 파일입니다. 지금 구성에서는 읽을 수 없으니 교사용 화면에서 다시 설정하세요.');
  if (typeof obj.caseId !== 'string' || !obj.caseId) throw new Error('설정 파일에 사례(caseId)가 없습니다.');
  const fb = fallback || {};
  const q = {};
  if (isObj(obj.questions)) for (const id of ALL_QUESTION_IDS) if (typeof obj.questions[id] === 'boolean') q[id] = obj.questions[id];
  const i1 = isObj(obj.inq1) ? obj.inq1 : {};
  const i4 = isObj(obj.inq4) ? obj.inq4 : {};
  return {
    format: SETUP_FORMAT,
    version: SETUP_VERSION,
    savedVersion: obj.version, // 저장 당시 형식(형식 2는 앱 개편 전 설정)
    caseId: obj.caseId.slice(0, 100),
    title: typeof obj.title === 'string' ? obj.title.slice(0, 200) : '',
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt.slice(0, 40) : '',
    reviewNote: typeof obj.reviewNote === 'string' ? obj.reviewNote.slice(0, 1000) : '',
    reviewed: obj.reviewed === true,
    memo: typeof obj.memo === 'string' ? obj.memo.slice(0, 5000) : '',
    questions: q,
    month: typeof obj.month === 'string' && MONTH.test(obj.month) ? obj.month : fb.month || '',
    inq1: {
      start: typeof i1.start === 'string' ? i1.start.slice(0, 25) : fb.inq1?.start || '',
      end: typeof i1.end === 'string' ? i1.end.slice(0, 25) : fb.inq1?.end || '',
      countStart: typeof i1.countStart === 'string' ? i1.countStart.slice(0, 25) : fb.inq1?.countStart || '',
    },
    inq2: cleanRange(obj.inq2) || fb.inq2 || { start: '', end: '' },
    inq4: { a: cleanRange(i4.a) || fb.inq4?.a || { start: '', end: '' }, b: cleanRange(i4.b) || fb.inq4?.b || { start: '', end: '' } },
  };
}

/**
 * 평가 자료에 설정 적용: 각 탐구의 시각 범위(ms)를 계산한다. 잘못된 값은 사례 기본값으로 둔다.
 * @returns ad + { setup, win: {month, inq1, count, inq2, a, b} }
 */
export function applySetup(ad, cfg) {
  const tz = ad.tz;
  const st = cfg && cfg.caseId === ad.id ? parseSetup(cfg, defaultSetup(ad)) : defaultSetup(ad);
  const d = defaultSetup(ad);
  const pr = (r, fb) => {
    const a = parseLocal(r?.start, tz), b = parseLocal(r?.end, tz);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) return [a, b];
    return [parseLocal(fb.start, tz), parseLocal(fb.end, tz)];
  };
  const month = monthRange(ad.months.includes(st.month) ? st.month : d.month, tz);
  const inq1 = pr(st.inq1, d.inq1);
  let c0 = parseLocal(st.inq1.countStart, tz);
  if (!Number.isFinite(c0) || c0 < inq1[0] || c0 + DAY > inq1[1]) c0 = Math.max(inq1[0], Math.min(inq1[1] - DAY, parseLocal(d.inq1.countStart, tz)));
  return {
    ...ad,
    setup: st,
    win: { month, inq1, count: [c0, c0 + DAY], inq2: pr(st.inq2, d.inq2), a: pr(st.inq4.a, d.inq4.a), b: pr(st.inq4.b, d.inq4.b) },
  };
}

// ───────────────────────── 설정 검증 ─────────────────────────
function coverage(cd, kind, t0, t1, key = 'v') {
  const s = kind === 'weather' ? cd.weather : cd[kind];
  if (!s) return { have: 0, expected: Math.round((t1 - t0) / HOUR), missing: Math.round((t1 - t0) / HOUR) };
  const n = s.points.filter((p) => p.t >= t0 && p.t < t1 && p[key] != null).length;
  const exp = Math.round((t1 - t0) / (s.intervalMs || HOUR));
  return { have: n, expected: exp, missing: exp - n };
}

/**
 * 설정 검증
 * @returns {Array<{level:'error'|'warn'|'info'|'ok', area:string, text:string}>}
 */
export function validateSetup(ad0, cfg) {
  const out = [];
  const add = (level, area, text) => out.push({ level, area, text });
  const tz = ad0.tz;
  const st = parseSetup(cfg, defaultSetup(ad0));
  const ad = applySetup(ad0, st);
  const W = ad.win;
  const rep = ad.st[ad.rep];
  const raw = (r) => [parseLocal(r?.start, tz), parseLocal(r?.end, tz)];
  if (!ad.months.includes(st.month)) add('error', '분석 연월', `${st.month || '(없음)'}은 자료가 있는 달이 아닙니다. 고를 수 있는 달: ${ad.months.join(', ')}`);
  else {
    const c = coverage(rep, 'predicted', W.month[0], W.month[1]);
    add(c.missing ? 'warn' : 'ok', '분석 연월', `${st.month} 부산 예측 ${c.have}/${c.expected}${c.missing ? ' — 결측은 그래프에서 끊어 표시하고 채우지 않습니다.' : ' (결측 없음)'}`);
  }
  const [a1, b1] = raw(st.inq1);
  if (!Number.isFinite(a1) || !Number.isFinite(b1) || b1 <= a1) add('error', '탐구 1 구간', '탐구 1의 관찰 구간(3일) 시각 형식이 올바르지 않습니다(예: 2026-09-10 00:00).');
  else {
    if (a1 < W.month[0] || b1 > W.month[1]) add('error', '탐구 1 구간', `탐구 1 구간(${fmtRange(a1, b1, tz)})이 분석 연월(${st.month}) 밖에 있습니다.`);
    const hrs = (b1 - a1) / HOUR;
    if (hrs < 48 || hrs > 96) add('warn', '탐구 1 구간', `탐구 1 구간 길이 ${Math.round(hrs)}시간 — 3일(72시간) 안팎을 권장합니다.`);
    else add('ok', '탐구 1 구간', `${fmtRange(a1, b1, tz)} (${Math.round(hrs)}시간)`);
    const c0 = parseLocal(st.inq1.countStart, tz);
    if (!Number.isFinite(c0) || c0 < a1 || c0 + DAY > b1) add('error', '탐구 1 구간', '문항 ②의 24시간 구간이 탐구 1 구간 안에 들어가야 합니다.');
    else add('ok', '탐구 1 구간', `문항 ②의 24시간: ${fmtRange(c0, c0 + DAY, tz)}`);
    const p10 = rep.predicted10;
    const has10 = p10 && p10.points.filter((p) => p.t >= a1 && p.t <= b1 && p.v != null).length >= Math.round((b1 - a1) / p10.intervalMs);
    if (has10) add('ok', '탐구 1 구간', '10분 간격 예측 자료 사용(만조·간조를 10분 단위로 고를 수 있음)');
    else add('warn', '탐구 1 구간', `이 구간에는 10분 간격 예측 자료가 없어 1시간 간격으로 표시합니다(10분 자료가 있는 달: ${(p10?.months || []).join(', ') || '없음'}).`);
  }
  const [a2, b2] = raw(st.inq2);
  if (!Number.isFinite(a2) || !Number.isFinite(b2) || b2 <= a2) add('error', '탐구 2 기간', '탐구 2 지역 비교 기간의 시각 형식이 올바르지 않습니다.');
  else {
    const miss = ad.stationList.map((s) => [s.name, coverage(ad.st[s.id], 'predicted', a2, b2)]).filter(([, c]) => c.missing);
    const hrs = (b2 - a2) / HOUR;
    if (hrs < 24 || hrs > 24 * 15) add('warn', '탐구 2 기간', `지역 비교 기간 ${Math.round(hrs)}시간 — 1~15일을 권장합니다.`);
    if (miss.length) add('warn', '탐구 2 기간', `예측 조위 결측: ${miss.map(([n, c]) => `${n} ${c.missing}개`).join(', ')}`);
    else add('ok', '탐구 2 기간', `${fmtRange(a2, b2, tz)} · 인천·부산·묵호 예측 조위 결측 없음`);
  }
  const inData = (cd, a) => cd?.observed?.points.length && a >= cd.observed.points[0].t && a <= cd.observed.points.at(-1).t;
  for (const [k, label] of [['a', '탐구 3 기간 A'], ['b', '탐구 3 기간 B']]) {
    const [a, b] = raw(st.inq4[k]);
    const cd = inData(ad.past, a) ? ad.past : rep;
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) { add('error', label, `${label}의 시각 형식이 올바르지 않습니다.`); continue; }
    const o = coverage(cd, 'observed', a, b);
    if (!o.have) { add('error', label, `${label}(${fmtRange(a, b, tz)})에 관측 조위 자료가 없습니다.`); continue; }
    const p = coverage(cd, 'weather', a, b, 'pressureSea');
    const w = coverage(cd, 'weather', a, b, 'windSpeed');
    add(o.missing || p.missing || w.missing ? 'warn' : 'ok', label, `${fmtRange(a, b, tz)} · 관측 조위 ${o.have}/${o.expected}, 해면기압 ${p.have}/${p.expected}, 풍속 ${w.have}/${w.expected}`);
  }
  const la = raw(st.inq4.a), lb = raw(st.inq4.b);
  if (Number.isFinite(la[0]) && Number.isFinite(lb[0]) && Math.abs((la[1] - la[0]) - (lb[1] - lb[0])) > HOUR) add('warn', '탐구 3 기간', '기간 A와 B의 길이가 다릅니다. 같은 길이로 맞추면 비교하기 쉽습니다.');
  if (!ad.timeBasis?.confirmed) add('warn', '시간대', '자료의 시간대가 확인되지 않아 탐구 3의 시각 연결(조위·기압·바람·태풍 시각 함께 보기)을 켜지 않습니다.');
  else add('ok', '시간대', `모든 자료 KST 확인(${ad.timeBasis.checkedAt?.slice(0, 10) || ''}) — 탐구 3 시각 연결 사용`);
  const off = ALL_QUESTIONS.filter((q) => st.questions[q.id] === false);
  add('info', '문항', off.length ? `끈 문항: ${off.map((q) => CIRCLED[q.no]).join(' ')}` : '모든 문항(①~⑩)을 씁니다.');
  if (!st.reviewed) add('info', '검토', '교사 검토 필요 — 임시 후보 설정입니다. 그래프를 확인한 뒤 [검토 완료]를 표시하세요.');
  return out;
}

/** 학생용 배포 파일: 교사용 메모를 빼고 내보낸다 */
export function studentDeployment(cfg) {
  const { memo, forTeacher, savedAt, savedVersion, ...rest } = cfg;
  return { ...rest, format: SETUP_FORMAT, version: SETUP_VERSION, updatedAt: new Date().toISOString() };
}

/** 교사 보관용 파일(메모 포함) */
export function teacherExport(cfg) {
  const { savedVersion, ...rest } = cfg;
  return { ...rest, format: SETUP_FORMAT, version: SETUP_VERSION, updatedAt: new Date().toISOString(), forTeacher: true };
}

/** 앱 개편 전(형식 2)에 저장한 교사 설정인지 */
export const isOutdatedSetup = (cfg) => !!cfg && typeof cfg.savedVersion === 'number' && cfg.savedVersion < SETUP_VERSION;

/**
 * 개편 전 교사 설정 → 새 기본값(학생용 배포 설정, 없으면 사례 기본값)으로 바꾸고 메모만 옮긴다.
 * @returns {{cfg, old:Array<[string,string]>}} old: 바뀐 이전 값(화면 안내용)
 */
export function migrateOutdatedSetup(oldCfg, base) {
  const fmt = (r) => (r?.start ? `${r.start.slice(0, 10)} ~ ${r.end.slice(0, 10)}` : '—');
  const old = [
    ['분석 연월', oldCfg.month || '—'],
    ['탐구 1 구간', fmt(oldCfg.inq1)],
    ['탐구 2 기간', fmt(oldCfg.inq2)],
    ['비교 기간 A', fmt(oldCfg.inq4?.a)],
    ['비교 기간 B', fmt(oldCfg.inq4?.b)],
  ];
  const { savedVersion, ...b } = JSON.parse(JSON.stringify(base));
  return { cfg: { ...b, version: SETUP_VERSION, memo: oldCfg.memo || '', reviewed: false }, old };
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

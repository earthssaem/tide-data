// 저장과 복구
// - 학생 정보·답안·근거는 현재 브라우저의 localStorage에만 저장한다(외부 서버 전송 없음).
// - 학생용 키는 모두 'tideLab.'으로 시작하며, 삭제할 때도 이 키만 지운다.
// - 교사용 미리보기·기능 시험의 작성 내용은 'tideLabTeacher.v1.preview'에 따로 저장한다(학생 답안과 분리).
// - 저장 형식 2(탐구 1~5). 이전 형식(1)의 저장 내용은 지우지 않고 'tideLab.v1.legacy'에 원본 그대로 보관한다.

import { ALL_QUESTION_IDS, DRAWING_QUESTION_IDS, STEP_IDS, EVIDENCE_INQUIRIES } from '../content/questions.js';

export const SCHEMA_VERSION = 2;
const WEATHER_KEYS = ['pressureSea', 'pressureStation', 'pressure', 'windSpeed', 'windDir'];
export const SAVE_FORMAT = 'tide-lab-save';
export const BACKUP_FORMAT = 'tide-lab-backup';
export const KEY_PREFIX = 'tideLab.';
export const STUDENT_WORK_KEY = 'tideLab.v1.work';
export const LEGACY_KEY = 'tideLab.v1.legacy';
export const PREVIEW_WORK_KEY = 'tideLabTeacher.v1.preview';

let workKey = STUDENT_WORK_KEY;
let previewMode = false;
/** 저장 위치 선택: 'student'(학생 답안) 또는 'preview'(교사용 미리보기·기능 시험) */
export function setStorageMode(mode) {
  previewMode = mode === 'preview';
  workKey = previewMode ? PREVIEW_WORK_KEY : STUDENT_WORK_KEY;
}
export const isPreviewStorage = () => previewMode;
export const currentWorkKey = () => workKey;

export function emptyAnalysis() {
  return {
    inq1: { view: null, points: [], pair: null, compare: null },
    inq2: { detailView: null, selectedDays: [], focusDay: null, showMoon: true, contextDays: 2, pair: null, compare: null },
    inq3: { view: null, points: [], pair: null },
    inq5: { view: null, marks: [], cursor: null, panels: null },
  };
}

/** 관측소마다 따로 보관하는 작성 내용 */
export const WORKSPACE_KEYS = ['answers', 'links', 'drawings', 'reveals', 'analysis'];
export function emptyWorkspace() {
  return { answers: {}, links: {}, drawings: {}, reveals: { moon: null, weather: null }, analysis: emptyAnalysis() };
}

export function emptyState(caseId, dataVersion) {
  const now = Date.now();
  return {
    format: SAVE_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    caseId,
    dataVersion,
    student: { grade: '', klass: '', number: '', name: '' },
    started: false,
    step: 'start',
    stationId: null, // 학생이 고른 관측소
    ...emptyWorkspace(),
    evidences: [], // 모든 관측소의 근거(관측소가 기록됨)
    evSeq: Object.fromEntries(EVIDENCE_INQUIRIES.map((n) => [n, 0])),
    byStation: {}, // 지금 고르지 않은 관측소의 작성 내용
    createdAt: now,
    updatedAt: now,
    lastPdfAt: null,
  };
}

function storage() {
  try { return window.localStorage; } catch { return null; }
}

/** 저장 후 다시 읽어 확인한 경우에만 ok:true */
export function saveLocal(state) {
  const ls = storage();
  if (!ls) return { ok: false, error: '이 브라우저에서는 임시 저장을 사용할 수 없습니다(저장소 차단).' };
  try {
    const json = JSON.stringify(state);
    ls.setItem(workKey, json);
    if (ls.getItem(workKey) !== json) return { ok: false, error: '저장한 내용을 다시 확인하지 못했습니다.' };
    return { ok: true, time: Date.now() };
  } catch (e) {
    const quota = e && (e.name === 'QuotaExceededError' || e.code === 22);
    return { ok: false, error: quota ? '브라우저 저장 공간이 부족합니다.' : `저장 오류: ${e?.message || e}` };
  }
}

/** 이전 형식 저장 내용 요약(보관본) */
export function legacyInfo() {
  if (previewMode) return null;
  const ls = storage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(LEGACY_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return { raw, student: o.student || {}, updatedAt: o.updatedAt || null, answers: Object.values(o.answers || {}).filter((x) => typeof x === 'string' && x.trim()).length, evidences: Array.isArray(o.evidences) ? o.evidences.length : 0, caseId: o.caseId || '' };
  } catch { return null; }
}

export function loadLocal() {
  const ls = storage();
  if (!ls) return { state: null, error: '브라우저 저장소를 사용할 수 없습니다.' };
  let raw;
  try { raw = ls.getItem(workKey); } catch (e) { return { state: null, error: e.message }; }
  if (!raw) return { state: null };
  let obj;
  try { obj = JSON.parse(raw); } catch (e) { return { state: null, error: `저장된 내용을 읽을 수 없습니다: ${e.message}`, raw }; }
  // 이전 형식(탐구 1~3): 원본을 따로 보관하고 새 형식으로 시작
  if (obj && obj.format === SAVE_FORMAT && obj.schemaVersion === 1) {
    try {
      if (!ls.getItem(LEGACY_KEY)) ls.setItem(LEGACY_KEY, raw);
      if (ls.getItem(LEGACY_KEY)) ls.removeItem(workKey);
    } catch (e) { return { state: null, error: `이전 형식 저장 내용을 보관하지 못했습니다: ${e.message}` }; }
    return { state: null, migrated: true };
  }
  try {
    return { state: sanitizeState(obj) };
  } catch (e) {
    return { state: null, error: `저장된 내용을 읽을 수 없습니다: ${e.message}`, raw };
  }
}

/** 이 앱의 작성 내용만 삭제(미리보기 모드에서는 미리보기 내용만) */
export function clearLocal() {
  const ls = storage();
  if (!ls) return { ok: false, error: '브라우저 저장소를 사용할 수 없습니다.' };
  try {
    if (previewMode) { ls.removeItem(PREVIEW_WORK_KEY); return { ok: true, removed: 1 }; }
    const keys = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.startsWith(KEY_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => ls.removeItem(k));
    return { ok: true, removed: keys.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export function clearLegacy() {
  try { storage()?.removeItem(LEGACY_KEY); return true; } catch { return false; }
}

// ───────── 검증 ─────────
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 200000) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const range = (v) => (Array.isArray(v) && v.length === 2 && num(v[0]) != null && num(v[1]) != null && v[1] > v[0] ? [v[0], v[1]] : null);
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function labeledTimes(arr, kinds) {
  if (!Array.isArray(arr)) return [];
  return arr.filter((p) => isObj(p) && typeof p.label === 'string' && num(p.t) != null).slice(0, 26).map((p) => {
    const o = { label: p.label.slice(0, 3), t: p.t };
    if (kinds) o.kind = kinds.includes(p.kind) ? p.kind : '';
    return o;
  });
}

const STATION_ID = /^[A-Za-z0-9_-]{1,32}$/;
/** 관측소 비교 설정: 비교 관측소 id, 세로축 눈금(separate 개별 / same 같은 눈금 크기) */
function sanitizeCompare(c) {
  if (!isObj(c) || typeof c.stationId !== 'string' || !STATION_ID.test(c.stationId)) return null;
  return { stationId: c.stationId, yMode: c.yMode === 'same' ? 'same' : 'separate' };
}
const pairOf = (p) => (Array.isArray(p) ? p.slice(0, 2).map((x) => String(x).slice(0, 3)) : null);

function sanitizeInq(key, a) {
  const x = isObj(a) ? a : {};
  if (key === 'inq1') return { view: range(x.view), points: labeledTimes(x.points, ['high', 'low']), pair: pairOf(x.pair), compare: sanitizeCompare(x.compare) };
  if (key === 'inq2') {
    return {
      detailView: range(x.detailView),
      selectedDays: Array.isArray(x.selectedDays) ? x.selectedDays.filter((d) => isObj(d) && DAY_KEY.test(d.day) && typeof d.label === 'string').slice(0, 26).map((d) => ({ label: d.label.slice(0, 3), day: d.day, kind: ['spring', 'neap'].includes(d.kind) ? d.kind : '' })) : [],
      focusDay: typeof x.focusDay === 'string' && DAY_KEY.test(x.focusDay) ? x.focusDay : null,
      showMoon: x.showMoon !== false,
      contextDays: [1, 2, 3].includes(x.contextDays) ? x.contextDays : 2,
      pair: pairOf(x.pair),
      compare: sanitizeCompare(x.compare),
    };
  }
  if (key === 'inq3') return { view: range(x.view), points: labeledTimes(x.points), pair: pairOf(x.pair) };
  return {
    view: range(x.view),
    marks: labeledTimes(x.marks),
    cursor: num(x.cursor),
    panels: Array.isArray(x.panels) ? [...new Set(x.panels.filter((k) => WEATHER_KEYS.includes(k)))] : null,
  };
}

function sanitizeAnalysis(a) {
  const src = isObj(a) ? a : {};
  return { inq1: sanitizeInq('inq1', src.inq1), inq2: sanitizeInq('inq2', src.inq2), inq3: sanitizeInq('inq3', src.inq3), inq5: sanitizeInq('inq5', src.inq5) };
}

const COLOR = /^#[0-9a-fA-F]{6}$/;
const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(v * 10) / 10));
/** 그림판 그림(선과 글자). 형식이 맞지 않는 부분은 버린다 */
export function sanitizeDrawing(d) {
  if (!isObj(d)) return null;
  const w = num(d.w), h = num(d.h);
  if (!w || !h || w < 100 || h < 60 || w > 2000 || h > 2000) return null;
  const strokes = Array.isArray(d.strokes) ? d.strokes.filter(isObj).slice(0, 600).map((s) => ({
    c: COLOR.test(s.c) ? s.c : '#1d2733',
    w: clampN(num(s.w) ?? 2.5, 1, 14),
    p: Array.isArray(s.p) ? s.p.filter((q) => Array.isArray(q) && num(q[0]) != null && num(q[1]) != null).slice(0, 4000).map((q) => [clampN(q[0], 0, w), clampN(q[1], 0, h)]) : [],
  })).filter((s) => s.p.length) : [];
  const texts = Array.isArray(d.texts) ? d.texts.filter((t) => isObj(t) && typeof t.t === 'string' && t.t.trim()).slice(0, 120).map((t) => ({
    x: clampN(num(t.x) ?? 0, 0, w), y: clampN(num(t.y) ?? 0, 0, h), c: COLOR.test(t.c) ? t.c : '#1d2733', s: clampN(num(t.s) ?? 16, 10, 36), t: t.t.slice(0, 40),
  })) : [];
  return { w, h, strokes, texts };
}

const answersOf = (o) => {
  const out = {};
  if (isObj(o)) for (const id of ALL_QUESTION_IDS) if (typeof o[id] === 'string') out[id] = o[id].slice(0, 200000);
  return out;
};

function sanitizeReveal(r) {
  if (!isObj(r) || num(r.at) == null) return null;
  return { at: r.at, answers: answersOf(r.answers), drawing: sanitizeDrawing(r.drawing) };
}

function sanitizeWorkspace(w, evIds) {
  const x = isObj(w) ? w : {};
  const out = emptyWorkspace();
  out.answers = answersOf(x.answers);
  if (isObj(x.links)) for (const id of ALL_QUESTION_IDS) if (Array.isArray(x.links[id])) out.links[id] = x.links[id].filter((e) => evIds.has(e));
  if (isObj(x.drawings)) for (const id of DRAWING_QUESTION_IDS) { const d = sanitizeDrawing(x.drawings[id]); if (d) out.drawings[id] = d; }
  const rv = isObj(x.reveals) ? x.reveals : {};
  out.reveals = { moon: sanitizeReveal(rv.moon), weather: sanitizeReveal(rv.weather) };
  out.analysis = sanitizeAnalysis(x.analysis);
  return out;
}

function sanitizeEvidence(ev) {
  if (!isObj(ev)) return null;
  if (!EVIDENCE_INQUIRIES.includes(ev.inquiry)) return null;
  if (typeof ev.id !== 'string' || typeof ev.num !== 'string') return null;
  if (!isObj(ev.state) || !isObj(ev.values)) return null;
  return {
    id: ev.id.slice(0, 64),
    num: ev.num.slice(0, 16),
    inquiry: ev.inquiry,
    seq: num(ev.seq) ?? 0,
    createdAt: num(ev.createdAt) ?? Date.now(),
    updatedAt: num(ev.updatedAt) ?? Date.now(),
    caseId: str(ev.caseId, 100),
    dataVersion: str(ev.dataVersion, 100),
    station: str(ev.station, 200),
    stationId: typeof ev.stationId === 'string' && STATION_ID.test(ev.stationId) ? ev.stationId : null,
    stationSea: str(ev.stationSea, 20),
    datasets: Array.isArray(ev.datasets) ? ev.datasets.filter(isObj).map((d) => ({ label: str(d.label, 200), identifier: str(d.identifier, 200) })) : [],
    period: range(ev.period),
    state: sanitizeInq(`inq${ev.inquiry}`, ev.state),
    values: JSON.parse(JSON.stringify(ev.values)),
    memo: str(ev.memo, 5000),
    summary: str(ev.summary, 500),
  };
}

/** 저장 형식 검사 및 정리. 형식이 맞지 않으면 예외 */
export function sanitizeState(obj) {
  if (!isObj(obj)) throw new Error('저장 형식이 아닙니다.');
  if (obj.format !== SAVE_FORMAT) throw new Error('조석 데이터 탐구실의 저장 형식이 아닙니다.');
  if (typeof obj.schemaVersion !== 'number') throw new Error('저장 형식 버전 정보가 없습니다.');
  if (obj.schemaVersion > SCHEMA_VERSION) throw new Error(`더 새로운 버전(${obj.schemaVersion})의 앱에서 만든 파일입니다. 이 앱(버전 ${SCHEMA_VERSION})에서는 열 수 없습니다.`);
  if (obj.schemaVersion < SCHEMA_VERSION) throw new Error(`이전 버전(${obj.schemaVersion}, 탐구 1~3 구성)의 저장 형식입니다. 탐구 순서와 문항이 바뀌어 이 앱에서는 열 수 없습니다.`);
  if (typeof obj.caseId !== 'string' || !obj.caseId) throw new Error('사례 정보가 없습니다.');
  const s = emptyState(obj.caseId, str(obj.dataVersion, 100));
  const st = isObj(obj.student) ? obj.student : {};
  s.student = { grade: str(st.grade, 10), klass: str(st.klass, 10), number: str(st.number, 10), name: str(st.name, 40) };
  s.started = !!obj.started;
  s.step = STEP_IDS.includes(obj.step) ? obj.step : 'start';
  s.evidences = Array.isArray(obj.evidences) ? obj.evidences.map(sanitizeEvidence).filter(Boolean) : [];
  const evIds = new Set(s.evidences.map((e) => e.id));
  Object.assign(s, sanitizeWorkspace(obj, evIds));
  if (isObj(obj.evSeq)) for (const k of EVIDENCE_INQUIRIES) s.evSeq[k] = num(obj.evSeq[k]) ?? 0;
  for (const ev of s.evidences) s.evSeq[ev.inquiry] = Math.max(s.evSeq[ev.inquiry] || 0, ev.seq);
  s.stationId = typeof obj.stationId === 'string' && STATION_ID.test(obj.stationId) ? obj.stationId : null;
  s.byStation = {};
  if (isObj(obj.byStation)) {
    for (const [k, v] of Object.entries(obj.byStation).slice(0, 100)) if (STATION_ID.test(k) && k !== s.stationId) s.byStation[k] = sanitizeWorkspace(v, evIds);
  }
  s.createdAt = num(obj.createdAt) ?? s.createdAt;
  s.updatedAt = num(obj.updatedAt) ?? s.updatedAt;
  s.lastPdfAt = num(obj.lastPdfAt);
  return s;
}

// ───────── 백업 파일 ─────────
export function backupFilename(state, { legacy = false } = {}) {
  const s = state.student || {};
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
  const who = `${s.grade || ''}학년${s.klass || ''}반${s.number || ''}번_${s.name || '이름없음'}`;
  return safeFilename(`조석탐구_${legacy ? '이전버전백업' : previewMode ? '미리보기백업' : '백업'}_${who}_${stamp}.json`);
}

export function safeFilename(name) {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, '');
}

export function makeBackupText(state) {
  return JSON.stringify({
    format: BACKUP_FORMAT,
    app: '조석 데이터 탐구실',
    schemaVersion: state.schemaVersion || SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    caseId: state.caseId,
    dataVersion: state.dataVersion,
    work: state,
  }, null, 1);
}

/**
 * 백업 파일 검사. 기존 답안은 이 함수에서 건드리지 않는다.
 * @returns {{ok:true, state, warnings:string[]} | {ok:false, error:string}}
 */
export function parseBackup(text, { knownCaseIds, currentCaseId, currentDataVersion }) {
  let obj;
  try { obj = JSON.parse(text); } catch { return { ok: false, error: 'JSON 형식의 백업 파일이 아닙니다.' }; }
  if (!isObj(obj) || obj.format !== BACKUP_FORMAT) return { ok: false, error: '조석 데이터 탐구실의 백업 파일이 아닙니다.' };
  if (typeof obj.schemaVersion !== 'number') return { ok: false, error: '백업 파일에 형식 버전 정보가 없습니다.' };
  if (obj.schemaVersion > SCHEMA_VERSION) return { ok: false, error: `더 새로운 버전(${obj.schemaVersion})의 앱에서 만든 백업입니다.` };
  if (obj.schemaVersion < SCHEMA_VERSION) return { ok: false, error: '이전 버전 앱(탐구 1~3 구성)에서 만든 백업입니다. 탐구 순서와 문항이 바뀌어 불러올 수 없습니다. 파일은 지우지 말고 보관하세요.' };
  let state;
  try { state = sanitizeState(obj.work); } catch (e) { return { ok: false, error: `백업 내용이 올바르지 않습니다: ${e.message}` }; }
  if (obj.caseId !== state.caseId) return { ok: false, error: '백업 파일의 사례 정보가 서로 맞지 않습니다.' };
  if (!knownCaseIds.includes(state.caseId)) return { ok: false, error: `이 앱에 없는 사례(${state.caseId})의 백업입니다.` };
  const warnings = [];
  if (state.caseId !== currentCaseId) warnings.push(`현재 평가 사례와 다른 사례(${state.caseId})의 백업입니다.`);
  else if (state.dataVersion !== currentDataVersion) warnings.push(`백업을 만들 때의 자료 버전(${state.dataVersion})과 현재 자료 버전(${currentDataVersion})이 다릅니다. 근거에 기록된 값은 백업 당시의 값으로 유지됩니다.`);
  return { ok: true, state, warnings };
}

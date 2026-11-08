// 저장과 복구
// - 학생 정보·답안은 현재 브라우저의 localStorage에만 저장한다(외부 서버 전송 없음).
// - 학생용 키는 모두 'tideLab.'으로 시작하며, 삭제할 때도 이 키만 지운다.
// - 교사용 미리보기·기능 시험의 작성 내용은 'tideLabTeacher.v1.preview'에 따로 저장한다(학생 답안과 분리).
// - 저장 형식 3(탐구 1~4 + 종합, 문항 ①~⑫). 이전 형식의 저장 내용은 지우지 않고 원본 그대로 보관한다
//   (형식 1 → 'tideLab.v1.legacy', 형식 2 → 'tideLab.v2.legacy').

import { STEP_IDS } from '../content/questions.js';

export const SCHEMA_VERSION = 3;
export const SAVE_FORMAT = 'tide-lab-save';
export const BACKUP_FORMAT = 'tide-lab-backup';
export const KEY_PREFIX = 'tideLab.';
export const STUDENT_WORK_KEY = 'tideLab.v1.work';
export const LEGACY_KEY = 'tideLab.v1.legacy';
export const LEGACY_KEYS = { 1: 'tideLab.v1.legacy', 2: 'tideLab.v2.legacy' };
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

/** 문항별 답(형식이 정해진 답은 객체, 글 답은 문자열) */
export function emptyAnswers() {
  return {
    q1: { high: null, low: null, range: '' },
    q2: { high: '', low: '', period: '' },
    q3: { spring: null, neap: null },
    q4: { spring: null, neap: null },
    q5: ['', '', ''],
    q6: {},
    q7: { t0: null, t1: null, text: '' },
    q8: '', q9: '', q10: '', q11: '', q12: '',
  };
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
    answers: emptyAnswers(),
    // 자료 공개: 공개한 순간의 답을 따로 보관(이후 해당 답은 고정)
    reveals: { moon: null, weather: null },
    ui: { inq2Scale: 'same' },
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

/** 보관된 이전 형식 저장 내용 목록 */
export function legacyList() {
  if (previewMode) return [];
  const ls = storage();
  if (!ls) return [];
  const out = [];
  for (const [ver, key] of Object.entries(LEGACY_KEYS)) {
    try {
      const raw = ls.getItem(key);
      if (!raw) continue;
      const o = JSON.parse(raw);
      const answers = o.answers && typeof o.answers === 'object' ? Object.values(o.answers).filter((x) => typeof x === 'string' && x.trim()).length : 0;
      out.push({ version: Number(ver), key, raw, student: o.student || {}, updatedAt: o.updatedAt || null, answers, evidences: Array.isArray(o.evidences) ? o.evidences.length : 0, caseId: o.caseId || '' });
    } catch { /* 읽을 수 없는 보관본은 건너뜀(지우지 않음) */ }
  }
  return out;
}
/** 가장 최근 보관본(이전 이름 호환) */
export const legacyInfo = () => legacyList().sort((a, b) => b.version - a.version)[0] || null;

export function loadLocal() {
  const ls = storage();
  if (!ls) return { state: null, error: '브라우저 저장소를 사용할 수 없습니다.' };
  let raw;
  try { raw = ls.getItem(workKey); } catch (e) { return { state: null, error: e.message }; }
  if (!raw) return { state: null };
  let obj;
  try { obj = JSON.parse(raw); } catch (e) { return { state: null, error: `저장된 내용을 읽을 수 없습니다: ${e.message}`, raw }; }
  // 이전 형식: 원본을 따로 보관하고 새 형식으로 시작(미리보기 저장 내용은 보관하지 않고 새로 시작)
  if (obj && obj.format === SAVE_FORMAT && typeof obj.schemaVersion === 'number' && obj.schemaVersion < SCHEMA_VERSION) {
    if (previewMode) { try { ls.removeItem(workKey); } catch { /* 무시 */ } return { state: null, migrated: false }; }
    const key = LEGACY_KEYS[obj.schemaVersion] || `tideLab.v${obj.schemaVersion}.legacy`;
    try {
      if (!ls.getItem(key)) ls.setItem(key, raw);
      if (ls.getItem(key)) ls.removeItem(workKey);
    } catch (e) { return { state: null, error: `이전 형식 저장 내용을 보관하지 못했습니다: ${e.message}` }; }
    return { state: null, migrated: true, migratedFrom: obj.schemaVersion };
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

export function clearLegacy(key) {
  try {
    const ls = storage();
    if (key) ls?.removeItem(key); else for (const k of Object.values(LEGACY_KEYS)) ls?.removeItem(k);
    return true;
  } catch { return false; }
}

// ───────── 검증 ─────────
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 20000) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const STATION_ID = /^[A-Za-z0-9_-]{1,32}$/;
const TYPES = ['반일주조', '혼합조', '일주조', '판단 어려움'];

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

/** 태양·지구·달 배치(문항 ④). 형식이 맞지 않으면 null */
export function sanitizeOrbit(o) {
  if (!isObj(o)) return null;
  const out = {};
  for (const k of ['sun', 'earth', 'moon']) {
    const b = o[k];
    if (!isObj(b) || num(b.x) == null || num(b.y) == null) return null;
    out[k] = { x: clampN(b.x, 0, 560), y: clampN(b.y, 0, 300), placed: b.placed === true };
  }
  return ['sun', 'earth', 'moon'].some((k) => out[k].placed) ? out : null;
}

const pick = (p) => (isObj(p) && num(p.t) != null ? { t: p.t, v: num(p.v) } : null);
const shortText = (v, max) => str(v, max);

/** 답 정리: 알 수 없는 값은 버리고 빈 답으로 */
export function sanitizeAnswers(a) {
  const x = isObj(a) ? a : {};
  const out = emptyAnswers();
  const q1 = isObj(x.q1) ? x.q1 : {};
  out.q1 = { high: pick(q1.high), low: pick(q1.low), range: shortText(q1.range, 20) };
  const q2 = isObj(x.q2) ? x.q2 : {};
  out.q2 = { high: shortText(q2.high, 10), low: shortText(q2.low, 10), period: shortText(q2.period, 10) };
  const q3 = isObj(x.q3) ? x.q3 : {};
  out.q3 = { spring: typeof q3.spring === 'string' && DAY_KEY.test(q3.spring) ? q3.spring : null, neap: typeof q3.neap === 'string' && DAY_KEY.test(q3.neap) ? q3.neap : null };
  const q4 = isObj(x.q4) ? x.q4 : {};
  out.q4 = { spring: sanitizeOrbit(q4.spring), neap: sanitizeOrbit(q4.neap) };
  // 이전 그림판 그림(배치판으로 바뀌기 전 저장분)은 지우지 않고 따로 보관
  const old = isObj(q4.oldDrawings) ? q4.oldDrawings : {};
  const od = { spring: sanitizeDrawing(old.spring) || (isObj(q4.spring) && q4.spring.strokes ? sanitizeDrawing(q4.spring) : null), neap: sanitizeDrawing(old.neap) || (isObj(q4.neap) && q4.neap.strokes ? sanitizeDrawing(q4.neap) : null) };
  if (od.spring || od.neap) out.q4.oldDrawings = od;
  out.q5 = Array.isArray(x.q5) ? [0, 1, 2].map((i) => (typeof x.q5[i] === 'string' && (x.q5[i] === '' || STATION_ID.test(x.q5[i])) ? x.q5[i] : '')) : ['', '', ''];
  out.q6 = {};
  if (isObj(x.q6)) for (const [k, v] of Object.entries(x.q6).slice(0, 20)) if (STATION_ID.test(k) && isObj(v)) out.q6[k] = { type: TYPES.includes(v.type) ? v.type : '', reason: shortText(v.reason, 500) };
  const q7 = isObj(x.q7) ? x.q7 : {};
  const t0 = num(q7.t0), t1 = num(q7.t1);
  out.q7 = { t0: t0 != null && t1 != null && t1 > t0 ? t0 : null, t1: t0 != null && t1 != null && t1 > t0 ? t1 : null, text: shortText(q7.text, 2000) };
  for (const k of ['q8', 'q9', 'q10', 'q11', 'q12']) out[k] = shortText(x[k], 4000);
  return out;
}

function sanitizeReveal(r, kind) {
  if (!isObj(r) || num(r.at) == null) return null;
  const a = sanitizeAnswers(r.answers || {});
  const keep = kind === 'moon' ? { q3: a.q3, q4: a.q4 } : { q9: a.q9, q10: a.q10 };
  return { at: r.at, answers: keep };
}

/** 저장 형식 검사 및 정리. 형식이 맞지 않으면 예외 */
export function sanitizeState(obj) {
  if (!isObj(obj)) throw new Error('저장 형식이 아닙니다.');
  if (obj.format !== SAVE_FORMAT) throw new Error('조석 데이터 탐구실의 저장 형식이 아닙니다.');
  if (typeof obj.schemaVersion !== 'number') throw new Error('저장 형식 버전 정보가 없습니다.');
  if (obj.schemaVersion > SCHEMA_VERSION) throw new Error(`더 새로운 버전(${obj.schemaVersion})의 앱에서 만든 파일입니다. 이 앱(버전 ${SCHEMA_VERSION})에서는 열 수 없습니다.`);
  if (obj.schemaVersion < SCHEMA_VERSION) throw new Error(`이전 버전(${obj.schemaVersion})의 저장 형식입니다. 탐구 구성과 문항이 바뀌어 이 앱에서는 열 수 없습니다.`);
  if (typeof obj.caseId !== 'string' || !obj.caseId) throw new Error('사례 정보가 없습니다.');
  const s = emptyState(obj.caseId, str(obj.dataVersion, 100));
  const st = isObj(obj.student) ? obj.student : {};
  s.student = { grade: str(st.grade, 10), klass: str(st.klass, 10), number: str(st.number, 10), name: str(st.name, 40) };
  s.started = !!obj.started;
  s.step = STEP_IDS.includes(obj.step) ? obj.step : 'start';
  s.answers = sanitizeAnswers(obj.answers);
  const rv = isObj(obj.reveals) ? obj.reveals : {};
  s.reveals = { moon: sanitizeReveal(rv.moon, 'moon'), weather: sanitizeReveal(rv.weather, 'weather') };
  const ui = isObj(obj.ui) ? obj.ui : {};
  s.ui = { inq2Scale: ui.inq2Scale === 'own' ? 'own' : 'same' };
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
  if (obj.schemaVersion < SCHEMA_VERSION) return { ok: false, error: '이전 버전 앱에서 만든 백업입니다. 탐구 구성과 문항이 바뀌어 불러올 수 없습니다. 파일은 지우지 말고 보관하세요.' };
  let state;
  try { state = sanitizeState(obj.work); } catch (e) { return { ok: false, error: `백업 내용이 올바르지 않습니다: ${e.message}` }; }
  if (obj.caseId !== state.caseId) return { ok: false, error: '백업 파일의 사례 정보가 서로 맞지 않습니다.' };
  if (!knownCaseIds.includes(state.caseId)) return { ok: false, error: `이 앱에 없는 사례(${state.caseId})의 백업입니다.` };
  const warnings = [];
  if (state.caseId !== currentCaseId) warnings.push(`현재 평가 사례와 다른 사례(${state.caseId})의 백업입니다.`);
  else if (state.dataVersion !== currentDataVersion) warnings.push(`백업을 만들 때의 자료 버전(${state.dataVersion})과 현재 자료 버전(${currentDataVersion})이 다릅니다. 기록된 지점의 높이는 백업 당시 값으로 유지됩니다.`);
  return { ok: true, state, warnings };
}

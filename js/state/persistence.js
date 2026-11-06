// 저장과 복구
// - 학생 정보·답안·근거는 현재 브라우저의 localStorage에만 저장한다(외부 서버 전송 없음).
// - 이 앱의 키는 모두 'tideLab.'으로 시작하며, 삭제할 때도 이 키만 지운다.

import { ALL_QUESTION_IDS } from '../content/questions.js';

export const SCHEMA_VERSION = 1;
export const SAVE_FORMAT = 'tide-lab-save';
export const BACKUP_FORMAT = 'tide-lab-backup';
export const KEY_PREFIX = 'tideLab.';
export const WORK_KEY = 'tideLab.v1.work';

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
    answers: {},
    links: {},
    evidences: [],
    evSeq: { 1: 0, 2: 0, 3: 0 },
    analysis: {
      inq1: { view: null, points: [], pair: null },
      inq2: { detailView: null, selectedDays: [], focusDay: null, showMoon: false, contextDays: 2, pair: null },
      inq3: { view: null, marks: [], cursor: null, bottom: 'pressure' },
    },
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
    ls.setItem(WORK_KEY, json);
    if (ls.getItem(WORK_KEY) !== json) return { ok: false, error: '저장한 내용을 다시 확인하지 못했습니다.' };
    return { ok: true, time: Date.now() };
  } catch (e) {
    const quota = e && (e.name === 'QuotaExceededError' || e.code === 22);
    return { ok: false, error: quota ? '브라우저 저장 공간이 부족합니다.' : `저장 오류: ${e?.message || e}` };
  }
}

export function loadLocal() {
  const ls = storage();
  if (!ls) return { state: null, error: '브라우저 저장소를 사용할 수 없습니다.' };
  let raw;
  try { raw = ls.getItem(WORK_KEY); } catch (e) { return { state: null, error: e.message }; }
  if (!raw) return { state: null };
  try {
    const obj = JSON.parse(raw);
    return { state: sanitizeState(obj) };
  } catch (e) {
    return { state: null, error: `저장된 내용을 읽을 수 없습니다: ${e.message}`, raw };
  }
}

/** 이 앱의 작성 내용만 삭제 */
export function clearLocal() {
  const ls = storage();
  if (!ls) return { ok: false, error: '브라우저 저장소를 사용할 수 없습니다.' };
  try {
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

// ───────── 검증 ─────────
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 200000) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const range = (v) => (Array.isArray(v) && v.length === 2 && num(v[0]) != null && num(v[1]) != null && v[1] > v[0] ? [v[0], v[1]] : null);

function labeledTimes(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter((p) => isObj(p) && typeof p.label === 'string' && num(p.t) != null).slice(0, 26).map((p) => ({ label: p.label.slice(0, 3), t: p.t }));
}

function sanitizeAnalysis(a) {
  const e = emptyState('', '').analysis;
  if (!isObj(a)) return e;
  const i1 = isObj(a.inq1) ? a.inq1 : {};
  const i2 = isObj(a.inq2) ? a.inq2 : {};
  const i3 = isObj(a.inq3) ? a.inq3 : {};
  return {
    inq1: { view: range(i1.view), points: labeledTimes(i1.points), pair: Array.isArray(i1.pair) ? i1.pair.slice(0, 2).map(String) : null },
    inq2: {
      detailView: range(i2.detailView),
      selectedDays: Array.isArray(i2.selectedDays) ? i2.selectedDays.filter((d) => isObj(d) && /^\d{4}-\d{2}-\d{2}$/.test(d.day) && typeof d.label === 'string').slice(0, 26).map((d) => ({ label: d.label.slice(0, 3), day: d.day })) : [],
      focusDay: typeof i2.focusDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(i2.focusDay) ? i2.focusDay : null,
      showMoon: !!i2.showMoon,
      contextDays: [1, 2, 3].includes(i2.contextDays) ? i2.contextDays : 2,
      pair: Array.isArray(i2.pair) ? i2.pair.slice(0, 2).map(String) : null,
    },
    inq3: {
      view: range(i3.view),
      marks: labeledTimes(i3.marks),
      cursor: num(i3.cursor),
      bottom: ['pressure', 'windSpeed', 'windDir'].includes(i3.bottom) ? i3.bottom : 'pressure',
    },
  };
}

function sanitizeEvidence(ev) {
  if (!isObj(ev)) return null;
  if (![1, 2, 3].includes(ev.inquiry)) return null;
  if (typeof ev.id !== 'string' || typeof ev.num !== 'string') return null;
  if (!isObj(ev.state) || !isObj(ev.values)) return null;
  const st = sanitizeAnalysis({ [`inq${ev.inquiry}`]: ev.state })[`inq${ev.inquiry}`];
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
    datasets: Array.isArray(ev.datasets) ? ev.datasets.filter(isObj).map((d) => ({ label: str(d.label, 200), identifier: str(d.identifier, 200) })) : [],
    period: range(ev.period),
    state: st,
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
  if (typeof obj.caseId !== 'string' || !obj.caseId) throw new Error('사례 정보가 없습니다.');
  const s = emptyState(obj.caseId, str(obj.dataVersion, 100));
  const st = isObj(obj.student) ? obj.student : {};
  s.student = { grade: str(st.grade, 10), klass: str(st.klass, 10), number: str(st.number, 10), name: str(st.name, 40) };
  s.started = !!obj.started;
  s.step = ['start', 'inq1', 'inq2', 'inq3', 'conclusion', 'report'].includes(obj.step) ? obj.step : 'start';
  if (isObj(obj.answers)) for (const id of ALL_QUESTION_IDS) if (typeof obj.answers[id] === 'string') s.answers[id] = obj.answers[id].slice(0, 200000);
  s.evidences = Array.isArray(obj.evidences) ? obj.evidences.map(sanitizeEvidence).filter(Boolean) : [];
  const evIds = new Set(s.evidences.map((e) => e.id));
  if (isObj(obj.links)) for (const id of ALL_QUESTION_IDS) if (Array.isArray(obj.links[id])) s.links[id] = obj.links[id].filter((x) => evIds.has(x));
  if (isObj(obj.evSeq)) for (const k of [1, 2, 3]) s.evSeq[k] = num(obj.evSeq[k]) ?? 0;
  for (const ev of s.evidences) s.evSeq[ev.inquiry] = Math.max(s.evSeq[ev.inquiry], ev.seq);
  s.analysis = sanitizeAnalysis(obj.analysis);
  s.createdAt = num(obj.createdAt) ?? s.createdAt;
  s.updatedAt = num(obj.updatedAt) ?? s.updatedAt;
  s.lastPdfAt = num(obj.lastPdfAt);
  return s;
}

// ───────── 백업 파일 ─────────
export function backupFilename(state) {
  const s = state.student;
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
  const who = `${s.grade || ''}학년${s.klass || ''}반${s.number || ''}번_${s.name || '이름없음'}`;
  return safeFilename(`조석탐구_백업_${who}_${stamp}.json`);
}

export function safeFilename(name) {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, '');
}

export function makeBackupText(state) {
  return JSON.stringify({
    format: BACKUP_FORMAT,
    app: '조석 데이터 탐구실',
    schemaVersion: SCHEMA_VERSION,
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
  let state;
  try { state = sanitizeState(obj.work); } catch (e) { return { ok: false, error: `백업 내용이 올바르지 않습니다: ${e.message}` }; }
  if (obj.caseId !== state.caseId) return { ok: false, error: '백업 파일의 사례 정보가 서로 맞지 않습니다.' };
  if (!knownCaseIds.includes(state.caseId)) return { ok: false, error: `이 앱에 없는 사례(${state.caseId})의 백업입니다.` };
  const warnings = [];
  if (state.caseId !== currentCaseId) warnings.push(`현재 선택된 사례와 다른 사례(${state.caseId})의 백업입니다. 불러오면 그 사례로 전환됩니다.`);
  else if (state.dataVersion !== currentDataVersion) warnings.push(`백업을 만들 때의 자료 버전(${state.dataVersion})과 현재 자료 버전(${currentDataVersion})이 다릅니다. 근거에 기록된 값은 백업 당시의 값으로 유지됩니다.`);
  return { ok: true, state, warnings };
}

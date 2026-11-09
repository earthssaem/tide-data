// 응시 기록(재응시 공정성): 같은 컴퓨터·브라우저에서 학생별로 시작·이어 하기·백업 불러오기 시각과
// 자료 공개([달의 위상 확인]·[추가 자료 확인]) 시각, 그때 고정한 답을 남긴다.
// - 키는 'tideLabAssess.v1.attempts'(평가 기록과 같은 계열). 학생의 '내 작성 내용 삭제'(tideLab.* 키)로 지워지지 않는다.
// - 같은 학생(학년·반·번호·이름)이 새로 시작하거나 공개 전 백업을 불러와도, 이미 공개한 단계의 답은 그때 답으로 고정된다.
// - 기록은 학생 브라우저에만 있으므로 다른 컴퓨터·브라우저의 기록은 알 수 없고, 브라우저 설정으로 지울 수 있다(무결성 보장 없음).
//   보고서에 '이 컴퓨터의 응시 기록'으로 보여 주어 교사가 판단하게 한다. 외부로 보내지 않는다.

export const ATTEMPTS_FORMAT = 'tide-lab-attempts';
export const STUDENT_ATTEMPTS_KEY = 'tideLabAssess.v1.attempts';
export const PREVIEW_ATTEMPTS_KEY = 'tideLabTeacher.v1.attempts';
const MAX_EVENTS = 60;

let key = STUDENT_ATTEMPTS_KEY;
export function setAttemptsMode(mode) { key = mode === 'preview' ? PREVIEW_ATTEMPTS_KEY : STUDENT_ATTEMPTS_KEY; }

const ls = () => { try { return window.localStorage; } catch { return null; } };
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/** 학생을 구분하는 값(공백·기호·대소문자 차이 무시) */
export function studentKey(caseId, st) {
  const n = (s) => String(s || '').normalize('NFC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase(); // 공백·기호 차이로 기록을 피하지 못하게
  if (!st || !n(st.name) || !n(st.number)) return null;
  return `${caseId}|${n(st.grade)}-${n(st.klass)}-${n(st.number)}-${n(st.name)}`;
}

export function loadAttempts() {
  try {
    const o = JSON.parse(ls()?.getItem(key) || 'null');
    if (isObj(o) && o.format === ATTEMPTS_FORMAT && isObj(o.students)) return o;
  } catch { /* 읽을 수 없으면 새로 */ }
  return { format: ATTEMPTS_FORMAT, version: 1, students: {} };
}

function save(o) {
  try { ls()?.setItem(key, JSON.stringify(o)); return true; } catch { return false; }
}

export function entryFor(caseId, student) {
  const k = studentKey(caseId, student);
  return k ? loadAttempts().students[k] || null : null;
}

/** 사건 기록: how = 'new'|'continue'|'import'|'reveal-moon'|'reveal-weather' */
export function recordEvent(caseId, student, how, detail = {}) {
  const k = studentKey(caseId, student);
  if (!k) return null;
  const o = loadAttempts();
  const e = o.students[k] || { student: { ...student }, firstAt: Date.now(), events: [], reveals: { moon: null, weather: null } };
  e.events.push({ at: Date.now(), how, ...detail });
  if (e.events.length > MAX_EVENTS) e.events = e.events.slice(-MAX_EVENTS);
  o.students[k] = e;
  save(o);
  return e;
}

/** 자료 공개 기록(처음 공개한 것만 남김) */
export function recordReveal(caseId, student, kind, reveal) {
  const k = studentKey(caseId, student);
  if (!k || !reveal) return;
  const o = loadAttempts();
  const e = o.students[k] || { student: { ...student }, firstAt: Date.now(), events: [], reveals: { moon: null, weather: null } };
  if (!e.reveals[kind]) e.reveals[kind] = JSON.parse(JSON.stringify(reveal));
  e.events.push({ at: Date.now(), how: `reveal-${kind}` });
  o.students[k] = e;
  save(o);
}

/**
 * 이 학생이 이 컴퓨터에서 이미 공개한 단계를 작성 내용에 적용(공개 기록이 없는 단계만).
 * @returns {string[]} 적용한 단계 이름(moon/weather)
 */
export function applyPriorReveals(state) {
  const e = entryFor(state.caseId, state.student);
  if (!e) return [];
  const applied = [];
  for (const kind of ['moon', 'weather']) {
    const r = e.reveals?.[kind];
    if (r && !state.reveals[kind]) { state.reveals[kind] = JSON.parse(JSON.stringify(r)); applied.push(kind); }
    else if (r && state.reveals[kind] && r.at < state.reveals[kind].at) { state.reveals[kind] = JSON.parse(JSON.stringify(r)); applied.push(kind); }
  }
  return applied;
}

const HOW = { new: '새로 시작', continue: '이어서 작성', import: '백업 파일 불러오기', 'reveal-moon': '[달의 위상 확인]', 'reveal-weather': '[추가 자료 확인]', 'prior-reveal': '이전 공개 기록 적용' };
export const howLabel = (h) => HOW[h] || h;

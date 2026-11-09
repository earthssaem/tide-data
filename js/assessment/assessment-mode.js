// 전체화면 평가 모드 — 기존 앱과 독립된 모듈
//
// 하는 일
//  - 접속하면 평가 시작 안내를 보여 주고, [평가 시작]을 눌러 전체화면 진입에 성공해야 평가가 시작된다.
//  - 평가 중 화면 이탈(전체화면 해제, 화면 숨김, 2초 이상 포커스 상실, 페이지 이탈)을 감지하면
//    즉시 기록하고 평가를 일시 중지한다(불투명 오버레이 + 입력 차단).
//  - [전체화면으로 복귀]를 눌러 전체화면 진입에 성공해야만 평가가 재개된다.
//  - 기록은 localStorage에만 저장하며, 세션별로 구분하고 JSON으로 내려받을 수 있다.
//
// 하지 않는 일
//  - 버튼 클릭 없이 전체화면을 강제로 시작하거나 재진입시키지 않는다(브라우저 정책상 불가능하기도 함).
//  - 전체화면 종료 자체를 막지 않는다(막을 수 없음). 종료되면 기록하고 중지할 뿐이다.
//  - 이탈 원인을 단정하거나 부정행위를 판정하지 않는다.
//
// 기존 앱과의 연결 지점
//  - document에 'tidelab:assessment-pause' / 'tidelab:assessment-resume' / 'tidelab:assessment-start' /
//    'tidelab:assessment-end' 이벤트를 보낸다(detail에 이유·세션 ID).
//  - window.TideAssessment.isPaused(), .getState(), .onChange(fn)
//  - 기존 앱(main.js)은 pause 이벤트를 받아 입력 중인 답안을 즉시 저장한다.

import { ASSESSMENT_CONFIG as CFG } from './config.js';
import {
  emptyLog, sanitizeLog, makeSessionId, newSession, recordDeparture, addSignal, closeIncident, endSession,
  openIncident, departureCount, exportLog, localIso, fmtDurationKo, DEPARTURE_TYPES,
} from './session-log.js';

// ───────── 저장소 ─────────
function readLog() {
  try {
    const raw = localStorage.getItem(CFG.storageKey);
    return raw ? sanitizeLog(JSON.parse(raw), CFG.maxSessions) : emptyLog();
  } catch {
    return emptyLog();
  }
}
function writeLog(log) {
  try {
    const json = JSON.stringify(log);
    localStorage.setItem(CFG.storageKey, json);
    return localStorage.getItem(CFG.storageKey) === json;
  } catch {
    return false;
  }
}
/** 항상 저장소의 최신 값을 읽어 고친 뒤 저장한다(여러 탭이 열려 있어도 덮어쓰기를 줄임) */
function mutate(fn) {
  const log = readLog();
  const result = fn(log);
  const ok = writeLog(log);
  return { log, result, ok };
}
function activeSession(log) {
  return log.sessions.find((s) => s.id === log.activeId && s.status !== 'ended') || null;
}
function readStudentWork() {
  try {
    const w = JSON.parse(localStorage.getItem(CFG.workStorageKey) || 'null');
    if (!w || typeof w !== 'object') return null;
    return { student: w.student || null, caseId: w.caseId || null, lastPdfAt: w.lastPdfAt || null };
  } catch {
    return null;
  }
}

// ───────── 전체화면 API (접두어 대응) ─────────
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
const fsSupported = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled)
  && !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
async function requestFs() {
  const el = document.documentElement;
  if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
  else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  else throw new Error('이 브라우저는 전체화면 기능을 지원하지 않습니다.');
  // 일부 브라우저는 약속을 돌려주지 않으므로 실제 상태를 확인
  for (let i = 0; i < 10 && !fsElement(); i++) await new Promise((r) => setTimeout(r, 50));
  if (!fsElement()) throw new Error('전체화면으로 전환되지 않았습니다.');
}
async function exitFs() {
  if (!fsElement()) return;
  try {
    if (document.exitFullscreen) await document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  } catch { /* 이미 해제됨 */ }
}

// ───────── 화면 요소 ─────────
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtLocal = (ms) => (ms == null ? '—' : localIso(ms).replace('T', ' ').slice(0, 19));

let root, overlay, pill, modal;
const inerted = new Set();

function buildDom() {
  root = document.createElement('div');
  root.id = 'asmt-root';
  root.innerHTML = `
    <div class="asmt-overlay" role="dialog" aria-modal="true" aria-labelledby="asmt-title" hidden></div>
    <div class="asmt-pill" role="region" aria-label="평가 진행 상태" hidden></div>
    <div class="asmt-modal-backdrop" hidden><div class="asmt-modal" role="alertdialog" aria-modal="true" aria-labelledby="asmt-modal-title"></div></div>`;
  document.body.append(root);
  overlay = root.querySelector('.asmt-overlay');
  pill = root.querySelector('.asmt-pill');
  modal = root.querySelector('.asmt-modal-backdrop');
}

/** 평가 콘텐츠 가리기: 오버레이 아래의 모든 요소를 inert(포커스·클릭·키 입력 불가)로 */
function blockContent(on) {
  if (on) {
    for (const el of document.body.children) {
      if (el === root || el.tagName === 'SCRIPT' || el.hasAttribute('inert')) continue;
      el.setAttribute('inert', '');
      inerted.add(el);
    }
    // 열린 앱 대화상자(<dialog>)는 최상위 층에 그려져 오버레이 위로 보일 수 있으므로 닫는다(취소로 처리됨)
    document.querySelectorAll('dialog[open]').forEach((d) => { try { d.close('cancel'); } catch { /* 무시 */ } });
    document.querySelectorAll('details.menu[open]').forEach((d) => { d.open = false; });
    document.documentElement.classList.add('asmt-blocked');
  } else {
    inerted.forEach((el) => el.removeAttribute('inert'));
    inerted.clear();
    document.documentElement.classList.remove('asmt-blocked');
  }
}

// ───────── 상태 ─────────
const state = {
  phase: 'init', // init | idle | running | paused | ending | ended | disabled
  sessionId: null,
  reason: null,
  pendingBlur: null, // {at, timer}
  appDialog: null, // {kind, armedAt, blurredAt, until}
  lastSaveOk: true,
  busy: false,
};
const listeners = new Set();
function setPhase(phase, extra = {}) {
  Object.assign(state, extra, { phase });
  document.documentElement.dataset.asmt = phase;
  listeners.forEach((fn) => { try { fn(getState()); } catch { /* 무시 */ } });
}
function getState() {
  const log = readLog();
  const s = log.sessions.find((x) => x.id === state.sessionId) || null;
  return { phase: state.phase, sessionId: state.sessionId, paused: state.phase !== 'running', departureCount: departureCount(s) };
}
function emit(name, detail = {}) {
  document.dispatchEvent(new CustomEvent(`tidelab:assessment-${name}`, { detail: { sessionId: state.sessionId, ...detail } }));
}

// ───────── 화면: 시작 안내 ─────────
function showGuide(message = '') {
  const log = readLog();
  const past = log.sessions.filter((s) => s.status === 'ended');
  const supported = fsSupported();
  overlay.className = 'asmt-overlay asmt-guide';
  overlay.innerHTML = `
    <div class="asmt-card">
      <p class="asmt-kicker">조석 데이터 탐구실</p>
      <h1 id="asmt-title">평가 시작 안내</h1>
      <ul class="asmt-rules">
        <li>[평가 시작]을 누르면 화면이 <b>전체화면</b>으로 바뀌고 평가가 시작됩니다.</li>
        <li>평가 중에는 전체화면을 유지해야 합니다. 전체화면을 해제하거나, 다른 탭·창으로 이동하거나, 창 포커스를 2초 이상 잃으면 <b>평가가 일시 중지</b>되고 <b>화면 이탈 기록</b>이 남습니다.</li>
        <li>중지되면 [전체화면으로 복귀]를 눌러 전체화면으로 돌아와야 계속할 수 있습니다.</li>
        <li>작성한 답안은 지금처럼 이 브라우저에 자동 저장됩니다. 화면 이탈 기록도 이 컴퓨터의 브라우저에만 저장되며 외부로 전송되지 않습니다.</li>
        <li>평가를 마치면 PDF 보고서를 내려받은 뒤 화면 아래의 [평가 종료]를 누르세요.</li>
      </ul>
      ${supported ? '' : '<p class="asmt-error" role="alert">이 브라우저는 전체화면 기능을 지원하지 않아 평가를 시작할 수 없습니다. 선생님께 알려 주세요.</p>'}
      <p class="asmt-error" role="alert" ${message ? '' : 'hidden'}>${esc(message)}</p>
      <div class="asmt-actions">
        <button type="button" class="asmt-btn asmt-btn-primary" data-act="start" ${supported ? '' : 'disabled'}>평가 시작</button>
      </div>
      ${past.length ? `<p class="asmt-small">이 컴퓨터에 지난 평가 기록 ${past.length}건이 있습니다. <button type="button" class="asmt-link" data-act="download">화면 이탈 기록 받기(JSON)</button></p>` : ''}
    </div>`;
  overlay.hidden = false;
  pill.hidden = true;
  blockContent(true);
  overlay.querySelector('[data-act=start]')?.focus();
}

// ───────── 화면: 일시 중지 ─────────
const PAUSE_LINE2 = {
  'fullscreen-exit': '전체화면 모드가 해제되었습니다.',
  hidden: '화면이 숨겨졌습니다(다른 탭이나 창으로 전환됨).',
  'focus-loss': '브라우저 창이 2초 이상 포커스를 잃었습니다.',
  'page-leave': '페이지를 다시 불러왔거나 다시 접속했습니다. 전체화면 모드가 해제되었습니다.',
  reconnect: '페이지를 다시 불러왔거나 다시 접속했습니다. 전체화면 모드가 해제되었습니다.',
};
function showPaused(message = '') {
  const log = readLog();
  const s = log.sessions.find((x) => x.id === state.sessionId);
  const inc = s ? openIncident(s) : null;
  const type = inc?.type || 'fullscreen-exit';
  overlay.className = 'asmt-overlay asmt-paused';
  overlay.innerHTML = `
    <div class="asmt-card">
      <div class="asmt-icon" aria-hidden="true">!</div>
      <h1 id="asmt-title">평가가 일시 중지되었습니다.</h1>
      <p class="asmt-lines">
        <span>${esc(PAUSE_LINE2[type] || PAUSE_LINE2['fullscreen-exit'])}</span>
        <span>평가를 계속하려면 전체화면으로 복귀하세요.</span>
        <span class="${state.lastSaveOk ? '' : 'asmt-error'}">${state.lastSaveOk ? '화면 이탈 기록이 저장되었습니다.' : '화면 이탈 기록을 저장하지 못했습니다(브라우저 저장 공간 문제). 선생님께 알려 주세요.'}</span>
      </p>
      <p class="asmt-error" role="alert" ${message ? '' : 'hidden'}>${esc(message)}</p>
      <div class="asmt-actions">
        <button type="button" class="asmt-btn asmt-btn-primary" data-act="resume">전체화면으로 복귀</button>
      </div>
      <p class="asmt-small asmt-muted">세션 ${esc(state.sessionId || '')} · 이 세션의 화면 이탈 ${departureCount(s)}회${inc ? ` · 이번 이탈 시작 ${esc(fmtLocal(inc.startedAt))}${inc.startEstimated ? '(추정)' : ''}` : ''}</p>
    </div>`;
  overlay.hidden = false;
  pill.hidden = true;
  closeModal();
  blockContent(true);
  overlay.querySelector('[data-act=resume]')?.focus();
}

// ───────── 화면: 종료 ─────────
function showEnded(sessionId) {
  const log = readLog();
  const s = log.sessions.find((x) => x.id === sessionId);
  overlay.className = 'asmt-overlay asmt-ended';
  const rows = (s?.departures || []).map((d) => `<tr><td>${d.no}</td><td>${esc(d.typeLabel)}</td><td>${esc(fmtLocal(d.startedAt))}${d.startEstimated ? ' (추정)' : ''}</td><td>${esc(fmtLocal(d.returnedAt))}</td><td>${esc(fmtDurationKo(d.durationMs) || '—')}</td></tr>`).join('');
  overlay.innerHTML = `
    <div class="asmt-card asmt-card-wide">
      <h1 id="asmt-title">평가가 종료되었습니다.</h1>
      <p>전체화면 모드가 해제되었고 화면 이탈 감지를 멈췄습니다. 정상 종료는 화면 이탈로 집계하지 않습니다.</p>
      <dl class="asmt-dl">
        <div><dt>세션 ID</dt><dd>${esc(s?.id || '')}</dd></div>
        <div><dt>시작</dt><dd>${esc(fmtLocal(s?.startedAt))}</dd></div>
        <div><dt>종료</dt><dd>${esc(fmtLocal(s?.endedAt))}</dd></div>
        <div><dt>화면 이탈</dt><dd>${departureCount(s)}회</dd></div>
      </dl>
      ${rows ? `<div class="asmt-table-wrap"><table class="asmt-table"><thead><tr><th>번호</th><th>유형(관찰된 신호)</th><th>이탈 시각</th><th>복귀 시각</th><th>지속 시간</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
      <div class="asmt-actions">
        <button type="button" class="asmt-btn asmt-btn-primary" data-act="download">화면 이탈 기록 받기(JSON)</button>
        <button type="button" class="asmt-btn" data-act="new">새 평가 시작 안내로</button>
      </div>
    </div>`;
  overlay.hidden = false;
  pill.hidden = true;
  closeModal();
  blockContent(true);
  overlay.querySelector('[data-act=download]')?.focus();
}

// ───────── 진행 중 표시 ─────────
function showRunning() {
  overlay.hidden = true;
  overlay.innerHTML = '';
  blockContent(false);
  renderPill();
  pill.hidden = false;
}
function renderPill() {
  const log = readLog();
  const s = log.sessions.find((x) => x.id === state.sessionId);
  pill.innerHTML = `<span class="asmt-dot" aria-hidden="true"></span><span>평가 진행 중</span><span class="asmt-pill-count">화면 이탈 기록 ${departureCount(s)}회</span><button type="button" class="asmt-btn asmt-btn-sm" data-act="end">평가 종료</button>`;
}

function closeModal() { modal.hidden = true; modal.firstElementChild.innerHTML = ''; }
function confirmEnd() {
  const work = readStudentWork();
  const box = modal.firstElementChild;
  box.innerHTML = `
    <h2 id="asmt-modal-title">평가를 종료할까요?</h2>
    <p>종료하면 전체화면이 해제되고 화면 이탈 감지를 멈춥니다. 이 평가 세션은 다시 이어서 진행할 수 없습니다.</p>
    <p class="${work?.lastPdfAt ? '' : 'asmt-error'}">${work?.lastPdfAt ? `PDF 보고서를 마지막으로 만든 시각: ${esc(fmtLocal(work.lastPdfAt))}. 그 뒤에 답안을 고쳤다면 먼저 PDF를 다시 내려받으세요.` : '아직 PDF 보고서를 내려받지 않았습니다. 보고서 미리보기에서 PDF를 먼저 내려받으세요.'}</p>
    <div class="asmt-actions">
      <button type="button" class="asmt-btn" data-act="cancel-end">계속 평가하기</button>
      <button type="button" class="asmt-btn asmt-btn-danger" data-act="confirm-end">평가 종료</button>
    </div>`;
  modal.hidden = false;
  box.querySelector('[data-act=cancel-end]').focus();
}

// ───────── 동작 ─────────
async function startAssessment() {
  if (state.busy) return;
  state.busy = true;
  try {
    await requestFs();
  } catch (e) {
    state.busy = false;
    showGuide(`전체화면으로 전환하지 못해 평가를 시작하지 않았습니다. (${e.message || e}) 다시 [평가 시작]을 누르세요.`);
    return;
  }
  const now = Date.now();
  const work = readStudentWork();
  const id = makeSessionId(now);
  const { ok } = mutate((log) => {
    log.sessions.push(newSession({ id, startedAt: now, caseId: work?.caseId || null, userAgent: navigator.userAgent }));
    log.activeId = id;
  });
  state.lastSaveOk = ok;
  state.busy = false;
  setPhase('running', { sessionId: id });
  showRunning();
  emit('start');
  emit('resume', { reason: 'start' });
}

async function resumeAssessment() {
  if (state.busy || state.phase !== 'paused') return;
  state.busy = true;
  const btn = overlay.querySelector('[data-act=resume]');
  if (btn) { btn.disabled = true; btn.textContent = '전체화면으로 전환 중…'; }
  try {
    await requestFs();
  } catch (e) {
    mutate((log) => { const s = activeSession(log); if (s) addSignal(s, { type: 'resume-failed', at: Date.now(), detail: String(e.message || e) }); });
    state.busy = false;
    showPaused('전체화면으로 복귀하지 못했습니다. 평가는 계속 중지 상태입니다. 다시 [전체화면으로 복귀]를 누르세요.');
    return;
  }
  const { ok } = mutate((log) => {
    const s = activeSession(log);
    if (s) { closeIncident(s, Date.now()); s.lastSeenAt = Date.now(); }
  });
  state.lastSaveOk = ok;
  state.busy = false;
  setPhase('running', { reason: null });
  showRunning();
  emit('resume', { reason: 'fullscreen-restored' });
}

async function finishAssessment() {
  if (state.phase !== 'running') return;
  const id = state.sessionId;
  setPhase('ending'); // 감지를 먼저 멈춘다(종료로 생기는 fullscreenchange는 이탈이 아님)
  cancelPendingBlur();
  mutate((log) => {
    const s = log.sessions.find((x) => x.id === id);
    if (s) endSession(s, Date.now());
    log.activeId = null;
  });
  closeModal();
  await exitFs();
  setPhase('ended', { sessionId: id });
  showEnded(id);
  emit('end');
}

function downloadLog() {
  const log = readLog();
  const work = readStudentWork();
  const data = exportLog(log, { student: work?.student || null });
  const st = work?.student;
  const who = st ? `${st.grade}학년${st.klass}반${st.number}번_${st.name}` : '학생정보없음';
  const sid = data.currentSessionId || 'none';
  const name = `화면이탈기록_${who}_${sid}.json`.replace(/[\\/:*?"<>|\u0000-\u001f\s]/g, '_');
  // 다운로드 자체가 저장 창을 띄워 포커스를 잃을 수 있으므로 앱 대화상자로 표시
  armAppDialog('download');
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.style.display = 'none';
  root.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
}

// ───────── 이탈 감지 ─────────
function departure(type, { at = Date.now(), detail = '' } = {}) {
  if (state.phase === 'running') {
    const extra = [];
    if (state.pendingBlur) {
      // 같은 행동으로 먼저 생긴 blur는 이 사건의 시작으로 함께 기록
      extra.push({ type: 'blur', at: state.pendingBlur.at, detail: '' });
      cancelPendingBlur();
    }
    const { ok } = mutate((log) => {
      const s = activeSession(log);
      if (!s) return;
      recordDeparture(s, { type, at, detail, extraSignals: extra });
      s.lastSeenAt = Date.now();
    });
    state.lastSaveOk = ok;
    setPhase('paused', { reason: type });
    showPaused();
    emit('pause', { reason: type });
  } else if (state.phase === 'paused') {
    // 이미 중지된 같은 사건: 신호를 추가하고 유형만 갱신(횟수 증가 없음)
    mutate((log) => { const s = activeSession(log); if (s) recordDeparture(s, { type, at, detail }); });
  }
}

function signal(type, detail = '') {
  if (state.phase !== 'paused') return;
  mutate((log) => { const s = activeSession(log); if (s) addSignal(s, { type, at: Date.now(), detail }); });
}

function cancelPendingBlur() {
  if (state.pendingBlur) clearTimeout(state.pendingBlur.timer);
  state.pendingBlur = null;
}

/** 앱 기능(파일 선택, 다운로드 저장 창, 인쇄)으로 생기는 포커스 상실을 이탈과 구분하기 위한 표시 */
function armAppDialog(kind) {
  if (state.phase !== 'running') return;
  state.appDialog = { kind, armedAt: Date.now(), blurredAt: null, until: Date.now() + CFG.appDialogGraceMs };
}
function appDialogCovers(now) {
  const d = state.appDialog;
  if (!d) return false;
  if (d.blurredAt == null) {
    if (now > d.until) { state.appDialog = null; return false; }
    d.blurredAt = now;
    d.until = now + CFG.appDialogMaxMs;
    return true;
  }
  return now <= d.until;
}
function closeAppDialog() {
  const d = state.appDialog;
  if (!d) return;
  state.appDialog = null;
  if (d.blurredAt != null) {
    mutate((log) => {
      const s = activeSession(log);
      if (s) { s.appDialogNotes = s.appDialogNotes || []; s.appDialogNotes.push({ kind: d.kind, from: d.blurredAt, to: Date.now() }); }
    });
  }
}

function onFullscreenChange() {
  if (fsElement()) return; // 진입은 무시
  const ctx = state.appDialog?.kind === 'print' ? '인쇄 대화상자 사용 중' : '';
  departure('fullscreen-exit', { detail: ctx });
}
function onVisibility() {
  if (document.visibilityState === 'hidden') departure('hidden');
  else signal('visible');
}
function onBlur() {
  const now = Date.now();
  if (state.phase === 'paused') { signal('blur'); return; }
  if (state.phase !== 'running' || state.pendingBlur) return;
  if (appDialogCovers(now)) return;
  state.pendingBlur = {
    at: now,
    timer: setTimeout(() => {
      const at = state.pendingBlur?.at ?? now;
      state.pendingBlur = null;
      if (state.phase !== 'running') return;
      const { ok } = mutate((log) => {
        const s = activeSession(log);
        if (!s) return;
        recordDeparture(s, { type: 'focus-loss', at, extraSignals: [{ type: 'blur', at }], detail: `포커스 상실 ${CFG.focusLossThresholdMs / 1000}초 경과` });
        s.lastSeenAt = Date.now();
      });
      state.lastSaveOk = ok;
      setPhase('paused', { reason: 'focus-loss' });
      showPaused();
      emit('pause', { reason: 'focus-loss' });
    }, CFG.focusLossThresholdMs),
  };
}
function onFocus() {
  if (state.pendingBlur) cancelPendingBlur(); // 2초 미만 → 이탈 아님
  if (state.appDialog?.blurredAt != null) closeAppDialog();
  signal('focus');
}
function onPageHide(e) {
  if (state.phase !== 'running' && state.phase !== 'paused') return;
  departure('page-leave', { detail: e.persisted ? '뒤로·앞으로 캐시로 보관됨' : '' });
}
function onPageShow(e) {
  if (!e.persisted) return;
  const log = readLog();
  const s = activeSession(log);
  if (!s) return;
  state.sessionId = s.id;
  mutate((l) => { const x = activeSession(l); if (x) { if (!addSignal(x, { type: 'reload', at: Date.now(), detail: '뒤로·앞으로 캐시에서 복원' })) recordDeparture(x, { type: 'reconnect', at: Date.now() }); } });
  setPhase('paused', { reason: 'reload' });
  showPaused();
}

/** 오버레이가 떠 있는 동안 오버레이 밖으로 가는 키 입력을 막는다(Tab은 오버레이 안 버튼으로 보냄) */
function onKeyCapture(e) {
  if (state.phase === 'running' || state.phase === 'disabled' || state.phase === 'init') return;
  if (!overlay.hidden && overlay.contains(e.target)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.type === 'keydown' && e.key === 'Tab' && !overlay.hidden) overlay.querySelector('button:not([disabled])')?.focus();
}

function onClickCapture(e) {
  const t = e.target;
  if (!(t instanceof Element)) return;
  if (t.matches('input[type=file]')) armAppDialog('file-picker');
  else if (t.matches('a[download]') && !root.contains(t)) armAppDialog('download');
}

function onRootClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'start') startAssessment();
  else if (act === 'resume') resumeAssessment();
  else if (act === 'end') confirmEnd();
  else if (act === 'cancel-end') closeModal();
  else if (act === 'confirm-end') finishAssessment();
  else if (act === 'download') downloadLog();
  else if (act === 'new') { setPhase('idle', { sessionId: null }); showGuide(); }
}

// ───────── 시작 ─────────
function init() {
  // 교사용 설정 화면(?mode=teacher)에는 학생 탐구 화면이 없으므로 평가 모드를 쓰지 않는다
  // (학생 화면·교사용 미리보기에서는 주소창 매개변수로 끌 수 없음)
  let teacherScreen = false;
  try { teacherScreen = new URLSearchParams(location.search).get('mode') === 'teacher'; } catch { /* 무시 */ }
  if (!CFG.enabled || teacherScreen) { setPhase('disabled'); return; }
  buildDom();
  root.addEventListener('click', onRootClick);
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('beforeprint', () => { if (state.phase === 'running') state.appDialog = { kind: 'print', armedAt: Date.now(), blurredAt: Date.now(), until: Date.now() + CFG.appDialogMaxMs }; });
  window.addEventListener('afterprint', () => { if (state.appDialog?.kind === 'print') closeAppDialog(); });
  window.addEventListener('keydown', onKeyCapture, true);
  window.addEventListener('keyup', onKeyCapture, true);
  document.addEventListener('click', onClickCapture, true);
  setInterval(() => {
    if (state.phase !== 'running' && state.phase !== 'paused') return;
    mutate((log) => { const s = activeSession(log); if (s) s.lastSeenAt = Date.now(); });
    if (state.phase === 'running') renderPill();
  }, CFG.heartbeatMs);

  const log = readLog();
  const s = activeSession(log);
  if (!s) {
    setPhase('idle');
    showGuide();
    return;
  }
  // 진행 중이던 세션: 새로고침·재접속 → 전체화면 복귀 전까지 중지 상태 유지
  const now = Date.now();
  const { ok } = mutate((l) => {
    const x = activeSession(l);
    if (!x) return;
    if (openIncident(x)) addSignal(x, { type: 'reload', at: now, detail: '이탈 중 페이지를 다시 불러옴' });
    else recordDeparture(x, { type: 'reconnect', at: x.lastSeenAt || now, estimated: true, detail: '이전 페이지의 종료 신호(pagehide)가 기록되지 않음 — 시작 시각은 마지막 확인 시각으로 추정' });
    x.lastSeenAt = now;
  });
  state.lastSaveOk = ok;
  setPhase('paused', { sessionId: s.id, reason: 'reload' });
  showPaused();
  emit('pause', { reason: 'reload' });
}

window.TideAssessment = {
  isPaused: () => state.phase !== 'running' && state.phase !== 'disabled',
  getState,
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  types: DEPARTURE_TYPES,
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

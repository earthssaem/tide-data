// 앱 시작점: 사례 불러오기, 저장 상태 복구, 화면 전환, 공통 머리말
import { loadRegistry, loadCase } from './data/loader.js';
import { Store } from './state/store.js';
import {
  emptyState, loadLocal, clearLocal, makeBackupText, backupFilename, parseBackup, sanitizeState,
} from './state/persistence.js';
import { snapshotEvidence } from './state/evidence.js';
import { STEPS, INQUIRIES, CONCLUSION } from './content/questions.js';
import { $, h, confirmDialog, alertDialog, downloadBlob, pickFile, toast } from './util/dom.js';
import { escapeHtml } from './util/format.js';
import { fmtRange, fmtTime, fmtDateTime } from './util/time.js';

import * as StartScreen from './screens/start.js';
import * as Inq1Screen from './screens/inquiry1.js';
import * as Inq2Screen from './screens/inquiry2.js';
import * as Inq3Screen from './screens/inquiry3.js';
import * as ConclusionScreen from './screens/conclusion.js';
import * as ReportScreen from './screens/report.js';

const SCREENS = {
  start: StartScreen, inq1: Inq1Screen, inq2: Inq2Screen, inq3: Inq3Screen, conclusion: ConclusionScreen, report: ReportScreen,
};

const app = {
  registry: null,
  cd: null,
  store: null,
  current: null,
  currentStep: null,
  savedOther: null,
};
window.__tideApp = app; // 검증 스크립트용(외부 전송 없음)

function urlCaseId() {
  try { return new URLSearchParams(location.search).get('case'); } catch { return null; }
}

async function boot() {
  try {
    app.registry = await loadRegistry();
    const saved = loadLocal();
    const known = app.registry.cases;
    const forced = urlCaseId();
    let caseId = forced && known.some((c) => c.id === forced) ? forced : null;
    if (!caseId && saved.state && known.some((c) => c.id === saved.state.caseId)) caseId = saved.state.caseId;
    if (!caseId) caseId = app.registry.defaultCase || known.find((c) => c.enabled !== false)?.id;
    const entry = known.find((c) => c.id === caseId);
    app.cd = await loadCase(entry);
    let state;
    if (saved.state && saved.state.caseId === caseId) state = saved.state;
    else {
      state = emptyState(caseId, app.cd.dataVersion);
      if (saved.state) app.savedOther = saved.state;
    }
    if (saved.error) app.loadError = saved.error;
    app.store = new Store(state);
    if (saved.state && saved.state.caseId === caseId) app.store.setStatus({ kind: 'saved', time: saved.state.updatedAt, message: '저장됨' });
    setupShell();
    const hashStep = location.hash.replace(/^#\/?/, '');
    const step = state.started ? (SCREENS[hashStep] ? hashStep : state.step) : 'start';
    navigate(step, { replace: true });
  } catch (e) {
    console.error(e);
    $('#screen').innerHTML = `<div class="fatal card"><h1>자료를 불러오지 못했습니다</h1><p>${escapeHtml(e.message)}</p>
      <p class="muted">이 앱은 웹 서버를 통해 열어야 합니다(파일을 직접 더블클릭하면 자료를 읽을 수 없습니다). 선생님께 알려 주세요.</p>
      <button class="btn btn-primary" onclick="location.reload()">다시 시도</button></div>`;
  }
}

// ───────────── 공통 머리말 ─────────────
function setupShell() {
  const { cd, store } = app;
  const banner = $('#sample-banner');
  if (cd.isSample) {
    banner.hidden = false;
    banner.innerHTML = `<strong>기능 확인용 예시 데이터</strong> <span>${escapeHtml(cd.sampleNotice)}</span>`;
  }
  $('#brand-home').addEventListener('click', () => navigate('start'));
  store.onStatus(renderSaveStatus);
  store.subscribe(() => renderStepper());
  $('#tools-menu').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-action]');
    if (!b) return;
    $('#tools-menu').open = false;
    if (b.dataset.action === 'backup') downloadBackup();
    if (b.dataset.action === 'import') importBackup();
    if (b.dataset.action === 'clear') clearMyWork();
  });
  document.addEventListener('click', (e) => {
    const m = $('#tools-menu');
    if (m.open && !m.contains(e.target)) m.open = false;
  });
  window.addEventListener('hashchange', () => {
    const step = location.hash.replace(/^#\/?/, '');
    if (SCREENS[step] && step !== app.currentStep) navigate(step, { fromHash: true });
  });
  window.addEventListener('beforeunload', () => { app.store.flush(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) app.store.flush(); });
}

function renderSaveStatus(s) {
  const el = $('#save-status');
  const err = $('#save-error');
  const started = app.store?.state.started;
  if (!started) { el.innerHTML = '<span class="ss ss-idle">작성 전</span>'; err.hidden = true; return; }
  if (s.kind === 'saved') {
    el.innerHTML = `<span class="ss ss-ok" title="현재 컴퓨터와 브라우저에 저장됨">✓ 저장됨 <time>${fmtTime(s.time, { offsetMinutes: -new Date().getTimezoneOffset() })}</time></span>`;
    err.hidden = true;
  } else if (s.kind === 'error') {
    el.innerHTML = '<span class="ss ss-err">⚠ 저장 실패</span>';
    err.hidden = false;
    err.innerHTML = `<strong>임시 저장에 실패했습니다.</strong> ${escapeHtml(s.message)} 작성한 내용은 화면에 남아 있습니다. 창을 닫기 전에 <button type="button" class="btn btn-sm btn-secondary" id="err-backup">백업 파일 받기</button>로 보관하세요. <button type="button" class="btn btn-sm btn-ghost" id="err-retry">다시 저장</button>`;
    $('#err-backup').onclick = downloadBackup;
    $('#err-retry').onclick = () => { app.store.dirty = true; app.store.flush(); };
  } else {
    el.innerHTML = `<span class="ss ss-pending">${escapeHtml(s.message || '저장 중…')}</span>`;
  }
}

export function stepStatus(step) {
  const s = app.store.state;
  const inq = INQUIRIES.find((q) => q.step === step);
  const qs = inq ? inq.questions : step === 'conclusion' ? CONCLUSION.questions : null;
  if (!qs) return null;
  const written = qs.filter((q) => (s.answers[q.id] || '').trim()).length;
  const ev = inq ? s.evidences.filter((e) => e.inquiry === inq.no).length : null;
  return { written, total: qs.length, ev };
}

function renderStepper() {
  const s = app.store.state;
  const nav = $('#stepper');
  nav.innerHTML = '';
  const ol = h('ol', { class: 'steps' });
  STEPS.forEach((st, i) => {
    const status = stepStatus(st.id);
    const disabled = !s.started && st.id !== 'start';
    const cur = app.currentStep === st.id;
    const meta = status ? `${status.written}/${status.total}${status.ev != null ? ` · 근거 ${status.ev}` : ''}` : '';
    const btn = h('button', {
      type: 'button', class: `step${cur ? ' current' : ''}${status && status.written === status.total ? ' filled' : ''}`,
      'aria-current': cur ? 'step' : null, disabled,
      title: status ? `작성 ${status.written}/${status.total}문항${status.ev != null ? `, 근거 ${status.ev}개` : ''}` : st.label,
      onclick: () => navigate(st.id),
    }, h('span', { class: 'step-no' }, String(i)), h('span', { class: 'step-label' }, st.short), meta ? h('span', { class: 'step-meta' }, meta) : null);
    ol.append(h('li', {}, btn));
  });
  nav.append(ol);
}

function renderContextBar() {
  const bar = $('#context-bar');
  const { cd, store } = app;
  const s = store.state;
  if (app.currentStep === 'start' || !s.started) { bar.hidden = true; return; }
  bar.hidden = false;
  const st = s.student;
  const r = app.currentStep === 'inq1' ? cd.ranges.inq1 : app.currentStep === 'inq3' ? cd.ranges.inq3 : cd.ranges.inq2;
  bar.innerHTML = `
    <span><b>관측소</b> ${escapeHtml(cd.station.name)}</span>
    <span><b>${app.currentStep === 'inq1' || app.currentStep === 'inq3' ? '지정 구간' : '분석 기간'}</b> ${escapeHtml(fmtRange(r[0], r[1], cd.tz))}</span>
    ${cd.typhoon ? `<span><b>태풍 사례</b> ${escapeHtml(cd.typhoon.name)} (${escapeHtml(String(cd.typhoon.year))})</span>` : ''}
    <span class="ctx-student"><b>작성자</b> ${escapeHtml(`${st.grade}학년 ${st.klass}반 ${st.number}번 ${st.name}`)}</span>`;
}

function renderBottomNav() {
  const nav = $('#bottom-nav');
  const idx = STEPS.findIndex((x) => x.id === app.currentStep);
  if (app.currentStep === 'start' || idx < 0) { nav.hidden = true; return; }
  nav.hidden = false;
  nav.innerHTML = '';
  const prev = STEPS[idx - 1];
  const next = STEPS[idx + 1];
  nav.append(
    prev ? h('button', { type: 'button', class: 'btn btn-secondary nav-prev', onclick: () => navigate(prev.id) }, `← 이전: ${prev.label}`) : h('span'),
    next ? h('button', { type: 'button', class: 'btn btn-primary nav-next', onclick: () => navigate(next.id) }, `다음: ${next.label} →`) : h('span'),
  );
}

export function navigate(step, { replace = false, fromHash = false } = {}) {
  if (!SCREENS[step]) step = 'start';
  if (!app.store.state.started && step !== 'start') step = 'start';
  app.store.flush();
  if (app.current?.destroy) app.current.destroy();
  app.currentStep = step;
  if (app.store.state.started) app.store.update((s) => { s.step = step; }, { topic: 'step', immediate: true });
  const screen = $('#screen');
  screen.innerHTML = '';
  screen.className = `screen screen-${step}`;
  app.current = SCREENS[step].render(app, screen) || null;
  if (!fromHash) {
    const hash = `#/${step}`;
    if (replace) history.replaceState(null, '', hash); else if (location.hash !== hash) history.pushState(null, '', hash);
  }
  renderStepper();
  renderContextBar();
  renderBottomNav();
  renderSaveStatus(app.store.status);
  window.scrollTo(0, 0);
  screen.focus({ preventScroll: true });
}

// ───────────── 근거 ─────────────
export function addEvidence(inquiry, analysisState) {
  const snap = snapshotEvidence(app.cd, inquiry, analysisState);
  let created;
  app.store.update((s) => {
    s.evSeq[inquiry] = (s.evSeq[inquiry] || 0) + 1;
    const seq = s.evSeq[inquiry];
    created = {
      id: `ev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      num: `${inquiry}-${seq}`, seq, createdAt: Date.now(), updatedAt: Date.now(), memo: '', ...snap,
    };
    s.evidences.push(created);
  }, { topic: 'evidence', immediate: true });
  toast(`근거 ${created.num}을(를) 추가했습니다. 이후 그래프를 움직여도 이 근거는 바뀌지 않습니다.`);
  return created;
}

export async function replaceEvidence(id, analysisState) {
  const ev = app.store.state.evidences.find((e) => e.id === id);
  if (!ev) return false;
  const ok = await confirmDialog({
    title: `근거 ${ev.num} 교체`,
    body: `근거 ${ev.num}의 그래프와 측정값을 현재 분석 상태로 바꿉니다.\n근거 번호, 메모, 답안과의 연결은 그대로 유지됩니다.`,
    okLabel: '현재 분석으로 교체',
  });
  if (!ok) return false;
  const snap = snapshotEvidence(app.cd, ev.inquiry, analysisState);
  app.store.update((s) => {
    const e = s.evidences.find((x) => x.id === id);
    Object.assign(e, snap, { updatedAt: Date.now() });
  }, { topic: 'evidence', immediate: true });
  toast(`근거 ${ev.num}을(를) 현재 분석으로 교체했습니다.`);
  return true;
}

export async function deleteEvidence(id) {
  const ev = app.store.state.evidences.find((e) => e.id === id);
  if (!ev) return false;
  const linked = Object.entries(app.store.state.links).filter(([, ids]) => ids.includes(id)).length;
  const ok = await confirmDialog({
    title: `근거 ${ev.num} 삭제`,
    body: `근거 ${ev.num}을(를) 삭제할까요?${linked ? `\n연결된 문항 ${linked}개에서도 연결이 해제됩니다.` : ''}\n삭제한 번호는 다시 사용하지 않습니다.`,
    okLabel: '삭제', danger: true,
  });
  if (!ok) return false;
  app.store.update((s) => {
    s.evidences = s.evidences.filter((e) => e.id !== id);
    for (const k of Object.keys(s.links)) s.links[k] = s.links[k].filter((x) => x !== id);
  }, { topic: 'evidence', immediate: true });
  return true;
}

// ───────────── 백업·삭제 ─────────────
export function downloadBackup() {
  const s = app.store.state;
  if (!s.started) { toast('아직 작성한 내용이 없습니다.'); return; }
  app.store.flush();
  const text = makeBackupText(s);
  downloadBlob(new Blob([text], { type: 'application/json' }), backupFilename(s));
  toast('백업 파일을 내려받았습니다. 백업 파일에는 이름과 답안이 들어 있으니 잘 보관하세요.');
}

export async function importBackup() {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  let text;
  try { text = await file.text(); } catch (e) { await alertDialog({ title: '불러오기 실패', body: `파일을 읽지 못했습니다: ${e.message}\n기존 작성 내용은 그대로 보존됩니다.` }); return; }
  const r = parseBackup(text, {
    knownCaseIds: app.registry.cases.map((c) => c.id),
    currentCaseId: app.cd.id,
    currentDataVersion: app.cd.dataVersion,
  });
  if (!r.ok) {
    await alertDialog({ title: '백업 파일을 불러올 수 없습니다', body: `${r.error}\n\n기존 작성 내용은 바뀌지 않았습니다.` });
    return;
  }
  const st = r.state.student;
  const cur = app.store.state;
  const body = `<p>파일: <b>${escapeHtml(file.name)}</b></p>
    <p>작성자: <b>${escapeHtml(`${st.grade}학년 ${st.klass}반 ${st.number}번 ${st.name}`)}</b>, 마지막 수정: ${escapeHtml(fmtDateTime(r.state.updatedAt, { offsetMinutes: -new Date().getTimezoneOffset() }))}</p>
    <p>답안 ${Object.values(r.state.answers).filter((x) => x.trim()).length}개, 근거 ${r.state.evidences.length}개</p>
    ${r.warnings.map((w) => `<p class="warn">⚠ ${escapeHtml(w)}</p>`).join('')}
    ${cur.started ? '<p class="warn">불러오면 지금 이 컴퓨터에 저장된 작성 내용이 백업 파일의 내용으로 바뀝니다.</p>' : ''}`;
  const ok = await confirmDialog({ title: '백업 파일 불러오기', body, html: true, okLabel: '불러오기' });
  if (!ok) return;
  const next = sanitizeState(JSON.parse(JSON.stringify(r.state)));
  next.started = true;
  if (next.caseId !== app.cd.id) {
    // 다른 사례: 저장 후 그 사례로 다시 열기
    app.store.replace(next);
    if (app.store.status.kind === 'error') { await alertDialog({ title: '저장 실패', body: '백업 내용을 이 브라우저에 저장하지 못했습니다.' }); return; }
    location.href = `${location.pathname}?case=${encodeURIComponent(next.caseId)}#/${next.step}`;
    return;
  }
  next.dataVersion = next.dataVersion || app.cd.dataVersion;
  app.store.replace(next);
  toast('백업 파일을 불러왔습니다.');
  navigate(next.step === 'start' ? 'inq1' : next.step);
}

export async function clearMyWork() {
  const ok = await confirmDialog({
    title: '이 컴퓨터의 내 작성 내용 삭제',
    body: '<p>이 컴퓨터의 브라우저에 저장된 <b>조석 데이터 탐구실의 작성 내용</b>(학생 정보, 답안, 근거)을 삭제합니다. 다른 사이트나 다른 앱의 자료는 지우지 않습니다.</p><p>삭제한 내용은 되돌릴 수 없습니다. 필요하면 먼저 백업 파일을 받아 두세요.</p>',
    html: true, okLabel: '삭제', danger: true,
  });
  if (!ok) return;
  const r = clearLocal();
  if (!r.ok) { await alertDialog({ title: '삭제 실패', body: r.error }); return; }
  app.savedOther = null;
  app.store = new Store(emptyState(app.cd.id, app.cd.dataVersion));
  app.store.onStatus(renderSaveStatus);
  app.store.subscribe(() => renderStepper());
  toast('이 컴퓨터에 저장된 작성 내용을 삭제했습니다.');
  navigate('start');
}

export function startNew(student) {
  const st = emptyState(app.cd.id, app.cd.dataVersion);
  st.student = student;
  st.started = true;
  app.store.replace(st);
  navigate('inq1');
}

Object.assign(app, { navigate, addEvidence, replaceEvidence, deleteEvidence, downloadBackup, importBackup, clearMyWork, startNew, stepStatus });

boot();

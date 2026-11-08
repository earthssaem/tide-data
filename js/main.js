// 앱 시작점: 평가 설정·사례 불러오기, 저장 상태 복구, 화면 전환, 공통 머리말
// 모드(주소창 ?mode=)
//   (없음)   학생용: data/assessment.json의 설정과 실제 관측 자료만 사용. 예시 데이터로 자동 전환하지 않는다.
//   preview  교사용 미리보기·기능 시험(교사 로그인 후): 교사 설정 적용. 작성 내용은 학생 답과 따로 저장.
//            ?case=sample-2099 처럼 사례를 고를 수 있다(가상 데이터는 여기서만).
//   teacher  교사용 평가 설정 화면
import { loadRegistry, loadCase } from './data/loader.js';
import { Store } from './state/store.js';
import {
  emptyState, loadLocal, clearLocal, makeBackupText, backupFilename, parseBackup, sanitizeState, setStorageMode, legacyList,
} from './state/persistence.js';
import { STEPS, INQUIRIES, CONCLUSION, REVEALS, CIRCLED, isEnabled } from './content/questions.js';
import { applySetup, loadDeployedSetup, loadTeacherSetup, parseSetup } from './setup/setup.js';
import { loadKoreaMap } from './chart/map.js';
import { checkSession, renderLogin, teacherFetch } from './teacher-auth.js';
import { $, h, confirmDialog, alertDialog, downloadBlob, pickFile, toast } from './util/dom.js';
import { escapeHtml } from './util/format.js';
import { fmtTime, fmtDateTime } from './util/time.js';
import { answerOf } from './screens/common.js';
import { answerLines } from './report/model.js';

import * as StartScreen from './screens/start.js';
import * as Inq1Screen from './screens/inquiry1.js';
import * as Inq2Screen from './screens/inquiry2.js';
import * as Inq3Screen from './screens/inquiry3.js';
import * as Inq4Screen from './screens/inquiry4.js';
import * as ConclusionScreen from './screens/conclusion.js';
import * as ReportScreen from './screens/report.js';

const SCREENS = { start: StartScreen, inq1: Inq1Screen, inq2: Inq2Screen, inq3: Inq3Screen, inq4: Inq4Screen, conclusion: ConclusionScreen, report: ReportScreen };

const app = {
  mode: 'student',
  registry: null,
  ad: null,
  store: null,
  current: null,
  currentStep: null,
  setupSource: '',
};
window.__tideApp = app; // 검증 스크립트용(외부 전송 없음)

function urlParam(k) {
  try { return new URLSearchParams(location.search).get(k); } catch { return null; }
}

async function readText(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path} 파일을 불러오지 못했습니다 (HTTP ${res.status}).`);
  return res.text();
}

function showFatal(e) {
  console.error(e);
  $('#screen').innerHTML = `<div class="fatal card" id="fatal"><h1>자료를 불러오지 못했습니다</h1><p>${escapeHtml(e.message)}</p>
    <p class="muted">이 앱은 웹 서버를 통해 열어야 합니다(파일을 직접 더블클릭하면 자료를 읽을 수 없습니다). 예시 자료로 바꾸지 않습니다. 다시 시도해도 같으면 선생님께 알려 주세요.</p>
    <button class="btn btn-primary" id="btn-retry" onclick="location.reload()">다시 시도</button></div>`;
}

async function boot() {
  const mode = urlParam('mode');
  app.mode = mode === 'teacher' ? 'teacher' : mode === 'preview' ? 'preview' : 'student';
  document.documentElement.dataset.mode = app.mode;
  if (app.mode === 'teacher') {
    try {
      const T = await import('./screens/teacher.js');
      await T.boot(app);
    } catch (e) { showFatal(e); }
    return;
  }
  setStorageMode(app.mode === 'preview' ? 'preview' : 'student');
  let teacherSession = null;
  if (app.mode === 'preview') {
    teacherSession = await checkSession();
    if (!teacherSession.authenticated) {
      $('#stepper').hidden = true;
      $('.top-tools').style.display = 'none';
      if (['not_configured', 'unavailable', 'https_required', 'store_error'].includes(teacherSession.code)) {
        showFatal(new Error(`교사용 미리보기를 열 수 없습니다. ${teacherSession.error || ''}`));
        return;
      }
      renderLogin($('#screen'), { title: '교사용 미리보기 로그인', purpose: '교사용 미리보기와 기능 시험', onSuccess: () => location.reload() });
      return;
    }
  }
  try {
    app.registry = await loadRegistry();
    let cfg = null;
    if (app.mode === 'preview') {
      if (teacherSession?.storage === 'server') {
        const r = await teacherFetch('/api/teacher/setup');
        if (r.status === 401) { location.reload(); return; }
        if (r.ok && r.setup) { try { cfg = parseSetup(r.setup); app.setupSource = '서버에 저장한 교사 설정'; } catch { cfg = null; } }
      }
      if (!cfg) { cfg = loadTeacherSetup(); if (cfg) app.setupSource = '이 브라우저에 저장한 교사 설정'; }
      if (!cfg) {
        try { cfg = await loadDeployedSetup(readText); app.setupSource = '학생용 배포 설정(data/assessment.json)'; } catch { cfg = null; }
      }
    } else {
      cfg = await loadDeployedSetup(readText);
    }
    const caseId = app.mode === 'preview' ? (urlParam('case') || cfg?.caseId || app.registry.defaultCase) : cfg.caseId;
    const entry = app.registry.cases.find((c) => c.id === caseId);
    if (!entry) throw new Error(`평가 설정의 사례(${caseId})를 사례 목록(index.json)에서 찾을 수 없습니다.`);
    const ad0 = await loadCase(entry);
    if (app.mode === 'student' && ad0.isSample) throw new Error('학생용 평가 설정에 기능 확인용 예시 데이터 사례가 지정되어 있습니다. 선생님께 알려 주세요(예시 데이터는 교사용 기능 시험에서만 씁니다).');
    const useCfg = cfg && cfg.caseId === caseId ? cfg : null;
    if (app.mode === 'preview' && !useCfg) app.setupSource = '설정 없음(사례 파일의 기본값)';
    app.ad = applySetup(ad0, useCfg);
    loadKoreaMap();

    const saved = loadLocal();
    let state;
    if (saved.state && saved.state.caseId === caseId) state = saved.state;
    else state = emptyState(caseId, app.ad.dataVersion);
    if (saved.error) app.loadError = saved.error;
    app.store = new Store(state);
    if (saved.state && saved.state.caseId === caseId) app.store.setStatus({ kind: 'saved', time: saved.state.updatedAt, message: '저장됨' });
    setupShell();
    const hashStep = location.hash.replace(/^#\/?/, '');
    const step = state.started ? (SCREENS[hashStep] ? hashStep : state.step) : 'start';
    navigate(step, { replace: true });
    if (saved.migrated) toast('이전 버전 앱의 작성 내용을 찾아 원본을 따로 보관했습니다. 시작 화면의 안내를 확인하세요.', 'warn');
  } catch (e) {
    showFatal(e);
  }
}

// ───────────── 공통 머리말 ─────────────
function setupShell() {
  const { ad, store } = app;
  const banner = $('#sample-banner');
  const notes = [];
  if (app.mode === 'preview') notes.push('<strong>교사용 미리보기</strong> <span>학생 답과 따로 저장됩니다.</span>');
  if (ad.isSample) notes.push(`<strong>기능 확인용 예시 데이터</strong> <span>${escapeHtml(ad.sampleNotice)}</span>`);
  if (notes.length) { banner.hidden = false; banner.innerHTML = notes.join(' · '); }
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
  document.addEventListener('tidelab:assessment-pause', () => { app.store.flush(); });
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

/** 단계별 작성 상태 */
export function stepStatus(step) {
  const def = INQUIRIES.find((q) => q.step === step) || (step === 'conclusion' ? CONCLUSION : null);
  if (!def) return null;
  const s = app.store.state;
  const qs = def.questions.filter((q) => isEnabled(q, app.ad.setup));
  const written = qs.filter((q) => (q.id === 'q4' ? ['spring', 'neap'].some((k) => (answerOf(s, q) || {})[k]) || answerLines(app.ad, s, q).length > 0 : answerLines(app.ad, s, q).length > 0)).length;
  return { written, total: qs.length };
}

function renderStepper() {
  const s = app.store.state;
  const nav = $('#stepper');
  nav.innerHTML = '';
  const ol = h('ol', { class: 'steps' });
  STEPS.forEach((st, i) => {
    const status = stepStatus(st.id);
    const cur = app.currentStep === st.id;
    const meta = status && status.total ? `${status.written}/${status.total}` : '';
    ol.append(h('li', {}, h('button', {
      type: 'button', class: `step${cur ? ' current' : ''}${status && status.total && status.written === status.total ? ' filled' : ''}`,
      'aria-current': cur ? 'step' : null, disabled: !s.started && st.id !== 'start', 'data-step': st.id,
      title: status ? `작성 ${status.written}/${status.total}문항` : st.label,
      onclick: () => navigate(st.id),
    }, h('span', { class: 'step-no' }, String(i)), h('span', { class: 'step-label' }, st.short), meta ? h('span', { class: 'step-meta' }, meta) : null)));
  });
  nav.append(ol);
}

function renderContextBar() {
  const bar = $('#context-bar');
  const s = app.store.state;
  if (app.currentStep === 'start' || !s.started) { bar.hidden = true; return; }
  bar.hidden = false;
  const st = s.student;
  bar.innerHTML = `<span><b>대표 관측소</b> ${escapeHtml(app.ad.stationList.find((s) => s.id === app.ad.rep)?.name || "")} <span class="muted">(${escapeHtml(app.ad.rep)})</span></span>
    <span><b>분석 연월</b> ${escapeHtml(app.ad.setup.month)}</span>
    <span class="ctx-student"><b>작성자</b> ${escapeHtml(`${st.grade}학년 ${st.klass}반 ${st.number}번 ${st.name}`)}</span>`;
}

/** 자료 공개(달의 위상 / 추가 자료). 공개 순간의 답을 따로 보관하고, 이후 해당 답은 고정한다 */
export async function reveal(kind) {
  const R = REVEALS[kind];
  const s = app.store.state;
  if (s.reveals[kind]) return true;
  const ids = R.lockIds.filter((id) => isEnabled({ id }, app.ad.setup));
  const all = [...INQUIRIES.flatMap((d) => d.questions)];
  const qs = ids.map((id) => all.find((q) => q.id === id));
  const empty = qs.filter((q) => (q.id === 'q4' ? !['spring', 'neap'].every((k) => s.answers.q4[k]) || !answerLines(app.ad, s, q).length : !answerLines(app.ad, s, q).length));
  const names = qs.map((q) => CIRCLED[q.no]).join('·');
  const body = `<p>[${escapeHtml(R.label)}]을 누르면 지금까지 작성한 ${escapeHtml(names)}의 답${kind === 'moon' ? '(고른 날짜, 달의 위치, 이유)' : ''}이 그대로 보관되고, 이후에는 고칠 수 없습니다.</p>
    ${empty.length ? `<p class="warn">⚠ 아직 작성하지 않은 문항: ${escapeHtml(empty.map((q) => CIRCLED[q.no]).join(', '))}. 비어 있는 채로 진행하면 보고서에 ‘작성하지 않음’으로 남습니다(앱이 답을 채우지 않습니다).</p>` : ''}`;
  const ok = await confirmDialog({ title: R.label, body, html: true, okLabel: empty.length ? '비어 있어도 진행' : R.label, cancelLabel: '돌아가서 작성' });
  if (!ok) return false;
  app.store.update((x) => {
    const answers = JSON.parse(JSON.stringify(Object.fromEntries(R.lockIds.map((id) => [id, x.answers[id]]))));
    x.reveals[kind] = { at: Date.now(), answers };
  }, { topic: 'reveal', immediate: true });
  toast(`[${R.label}] 완료. 확인 전 답은 따로 보관되었습니다.`);
  navigate(app.currentStep, { replace: true });
  return true;
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
    if (replace) history.replaceState(null, '', location.search + hash); else if (location.hash !== hash) history.pushState(null, '', location.search + hash);
  }
  renderStepper();
  renderContextBar();
  renderBottomNav();
  renderSaveStatus(app.store.status);
  window.scrollTo(0, 0);
  screen.focus({ preventScroll: true });
}

// ───────────── 백업·삭제 ─────────────
export function downloadBackup() {
  const s = app.store.state;
  if (!s.started) { toast('아직 작성한 내용이 없습니다.'); return; }
  app.store.flush();
  downloadBlob(new Blob([makeBackupText(s)], { type: 'application/json' }), backupFilename(s));
  toast('백업 파일을 내려받았습니다. 백업 파일에는 이름과 답이 들어 있으니 잘 보관하세요.');
}

/** 이전 버전 작성 내용(보관본)을 이전 형식 그대로 백업 파일로 */
export function downloadLegacy(key) {
  const L = legacyList().find((x) => !key || x.key === key);
  if (!L) { toast('보관된 이전 작성 내용이 없습니다.'); return; }
  const work = JSON.parse(L.raw);
  downloadBlob(new Blob([makeBackupText(work)], { type: 'application/json' }), backupFilename(work, { legacy: true }));
  toast('이전 버전 작성 내용을 백업 파일로 내려받았습니다(이전 형식 그대로).');
}

export async function importBackup() {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  let text;
  try { text = await file.text(); } catch (e) { await alertDialog({ title: '불러오기 실패', body: `파일을 읽지 못했습니다: ${e.message}\n기존 작성 내용은 그대로 보존됩니다.` }); return; }
  const r = parseBackup(text, { knownCaseIds: app.registry.cases.map((c) => c.id), currentCaseId: app.ad.id, currentDataVersion: app.ad.dataVersion });
  if (r.ok && r.state.caseId !== app.ad.id) { r.ok = false; r.error = `현재 평가 사례(${app.ad.id})와 다른 사례(${r.state.caseId})의 백업입니다. 이 화면에서는 불러올 수 없습니다.`; }
  if (!r.ok) {
    await alertDialog({ title: '백업 파일을 불러올 수 없습니다', body: `${r.error}\n\n기존 작성 내용은 바뀌지 않았습니다.` });
    return;
  }
  const st = r.state.student;
  const cur = app.store.state;
  const body = `<p>파일: <b>${escapeHtml(file.name)}</b></p>
    <p>작성자: <b>${escapeHtml(`${st.grade}학년 ${st.klass}반 ${st.number}번 ${st.name}`)}</b>, 마지막 수정: ${escapeHtml(fmtDateTime(r.state.updatedAt, { offsetMinutes: -new Date().getTimezoneOffset() }))}</p>
    ${r.warnings.map((w) => `<p class="warn">⚠ ${escapeHtml(w)}</p>`).join('')}
    ${cur.started ? '<p class="warn">불러오면 지금 이 컴퓨터에 저장된 작성 내용이 백업 파일의 내용으로 바뀝니다.</p>' : ''}`;
  const ok = await confirmDialog({ title: '백업 파일 불러오기', body, html: true, okLabel: '불러오기' });
  if (!ok) return;
  const next = sanitizeState(JSON.parse(JSON.stringify(r.state)));
  next.started = true;
  next.dataVersion = next.dataVersion || app.ad.dataVersion;
  app.store.replace(next);
  toast('백업 파일을 불러왔습니다.');
  navigate(next.step === 'start' ? 'inq1' : next.step);
}

export async function clearMyWork() {
  const ok = await confirmDialog({
    title: app.mode === 'preview' ? '미리보기 작성 내용 삭제' : '이 컴퓨터의 내 작성 내용 삭제',
    body: app.mode === 'preview'
      ? '<p>교사용 미리보기에서 작성한 내용만 삭제합니다. 학생 답과 교사 설정은 지우지 않습니다.</p>'
      : '<p>이 컴퓨터의 브라우저에 저장된 <b>조석 데이터 탐구실의 작성 내용</b>(학생 정보, 답, 보관된 이전 버전 내용)을 삭제합니다. 다른 사이트나 다른 앱의 자료는 지우지 않습니다.</p><p>삭제한 내용은 되돌릴 수 없습니다. 필요하면 먼저 백업 파일을 받아 두세요.</p>',
    html: true, okLabel: '삭제', danger: true,
  });
  if (!ok) return;
  const r = clearLocal();
  if (!r.ok) { await alertDialog({ title: '삭제 실패', body: r.error }); return; }
  app.store = new Store(emptyState(app.ad.id, app.ad.dataVersion));
  app.store.onStatus(renderSaveStatus);
  app.store.subscribe(() => renderStepper());
  toast('저장된 작성 내용을 삭제했습니다.');
  navigate('start');
}

export function startNew(student) {
  const st = emptyState(app.ad.id, app.ad.dataVersion);
  st.student = student;
  st.started = true;
  st.step = 'inq1';
  app.store.replace(st);
  navigate('inq1');
}

Object.assign(app, { navigate, reveal, downloadBackup, downloadLegacy, importBackup, clearMyWork, startNew, stepStatus });

boot();

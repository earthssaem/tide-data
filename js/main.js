// 앱 시작점: 평가 설정·사례 불러오기, 저장 상태 복구, 화면 전환, 공통 머리말
// 모드(주소창 ?mode=)
//   (없음)   학생용: data/assessment.json의 실제 관측소·기간만 사용. 예시 데이터로 자동 전환하지 않는다.
//   preview  교사용 미리보기·기능 시험: 이 브라우저의 교사 설정(또는 배포 설정)을 적용. 작성 내용은 학생 답안과 따로 저장.
//            ?case=sample-2099 처럼 사례를 고를 수 있다(가상 데이터는 여기서만).
//   teacher  교사용 평가 설정 화면
import { loadRegistry, loadCase, stationCaseData } from './data/loader.js';
import { Store } from './state/store.js';
import {
  emptyState, emptyWorkspace, WORKSPACE_KEYS, loadLocal, clearLocal, makeBackupText, backupFilename, parseBackup, sanitizeState, setStorageMode, legacyInfo,
} from './state/persistence.js';
import { snapshotEvidence } from './state/evidence.js';
import { STEPS, INQUIRIES, CONCLUSION, REVEALS, activeQuestions } from './content/questions.js';
import { applyAssessment, enabledStations, loadDeployedSetup, loadTeacherSetup, parseSetup } from './setup/setup.js';
import { loadKoreaMap } from './chart/map.js';
import { checkSession, renderLogin, teacherFetch } from './teacher-auth.js';
import { $, h, confirmDialog, alertDialog, downloadBlob, pickFile, toast } from './util/dom.js';
import { escapeHtml } from './util/format.js';
import { fmtRange, fmtTime, fmtDateTime } from './util/time.js';

import * as StartScreen from './screens/start.js';
import * as StationScreen from './screens/station.js';
import * as Inq1Screen from './screens/inquiry1.js';
import * as Inq2Screen from './screens/inquiry2.js';
import * as Inq3Screen from './screens/inquiry3.js';
import * as Inq4Screen from './screens/inquiry4.js';
import * as Inq5Screen from './screens/inquiry5.js';
import * as ConclusionScreen from './screens/conclusion.js';
import * as ReportScreen from './screens/report.js';

const SCREENS = {
  start: StartScreen, station: StationScreen, inq1: Inq1Screen, inq2: Inq2Screen, inq3: Inq3Screen, inq4: Inq4Screen, inq5: Inq5Screen,
  conclusion: ConclusionScreen, report: ReportScreen,
};
const NEEDS_STATION = new Set(['inq1', 'inq2', 'inq3', 'inq4', 'inq5', 'conclusion', 'report']);

const app = {
  mode: 'student',
  registry: null,
  cd: null,
  store: null,
  current: null,
  currentStep: null,
  savedOther: null,
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
  // 교사용 미리보기·기능 시험은 교사 로그인 후에만(서버에서 세션 확인). 학생용 화면은 로그인 없이 그대로.
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
    const known = app.registry.cases;
    // 평가 설정: 학생용은 배포 파일만, 미리보기는 서버(로그인으로 보호)·이 브라우저의 교사 설정 우선
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
    let caseId = app.mode === 'preview' ? (urlParam('case') || cfg?.caseId || app.registry.defaultCase) : cfg.caseId;
    const entry = known.find((c) => c.id === caseId);
    if (!entry) throw new Error(`평가 설정의 사례(${caseId})를 사례 목록(index.json)에서 찾을 수 없습니다.`);
    const cd0 = await loadCase(entry);
    if (app.mode === 'student' && cd0.isSample) throw new Error('학생용 평가 설정에 기능 확인용 예시 데이터 사례가 지정되어 있습니다. 선생님께 알려 주세요(예시 데이터는 교사용 기능 시험에서만 씁니다).');
    const useCfg = cfg && cfg.caseId === caseId ? cfg : null;
    if (app.mode === 'preview' && !useCfg) app.setupSource = '설정 없음(사례 파일의 기간, 모든 관측소)';
    const cdAll = applyAssessment(cd0, useCfg);
    const enabled = enabledStations(cdAll);
    if (!enabled.length) throw new Error('평가에 사용할 관측소가 설정되어 있지 않습니다. 선생님께 알려 주세요.');
    loadKoreaMap();

    const saved = loadLocal();
    let state;
    if (saved.state && saved.state.caseId === caseId) state = saved.state;
    else {
      state = emptyState(caseId, cdAll.dataVersion);
      if (saved.state) app.savedOther = saved.state;
    }
    if (saved.error) app.loadError = saved.error;
    // 학생이 고른 관측소 복원(지금 평가에 쓰는 관측소일 때만)
    const chosen = state.stationId && enabled.find((s) => s.id === state.stationId);
    app.cd = chosen ? chosen.cd : enabled[0].cd;
    app.store = new Store(state);
    if (saved.state && saved.state.caseId === caseId) app.store.setStatus({ kind: 'saved', time: saved.state.updatedAt, message: '저장됨' });
    setupShell();
    const hashStep = location.hash.replace(/^#\/?/, '');
    let step = state.started ? (SCREENS[hashStep] ? hashStep : state.step) : 'start';
    if (state.started && NEEDS_STATION.has(step) && !chosen) step = 'station';
    navigate(step, { replace: true });
    if (saved.migrated) toast('이전 버전 앱의 작성 내용을 찾아 원본을 따로 보관했습니다. 시작 화면의 안내를 확인하세요.', 'warn');
  } catch (e) {
    showFatal(e);
  }
}

// ───────────── 공통 머리말 ─────────────
function setupShell() {
  const { cd, store } = app;
  const banner = $('#sample-banner');
  const notes = [];
  if (app.mode === 'preview') notes.push('<strong>교사용 미리보기</strong> <span>학생 답안과 따로 저장됩니다.</span>');
  if (cd.isSample) notes.push(`<strong>기능 확인용 예시 데이터</strong> <span>${escapeHtml(cd.sampleNotice)}</span>`);
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
  // 전체화면 평가 모드 연결 지점: 평가가 일시 중지되면 입력 중이던 답안을 바로 저장한다(자동 저장과 같은 경로)
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

export function stepStatus(step) {
  const s = app.store.state;
  const inq = INQUIRIES.find((q) => q.step === step);
  const def = inq || (step === 'conclusion' ? CONCLUSION : null);
  if (!def) return null;
  const qs = inq ? activeQuestions(inq, app.cd.setup) : CONCLUSION.questions;
  const written = qs.filter((q) => (s.answers[q.id] || '').trim()).length;
  const ev = inq && inq.evidence ? s.evidences.filter((e) => e.inquiry === inq.no).length : null;
  const locked = inq?.gated && !s.reveals[inq.gated];
  return { written, total: qs.length, ev, locked };
}

function renderStepper() {
  const s = app.store.state;
  const nav = $('#stepper');
  nav.innerHTML = '';
  const ol = h('ol', { class: 'steps' });
  STEPS.forEach((st, i) => {
    const status = stepStatus(st.id);
    const disabled = (!s.started && st.id !== 'start') || (!s.stationId && NEEDS_STATION.has(st.id));
    const cur = app.currentStep === st.id;
    const meta = status ? (status.locked ? '잠김' : `${status.written}/${status.total}${status.ev != null ? ` · 근거 ${status.ev}` : ''}`) : '';
    const btn = h('button', {
      type: 'button', class: `step${cur ? ' current' : ''}${status && !status.locked && status.written === status.total ? ' filled' : ''}`,
      'aria-current': cur ? 'step' : null, disabled, 'data-step': st.id,
      title: status ? (status.locked ? `${st.label} — 탐구 4에서 [추가 자료 확인] 후 열림` : `작성 ${status.written}/${status.total}문항${status.ev != null ? `, 근거 ${status.ev}개` : ''}`) : st.label,
      onclick: () => navigate(st.id),
    }, h('span', { class: 'step-no' }, String(i)), h('span', { class: 'step-label' }, st.short), meta ? h('span', { class: `step-meta${status?.locked ? ' lock' : ''}` }, meta) : null);
    ol.append(h('li', {}, btn));
  });
  nav.append(ol);
}

function renderContextBar() {
  const bar = $('#context-bar');
  const { cd, store } = app;
  const s = store.state;
  if (['start', 'station'].includes(app.currentStep) || !s.started) { bar.hidden = true; return; }
  bar.hidden = false;
  const st = s.student;
  const k = app.currentStep;
  const [label, r] = k === 'inq1' ? ['기본 관찰 구간', cd.ranges.inq1] : ['inq3', 'inq4', 'inq5'].includes(k) ? ['집중 관찰 구간', cd.ranges.inq3] : ['분석 기간', cd.ranges.inq2];
  // 태풍 정보는 탐구 5에서 추가 자료를 공개한 뒤에만 보여 준다
  const showTy = cd.typhoon && s.reveals.weather && ['inq5', 'conclusion', 'report'].includes(k);
  bar.innerHTML = `
    <span><b>관측소</b> ${escapeHtml(cd.station.name)} <span class="muted">(${escapeHtml(cd.station.id || '')}${cd.stationEntry?.sea ? ` · ${escapeHtml(cd.stationEntry.sea)}` : ''})</span> <button type="button" class="btn btn-ghost btn-xs" id="ctx-station">관측소 바꾸기</button></span>
    <span><b>${label}</b> <span id="ctx-range">${escapeHtml(fmtRange(r[0], r[1], cd.tz))}</span></span>
    ${showTy ? `<span><b>태풍</b> ${escapeHtml(cd.typhoon.name)} (${escapeHtml(String(cd.typhoon.year))})</span>` : ''}
    <span class="ctx-student"><b>작성자</b> ${escapeHtml(`${st.grade}학년 ${st.klass}반 ${st.number}번 ${st.name}`)}</span>`;
  bar.querySelector('#ctx-station').onclick = () => navigate('station');
}

/**
 * 관측소 고르기·바꾸기. 답안·그림·분석·자료 공개 상태는 관측소마다 따로 보관하고(섞이지 않게),
 * 근거는 만든 관측소가 기록된 채로 모두 남긴다. 학생용 앱은 미리 만든 파일만 읽으므로 외부 API를 부르지 않는다.
 */
export function selectStation(id, { rerender = true } = {}) {
  const entry = enabledStations(app.cd).find((s) => s.id === id);
  if (!entry) return false;
  app.store.update((s) => {
    const prev = s.stationId;
    if (prev === id) return;
    if (prev) s.byStation[prev] = Object.fromEntries(WORKSPACE_KEYS.map((k) => [k, s[k]]));
    const w = s.byStation[id] || emptyWorkspace();
    for (const k of WORKSPACE_KEYS) s[k] = w[k];
    delete s.byStation[id];
    for (const k of ['inq1', 'inq2']) if (s.analysis[k]?.compare?.stationId === id) s.analysis[k].compare = null;
    s.stationId = id;
  }, { topic: 'station', immediate: true });
  const changed = app.cd !== entry.cd;
  app.cd = entry.cd;
  if (rerender) navigate(app.currentStep || 'station', { replace: true });
  if (changed) toast(`관측소: ${entry.name}. 관측소마다 답안과 분석은 따로 보관됩니다.`);
  return true;
}

/** 자료 공개(달의 위상 / 추가 자료). 공개 순간의 답을 따로 보관하고, 이후 해당 답은 고정한다 */
export async function reveal(kind) {
  const R = REVEALS[kind];
  const s = app.store.state;
  if (s.reveals[kind]) return true;
  const inq = INQUIRIES.find((x) => x.step === R.step);
  const qs = activeQuestions(inq, app.cd.setup).filter((q) => R.lockIds.includes(q.id));
  const empty = qs.filter((q) => !(s.answers[q.id] || '').trim()).map((q) => `문항 ${activeQuestions(inq, app.cd.setup).indexOf(q) + 1}`);
  const body = `<p>${escapeHtml(R.label)}를 확인하면 지금까지 쓴 ${escapeHtml(qs.map((q) => `문항 ${activeQuestions(inq, app.cd.setup).indexOf(q) + 1}`).join('·'))}의 답${kind === 'moon' ? '과 그림' : ''}이 <b>공개 전 답</b>으로 따로 보관되고, 이후에는 고칠 수 없습니다.</p>
    ${empty.length ? `<p class="warn">⚠ 아직 쓰지 않은 문항: ${escapeHtml(empty.join(', '))}. 비어 있는 채로 공개하면 보고서에 ‘작성하지 않음’으로 남습니다(앱이 답을 채우지 않습니다).</p>` : ''}
    <p>${kind === 'moon' ? '공개한 뒤 달라진 생각은 문항 5에 쓰세요.' : '공개한 뒤에는 탐구 5에서 설명을 보완합니다.'}</p>`;
  const ok = await confirmDialog({ title: `${R.label} 확인`, body, html: true, okLabel: empty.length ? '비어 있어도 확인하기' : `${R.label} 확인`, cancelLabel: '돌아가서 작성' });
  if (!ok) return false;
  app.store.update((x) => {
    const answers = Object.fromEntries(qs.map((q) => [q.id, x.answers[q.id] || '']));
    const drawing = kind === 'moon' ? (x.drawings.a2q4 ? JSON.parse(JSON.stringify(x.drawings.a2q4)) : null) : null;
    x.reveals[kind] = { at: Date.now(), answers, drawing };
  }, { topic: 'reveal', immediate: true });
  toast(`${R.label}를 공개했습니다. 공개 전 답은 따로 보관되었습니다.`);
  navigate(kind === 'weather' ? 'inq5' : app.currentStep, { replace: kind !== 'weather' });
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
  const nextDisabled = next && NEEDS_STATION.has(next.id) && !app.store.state.stationId;
  nav.append(
    prev ? h('button', { type: 'button', class: 'btn btn-secondary nav-prev', onclick: () => navigate(prev.id) }, `← 이전: ${prev.label}`) : h('span'),
    next ? h('button', { type: 'button', class: 'btn btn-primary nav-next', disabled: nextDisabled, onclick: () => navigate(next.id) }, `다음: ${next.label} →`) : h('span'),
  );
}

export function navigate(step, { replace = false, fromHash = false } = {}) {
  if (!SCREENS[step]) step = 'start';
  if (!app.store.state.started && step !== 'start') step = 'start';
  if (app.store.state.started && NEEDS_STATION.has(step) && !app.store.state.stationId) step = 'station';
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
  const s0 = app.store.state;
  const ev = s0.evidences.find((e) => e.id === id);
  if (!ev) return false;
  const linked = Object.entries(s0.links).filter(([, ids]) => ids.includes(id)).length;
  const ok = await confirmDialog({
    title: `근거 ${ev.num} 삭제`,
    body: `근거 ${ev.num}을(를) 삭제할까요?${linked ? `\n연결된 문항 ${linked}개에서도 연결이 해제됩니다.` : ''}\n삭제한 번호는 다시 사용하지 않습니다.`,
    okLabel: '삭제', danger: true,
  });
  if (!ok) return false;
  app.store.update((s) => {
    s.evidences = s.evidences.filter((e) => e.id !== id);
    const scrub = (links) => { for (const k of Object.keys(links)) links[k] = links[k].filter((x) => x !== id); };
    scrub(s.links);
    for (const w of Object.values(s.byStation)) scrub(w.links || {});
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

/** 이전 버전 작성 내용(보관본)을 이전 형식 그대로 백업 파일로 */
export function downloadLegacy() {
  const L = legacyInfo();
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
  const r = parseBackup(text, {
    knownCaseIds: app.registry.cases.map((c) => c.id),
    currentCaseId: app.cd.id,
    currentDataVersion: app.cd.dataVersion,
  });
  if (r.ok && r.state.caseId !== app.cd.id) { r.ok = false; r.error = `현재 평가 사례(${app.cd.id})와 다른 사례(${r.state.caseId})의 백업입니다. 이 화면에서는 불러올 수 없습니다.`; }
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
  next.dataVersion = next.dataVersion || app.cd.dataVersion;
  app.store.replace(next);
  const entry = next.stationId && enabledStations(app.cd).find((s) => s.id === next.stationId);
  if (entry) app.cd = entry.cd;
  toast('백업 파일을 불러왔습니다.');
  navigate(!entry ? 'station' : next.step === 'start' ? 'inq1' : next.step);
}

export async function clearMyWork() {
  const ok = await confirmDialog({
    title: app.mode === 'preview' ? '미리보기 작성 내용 삭제' : '이 컴퓨터의 내 작성 내용 삭제',
    body: app.mode === 'preview'
      ? '<p>교사용 미리보기에서 작성한 내용만 삭제합니다. 학생 답안과 교사 설정은 지우지 않습니다.</p>'
      : '<p>이 컴퓨터의 브라우저에 저장된 <b>조석 데이터 탐구실의 작성 내용</b>(학생 정보, 답안, 근거, 보관된 이전 버전 내용)을 삭제합니다. 다른 사이트나 다른 앱의 자료는 지우지 않습니다.</p><p>삭제한 내용은 되돌릴 수 없습니다. 필요하면 먼저 백업 파일을 받아 두세요.</p>',
    html: true, okLabel: '삭제', danger: true,
  });
  if (!ok) return;
  const r = clearLocal();
  if (!r.ok) { await alertDialog({ title: '삭제 실패', body: r.error }); return; }
  app.savedOther = null;
  app.store = new Store(emptyState(app.cd.id, app.cd.dataVersion));
  app.store.onStatus(renderSaveStatus);
  app.store.subscribe(() => renderStepper());
  toast('저장된 작성 내용을 삭제했습니다.');
  navigate('start');
}

export function startNew(student) {
  const st = emptyState(app.cd.id, app.cd.dataVersion);
  st.student = student;
  st.started = true;
  st.step = 'station';
  app.store.replace(st);
  navigate('station');
}

Object.assign(app, { navigate, selectStation, reveal, addEvidence, replaceEvidence, deleteEvidence, downloadBackup, downloadLegacy, importBackup, clearMyWork, startNew, stepStatus, stationCaseData });

boot();

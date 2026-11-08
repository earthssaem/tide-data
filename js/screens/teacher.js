// 교사용 평가 설정 화면 (?mode=teacher)
// - 문항 켜기·끄기, 기본 분석 연월, 탐구 1 구간(3일 + 문항 ②의 24시간), 탐구 2 지역 비교 기간, 탐구 3 비교 기간(A·B), 교사용 메모
// - 저장된 교사 설정이 학생용 배포 설정과 다르면 다른 항목을 보여 주고 [배포 설정 값으로 맞추기]를 제공
// - 교사 로그인(서버에서 비밀번호·세션 확인)을 통과해야 화면이 열린다. 교사용 메모가 든 설정은 서버 저장소가 있으면
//   로그인으로 보호된 API(/api/teacher/setup)에 저장하고, 없으면 이 브라우저에만 저장한다. 학생에게는 적용되지 않는다.
// - 학생에게 적용: [설정 저장·내보내기] → '학생용 배포 파일'(assessment.json, 메모 제외)을 받아 data/assessment.json을 바꾼다.
// - 대조·소조 정답 날짜를 지정하는 기능은 넣지 않는다. 없는 자료는 만들지 않고 검증 결과로 알린다.

import { loadRegistry, loadCase } from '../data/loader.js';
import {
  SETUP_FORMAT, SETUP_VERSION, parseSetup, defaultSetup, applySetup, validateSetup, studentDeployment, teacherExport,
  loadTeacherSetup, saveTeacherSetup, clearTeacherSetup, loadDeployedSetup, fmtLocal, parseLocal, monthRange,
} from '../setup/setup.js';
import { INQUIRIES, CONCLUSION, CIRCLED, ALL_QUESTIONS } from '../content/questions.js';
import { inq1MainSpec, inq1MonthSpec, inq1Series, inq2Specs, inq4TideSpecs, periodTyphoonText } from '../chart/assess.js';
import { layoutChart } from '../chart/layout.js';
import { layoutToSVG, screenMeasure } from '../chart/svg.js';
import { $, h, confirmDialog, alertDialog, choiceDialog, downloadBlob, pickFile, toast } from '../util/dom.js';
import { escapeHtml } from '../util/format.js';
import { fmtRange, fmtDateTime, HOUR, DAY } from '../util/time.js';
import { checkSession, renderLogin, teacherFetch, logout, expiryText, currentSession } from '../teacher-auth.js';

const LEVEL = { error: ['오류', 'badge-err'], warn: ['주의', 'badge-warn'], info: ['안내', 'badge-info'], ok: ['확인', 'badge-ok'] };

async function readText(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path} 파일을 불러오지 못했습니다 (HTTP ${res.status}).`);
  return res.text();
}

export async function boot(app) {
  // 학생용 머리말 요소 정리
  $('#stepper').hidden = true;
  $('.top-tools').style.display = 'none';
  $('#bottom-nav').hidden = true;
  $('#brand-home').querySelector('.brand-name').textContent = '조석 데이터 탐구실 · 교사용 평가 설정';
  $('#brand-home').addEventListener('click', () => { location.href = '?mode=teacher'; });
  document.title = '교사용 평가 설정 — 조석 데이터 탐구실';
  await start(app);
}

/** 로그인 확인 → 설정 화면. 로그인하지 않았으면 설정 화면을 만들지 않는다 */
async function start(app, message = '') {
  const screen = $('#screen');
  screen.className = 'screen screen-teacher';
  const s = await checkSession();
  if (!s.authenticated) {
    if (s.code === 'not_configured' || s.code === 'unavailable' || s.code === 'https_required' || s.code === 'store_error') {
      screen.innerHTML = '';
      screen.append(h('section', { class: 'card login-card', id: 't-login-blocked' },
        h('h1', {}, '교사용 화면을 열 수 없습니다'),
        h('p', { class: 'notice notice-warn' }, s.error || '교사 로그인을 확인하지 못했습니다.'),
        h('p', { class: 'small' }, '서버에 교사 로그인 환경변수(TEACHER_PASSWORD_HASH, TEACHER_SESSION_SECRET)가 있어야 합니다. 설정 방법은 README의 ‘교사 로그인’을 보세요. 학생 화면은 그대로 쓸 수 있습니다.'),
        h('p', { class: 'small' }, h('a', { href: './' }, '← 학생 화면으로'))));
      return;
    }
    renderLogin(screen, { message, onSuccess: () => start(app) });
    return;
  }
  const registry = await loadRegistry();
  let deployed = null;
  try { deployed = await loadDeployedSetup(readText); } catch (e) { deployed = null; app.deployError = e.message; }
  // 교사 설정: 서버 저장소(로그인으로 보호) → 이 브라우저 → 학생용 배포 설정 순서
  let storage = s.storage === 'server' ? 'server' : 'local';
  let serverCfg = null;
  if (storage === 'server') {
    const r = await teacherFetch('/api/teacher/setup', { onExpired: () => start(app, '로그인 시간이 끝났습니다. 다시 로그인하세요.') });
    if (r.status === 401) return;
    if (r.ok && r.setup) { try { serverCfg = parseSetup(r.setup); } catch { serverCfg = null; } }
    if (!r.ok) storage = 'local';
  }
  const local = loadTeacherSetup();
  const cfg = serverCfg || local || (deployed ? JSON.parse(JSON.stringify(deployed)) : { format: SETUP_FORMAT, version: SETUP_VERSION, caseId: registry.defaultCase });
  const source = serverCfg ? '서버에 저장한 교사 설정(로그인으로 보호)' : local ? '이 브라우저에 저장한 교사 설정' : deployed ? '학생용 배포 설정(data/assessment.json)' : '새 설정';
  const T = { registry, deployed, cfg, source, storage, ad: null, savedAt: serverCfg || local ? Date.now() : null, saveTimer: null };
  app.teacher = T; // 검증용
  await loadCaseFor(T, cfg.caseId);
  render(app, T);
  // 세션이 끝나면 로그인 화면으로
  clearTimeout(app.teacherExpiry);
  const left = (currentSession()?.expiresAt || 0) - Date.now();
  if (left > 0) app.teacherExpiry = setTimeout(async () => { const c = await checkSession(); if (!c.authenticated) start(app, '로그인 시간이 끝났습니다. 다시 로그인하세요.'); }, Math.min(left + 1000, 2 ** 31 - 1));
  app.teacherRestart = (msg) => start(app, msg);
  app.teacherRender = () => render(app, T);
}

async function loadCaseFor(T, caseId) {
  const entry = T.registry.cases.find((c) => c.id === caseId && !c.sample) || T.registry.cases.find((c) => !c.sample);
  T.ad = await loadCase(entry);
  const fb = defaultSetup(T.ad);
  T.cfg = T.cfg && T.cfg.caseId === entry.id ? parseSetup({ ...fb, ...T.cfg, format: SETUP_FORMAT, version: SETUP_VERSION }, fb) : fb;
}

function persist(T) {
  const el = document.getElementById('t-saved');
  const stamp = () => fmtDateTime(Date.now(), { offsetMinutes: -new Date().getTimezoneOffset() });
  if (T.storage === 'server') {
    // 이 브라우저에는 메모를 뺀 사본만(공용 컴퓨터에 메모가 남지 않게), 서버에는 전체를 로그인·CSRF 확인 후 저장
    saveTeacherSetup({ ...T.cfg, memo: '' });
    if (el) el.textContent = '서버에 저장하는 중…';
    clearTimeout(T.saveTimer);
    T.saveTimer = setTimeout(async () => {
      const r = await teacherFetch('/api/teacher/setup', { method: 'PUT', body: { ...T.cfg, format: SETUP_FORMAT, version: SETUP_VERSION } });
      const e2 = document.getElementById('t-saved');
      if (r.ok) { T.savedAt = Date.now(); T.source = '서버에 저장한 교사 설정(로그인으로 보호)'; if (e2) e2.textContent = `서버에 저장됨 ${stamp()} (학생에게는 아직 적용되지 않음)`; return; }
      if (r.status === 401) { toast('로그인 시간이 끝나 서버에 저장하지 못했습니다. 다시 로그인하면 이어서 저장합니다.', 'warn'); window.__tideApp?.teacherRestart?.('로그인 시간이 끝났습니다. 다시 로그인하세요(바꾼 내용은 이 브라우저에 남아 있습니다).'); return; }
      if (e2) e2.textContent = `서버에 저장하지 못했습니다: ${r.error || r.status}`;
    }, 500);
    return;
  }
  const r = saveTeacherSetup(T.cfg);
  if (r.ok) { T.savedAt = r.time; T.source = '이 브라우저에 저장한 교사 설정'; }
  if (el) el.textContent = r.ok ? `이 브라우저에 자동 저장됨 ${stamp()} (서버 저장소 없음 · 학생에게는 아직 적용되지 않음)` : `저장 실패: ${r.error}`;
}

async function doLogout(app, T) {
  clearTimeout(T.saveTimer);
  await logout();
  // 서버에 보관 중이면 이 브라우저의 사본을 지운다(서버 저장소가 없으면 설정을 잃지 않게 남겨 둠)
  if (T.storage === 'server') clearTeacherSetup();
  clearTimeout(app.teacherExpiry);
  await start(app, '로그아웃했습니다.');
}

const ymd = (t, tz) => fmtLocal(t, tz).slice(0, 10);
const addDaysStr = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

function render(app, T) {
  const screen = $('#screen');
  screen.className = 'screen screen-teacher';
  screen.innerHTML = '';
  const realCases = T.registry.cases.filter((c) => !c.sample);
  const sampleCases = T.registry.cases.filter((c) => c.sample);
  screen.append(h('div', { class: 'inq-head' },
    h('h1', {}, '교사용 평가 설정'),
    h('p', { class: 'inq-intro' }, '문항 사용 여부, 분석할 달, 탐구별 구간·기간을 정합니다. 확보한 실제 자료의 범위 안에서만 고를 수 있고, 없는 자료는 만들지 않습니다. 대조·소조·조석 형태의 정답을 학생에게 지정하는 기능은 없습니다.')));
  const steps = h('section', { class: 'card t-howto', id: 't-howto' });
  steps.innerHTML = `<h2>설정 저장과 학생 적용은 다릅니다</h2>
    <ol>
      <li><b>${T.storage === 'server' ? '서버에 저장(교사 로그인으로 보호)' : '이 브라우저에 저장'}</b> — 아래에서 바꾼 내용은 자동 저장되며 [학생용 미리보기]에만 적용됩니다. 학생 화면은 바뀌지 않습니다.</li>
      <li><b>학생에게 적용(배포)</b> — [설정 저장·내보내기]에서 <b>학생용 배포 파일</b>(<code>assessment.json</code>, 교사용 메모 제외)을 받아 저장소의 <code>data/assessment.json</code>을 바꾸고 배포(main 반영)합니다.</li>
      <li><b>보관·다른 컴퓨터</b> — <b>교사 보관용 파일</b>(메모 포함)을 받아 두고, 다른 컴퓨터에서 [설정 파일 불러오기]로 이어서 고칠 수 있습니다.</li>
    </ol>`;
  screen.append(steps);

  const bar = h('div', { class: 'card t-bar' });
  const caseSel = h('select', { id: 't-case', 'aria-label': '평가 사례' });
  caseSel.innerHTML = realCases.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label || c.id)}</option>`).join('');
  caseSel.value = T.ad.id;
  caseSel.addEventListener('change', async () => {
    if (!(await confirmDialog({ title: '평가 사례 바꾸기', body: '평가 사례를 바꾸면 설정이 새 사례의 기본값으로 바뀝니다. 지금 설정을 보관하려면 먼저 교사 보관용 파일을 내보내세요.', okLabel: '사례 바꾸기' }))) { caseSel.value = T.ad.id; return; }
    T.cfg = null;
    await loadCaseFor(T, caseSel.value);
    persist(T);
    render(app, T);
  });
  bar.append(...[
    h('div', { class: 't-bar-row t-auth-row' },
      h('span', { class: 'badge badge-ok', id: 't-auth' }, `교사 로그인됨 · ${expiryText(currentSession()?.expiresAt)}`),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: 't-logout', onclick: () => doLogout(app, T) }, '로그아웃')),
    h('div', { class: 't-bar-row' }, h('label', { for: 't-case' }, h('b', {}, '평가 사례 ')), caseSel, h('span', { class: 'muted small' }, `설정 출처: ${T.source}`)),
    h('div', { class: 't-bar-row' },
      h('a', { class: 'btn btn-primary', id: 't-preview', href: '?mode=preview', target: '_blank', rel: 'noopener', onclick: () => persist(T) }, '학생용 미리보기'),
      h('button', { type: 'button', class: 'btn btn-secondary', id: 't-export', onclick: () => exportDialog(T) }, '설정 저장·내보내기'),
      h('button', { type: 'button', class: 'btn btn-secondary', id: 't-import', onclick: () => importSetup(app, T) }, '설정 파일 불러오기'),
      h('button', { type: 'button', class: 'btn btn-ghost', id: 't-revert', onclick: () => revert(app, T) }, '학생용 배포 설정으로 되돌리기')),
    h('p', { class: 'muted small', id: 't-saved' }, T.savedAt ? '저장된 교사 설정을 불러왔습니다(학생에게는 적용되지 않음).' : '아직 저장한 교사 설정이 없습니다. 바꾸는 즉시 자동 저장됩니다.'),
    T.deployed?.reviewNote ? h('p', { class: 'notice notice-accent small' }, `배포 설정 메모: ${T.deployed.reviewNote}`) : null,
    app.deployError ? h('p', { class: 'notice notice-warn small' }, app.deployError) : null,
    sampleCases.length ? h('p', { class: 'small' }, '기능 시험(가상 데이터, 학생에게 제공하지 않음): ', ...sampleCases.map((c, i) => [i ? ' · ' : '', h('a', { href: `?mode=preview&case=${encodeURIComponent(c.id)}`, target: '_blank', rel: 'noopener' }, c.label || c.id)])) : null,
  ].filter(Boolean));
  screen.append(bar);
  const diff = deployDiff(T);
  if (diff) screen.append(diff);
  screen.append(editor(app, T));
}

/** 저장된 교사 설정과 학생용 배포 설정의 차이(메모·검토 표시 제외) */
function deployDiff(T) {
  const d = T.deployed;
  if (!d || d.caseId !== T.ad.id || /배포 설정/.test(T.source)) return null;
  const tz = T.ad.tz;
  const c = T.cfg;
  const rng = (r) => { const a = parseLocal(r?.start, tz), b = parseLocal(r?.end, tz); return Number.isFinite(a) && Number.isFinite(b) ? fmtRange(a, b, tz, { withTz: false }) : '—'; };
  const rows = [];
  if (c.month !== d.month) rows.push(['분석 연월', c.month, d.month]);
  if (c.inq1.start !== d.inq1.start || c.inq1.end !== d.inq1.end) rows.push(['탐구 1 구간', rng(c.inq1), rng(d.inq1)]);
  if (c.inq1.countStart !== d.inq1.countStart) rows.push(['문항 ② 24시간 시작', c.inq1.countStart, d.inq1.countStart]);
  if (c.inq2.start !== d.inq2.start || c.inq2.end !== d.inq2.end) rows.push(['탐구 2 기간', rng(c.inq2), rng(d.inq2)]);
  for (const k of ['a', 'b']) if (c.inq4[k].start !== d.inq4[k].start || c.inq4[k].end !== d.inq4[k].end) rows.push([`탐구 3 기간 ${k.toUpperCase()}`, rng(c.inq4[k]), rng(d.inq4[k])]);
  const offC = ALL_QUESTIONS.filter((q) => c.questions[q.id] === false).map((q) => CIRCLED[q.no]).join(' ') || '없음';
  const offD = ALL_QUESTIONS.filter((q) => d.questions[q.id] === false).map((q) => CIRCLED[q.no]).join(' ') || '없음';
  if (offC !== offD) rows.push(['끈 문항', offC, offD]);
  if (!rows.length) return null;
  const box = h('section', { class: 'card notice notice-warn t-diff', id: 't-diff' });
  const tbl = h('table', { class: 'data-table compact' }, h('thead', {}, h('tr', {}, h('th', {}, '항목'), h('th', {}, '저장된 교사 설정(미리보기에 적용 중)'), h('th', {}, '학생용 배포 설정'))),
    h('tbody', {}, ...rows.map(([a, b, c2]) => h('tr', {}, h('th', {}, a), h('td', {}, b), h('td', {}, c2)))));
  box.append(h('h2', { class: 'h-sm' }, '저장된 교사 설정이 학생용 배포 설정과 다릅니다'),
    h('p', { class: 'small' }, '앱이 바뀌면서 배포 기본값이 달라졌거나, 교사 화면에서 바꾼 항목입니다. 학생 화면에는 배포 설정이 적용되고, 미리보기에는 저장된 교사 설정이 적용됩니다.'),
    tbl,
    h('button', { type: 'button', class: 'btn btn-secondary btn-sm', id: 't-diff-apply', onclick: () => {
      for (const k of ['month', 'questions', 'inq1', 'inq2', 'inq4']) T.cfg[k] = JSON.parse(JSON.stringify(d[k]));
      persist(T); toast('배포 설정 값으로 맞췄습니다(메모는 그대로).'); window.__tideApp?.teacherRender?.();
    } }, '배포 설정 값으로 맞추기(메모는 유지)'));
  return box;
}

function chartBox(id, height, build, title) {
  const host = h('div', { class: 't-chart', id });
  requestAnimationFrame(() => {
    const width = Math.max(300, Math.min(880, host.clientWidth || 760));
    const specs = [].concat(build({ width, height, measure: screenMeasure, fontSize: 12 }));
    host.innerHTML = specs.map((sp) => layoutToSVG(layoutChart(sp), { title })).join('');
  });
  return host;
}

function editor(app, T) {
  const ad = T.ad;
  const tz = ad.tz;
  const cfg = T.cfg;
  const A = applySetup(ad, cfg);
  const change = (fn) => { fn(); persist(T); render(app, T); };
  const card = h('section', { class: 'card t-editor', id: 't-editor' });
  const rv = h('input', { type: 'checkbox', id: 't-ed-reviewed' }); rv.checked = !!cfg.reviewed;
  rv.addEventListener('change', () => change(() => { cfg.reviewed = rv.checked; }));
  card.append(h('div', { class: 't-row' }, h('label', { class: 'wx-check', for: 't-ed-reviewed' }, rv, ' 검토 완료(그래프·결측을 확인함)'),
    !cfg.reviewed ? h('span', { class: 'badge badge-warn', id: 't-review-badge' }, '교사 검토 필요 — 임시 후보 설정') : null));

  const sel = (id, label, options, value, onChange) => {
    const s = h('select', { id, 'aria-label': label });
    s.innerHTML = options.map(([v, t]) => `<option value="${escapeHtml(v)}">${escapeHtml(t)}</option>`).join('');
    s.value = value;
    s.addEventListener('change', () => change(() => onChange(s.value)));
    return s;
  };
  const dayOptions = (t0, t1, lastStartOffset = 0) => { const out = []; for (let t = t0; t + lastStartOffset * DAY < t1 + 1; t += DAY) out.push([ymd(t, tz), fmtDateTime(t, tz).slice(0, 10)]); return out; };

  // 분석 연월
  const fs1 = h('fieldset', { class: 't-fieldset' }, h('legend', {}, '기본 분석 연월 (탐구 1의 3일·한 달 그래프)'));
  fs1.append(h('div', { class: 't-row' }, sel('t-month', '분석 연월', ad.months.map((m) => [m, m]), cfg.month, (v) => {
    cfg.month = v;
    const [m0] = monthRange(v, tz);
    const s0 = ymd(m0 + 9 * DAY, tz);
    cfg.inq1 = { start: `${s0} 00:00`, end: `${addDaysStr(s0, 3)} 00:00`, countStart: `${addDaysStr(s0, 1)} 00:00` };
    cfg.inq2 = { start: `${s0} 00:00`, end: `${addDaysStr(s0, 3)} 00:00` };
    toast('분석 연월을 바꾸어 탐구 1·2 구간을 그달 10일부터 3일로 다시 정했습니다. 그래프를 보고 조정하세요.');
  }), h('span', { class: 'muted small' }, '그달의 부산 예측 조위입니다. 점선은 달의 위상(교사용 참고 — 학생에게는 [달의 위상 확인] 전까지 숨김).')));
  fs1.append(chartBox('t-month-chart', 230, (ctx) => inq1MonthSpec(ctx, A, { q3: {} }, { showMoon: true, title: false }), '한 달 예측 조위'));
  card.append(fs1);

  // 탐구 1
  const [mm0, mm1] = monthRange(cfg.month, tz);
  const i1s = cfg.inq1.start.slice(0, 10);
  const i1len = Math.max(1, daysBetween(i1s, cfg.inq1.end.slice(0, 10)));
  const fs2 = h('fieldset', { class: 't-fieldset' }, h('legend', {}, '탐구 1 — 3일 구간과 문항 ②의 24시간'));
  const countOpts = [];
  for (let t = A.win.inq1[0]; t + DAY <= A.win.inq1[1]; t += HOUR) countOpts.push([fmtLocal(t, tz), fmtLocal(t, tz)]);
  fs2.append(h('div', { class: 't-row' },
    h('b', {}, '시작일 '), sel('t-inq1-start', '탐구 1 시작일', dayOptions(mm0, mm1 - 2 * DAY), i1s, (v) => { cfg.inq1.start = `${v} 00:00`; cfg.inq1.end = `${addDaysStr(v, i1len)} 00:00`; cfg.inq1.countStart = `${addDaysStr(v, 1)} 00:00`; }),
    h('b', {}, ' 길이 '), sel('t-inq1-len', '탐구 1 길이', [[2, '2일'], [3, '3일'], [4, '4일']].map(([a, b]) => [String(a), b]), String(i1len), (v) => { cfg.inq1.end = `${addDaysStr(i1s, Number(v))} 00:00`; if (parseLocal(cfg.inq1.countStart, tz) + DAY > parseLocal(cfg.inq1.end, tz)) cfg.inq1.countStart = cfg.inq1.start; }),
    h('b', {}, ' ②의 24시간 시작 '), sel('t-inq1-count', '문항 ② 24시간 시작', countOpts, fmtLocal(A.win.count[0], tz), (v) => { cfg.inq1.countStart = v; })));
  fs2.append(h('p', { class: 'muted small' }, '24시간의 시작·끝이 만조·간조와 겹치지 않게 고르면 학생이 횟수를 세기 쉽습니다.'));
  const s1 = inq1Series(A);
  fs2.append(h('p', { class: `small ${s1.intervalMs < 3600e3 ? 'muted' : 'notice notice-warn'}`, id: 't-inq1-interval' }, s1.intervalMs < 3600e3
    ? `이 구간은 ${Math.round(s1.intervalMs / 60000)}분 간격 예측 자료를 씁니다(만조·간조 시각을 10분 단위로 고를 수 있음).`
    : `이 구간에는 10분 간격 자료가 없어 1시간 간격으로 표시합니다(10분 자료가 있는 달: ${(A.st[A.rep].predicted10?.months || []).join(', ') || '없음'}). 실제 만조·간조는 정시 사이에 있을 수 있습니다.`));
  fs2.append(chartBox('t-inq1-chart', 240, (ctx) => inq1MainSpec(ctx, A, { q1: {} }, { title: false }), '탐구 1 미리보기'));
  card.append(fs2);

  // 탐구 2
  const d0 = ad.st[ad.rep].predicted.points[0].t, d1 = ad.st[ad.rep].predicted.points.at(-1).t;
  const i2s = cfg.inq2.start.slice(0, 10);
  const i2len = Math.max(1, daysBetween(i2s, cfg.inq2.end.slice(0, 10)));
  const fs3 = h('fieldset', { class: 't-fieldset' }, h('legend', {}, '탐구 2 — 지역 비교 기간(인천·부산·묵호 예측 조위)'));
  fs3.append(h('div', { class: 't-row' },
    h('b', {}, '시작일 '), sel('t-inq2-start', '탐구 2 시작일', dayOptions(mm0, mm1 - DAY), i2s, (v) => { cfg.inq2 = { start: `${v} 00:00`, end: `${addDaysStr(v, i2len)} 00:00` }; }),
    h('b', {}, ' 길이 '), sel('t-inq2-len', '탐구 2 길이', [1, 2, 3, 4, 5, 7].map((n) => [String(n), `${n}일`]), String(i2len), (v) => { cfg.inq2.end = `${addDaysStr(i2s, Number(v))} 00:00`; }),
    h('button', { type: 'button', class: 'btn btn-ghost btn-xs', id: 't-inq2-same', onclick: () => change(() => { cfg.inq2 = { start: cfg.inq1.start, end: cfg.inq1.end }; }) }, '탐구 1과 같은 기간')));
  fs3.append(chartBox('t-inq2-chart', 150, (ctx) => inq2Specs(ctx, A, 'same'), '탐구 2 미리보기'));
  card.append(fs3);

  // 탐구 3(특이한 변화)
  const fs4 = h('fieldset', { class: 't-fieldset' }, h('legend', {}, '탐구 3 — 비교 기간(부산 관측 조위)'));
  const opts4 = [...(ad.past ? dayOptions(ad.past.observed.points[0].t, ad.past.observed.points.at(-1).t - DAY) : []), ...dayOptions(ad.st[ad.rep].observed.points[0].t, ad.st[ad.rep].observed.points.at(-1).t - DAY)];
  for (const [k, label] of [['a', '기간 A'], ['b', '기간 B']]) {
    const s0 = cfg.inq4[k].start.slice(0, 10);
    const len = Math.max(1, daysBetween(s0, cfg.inq4[k].end.slice(0, 10)));
    fs4.append(h('div', { class: 't-row' }, h('b', {}, `${label} 시작일 `),
      sel(`t-inq4-${k}-start`, `${label} 시작일`, opts4, s0, (v) => { cfg.inq4[k] = { start: `${v} 00:00`, end: `${addDaysStr(v, len)} 00:00` }; }),
      h('b', {}, ' 길이 '), sel(`t-inq4-${k}-len`, `${label} 길이`, [3, 4, 5, 6, 7].map((n) => [String(n), `${n}일`]), String(len), (v) => { cfg.inq4[k].end = `${addDaysStr(s0, Number(v))} 00:00`; }),
      h('span', { class: 'muted small' }, ` ${fmtRange(A.win[k][0], A.win[k][1], tz)} · ${periodTyphoonText(A, k)}`)));
  }
  fs4.append(h('p', { class: 'muted small' }, `학생에게는 [추가 자료 확인] 전까지 날짜와 관측 조위만 보이고, 확인 뒤 기간 B 제목에 ‘확인한 기압·바람이 상대적으로 안정적인 기간’이 붙습니다. 기간 B는 기압·바람이 안정적인 기간으로 고르세요(시작일은 부산 2022년 9월 또는 2025-10~2026-09).`));
  fs4.append(chartBox('t-inq4-chart', 190, (ctx) => inq4TideSpecs(ctx, A, { revealed: false }), '탐구 3 미리보기'));
  card.append(fs4);
  if (cfg.questions.q7 !== undefined || cfg.questions.q8 !== undefined) { delete cfg.questions.q7; delete cfg.questions.q8; }
  if (!d0 || !d1) card.append(h('p', { class: 'notice notice-warn' }, '예측 조위 자료가 없습니다.'));

  // 문항
  const qBox = h('fieldset', { class: 't-fieldset t-questions' }, h('legend', {}, '사용할 문항'));
  for (const def of [...INQUIRIES, CONCLUSION]) {
    const grp = h('div', { class: 't-qgroup' }, h('p', { class: 't-qtitle' }, def.step !== 'conclusion' ? `탐구 ${def.no}. ${def.title}` : def.title));
    for (const q of def.questions) {
      const cb = h('input', { type: 'checkbox', id: `t-q-${q.id}` });
      cb.checked = cfg.questions[q.id] !== false;
      cb.addEventListener('change', () => change(() => { cfg.questions[q.id] = cb.checked; }));
      grp.append(h('label', { class: 'wx-check t-q', for: `t-q-${q.id}` }, cb, ` ${CIRCLED[q.no]} ${q.text}`));
    }
    qBox.append(grp);
  }
  qBox.append(h('p', { class: 'muted small' }, '끈 문항은 학생 화면과 보고서에서 빠집니다. 문항 번호(①~⑫)는 바뀌지 않습니다.'));
  card.append(qBox);

  const memo = h('textarea', { id: 't-memo', rows: 3, placeholder: '예: 기간 A의 9/6 새벽 급상승을 찾는지 확인. ③에서 9/12 전후를 고르면 인정' });
  memo.value = cfg.memo || '';
  memo.addEventListener('input', () => { cfg.memo = memo.value; persist(T); });
  card.append(h('label', { for: 't-memo' }, h('b', {}, '교사용 메모')), h('p', { class: 'muted small' }, '학생 화면, 학생 PDF, 학생용 배포 파일에는 들어가지 않습니다(교사 보관용 파일·서버 저장소에만 저장).'), memo);

  const v = validateSetup(ad, cfg);
  const vBox = h('section', { class: 't-valid', id: 't-valid' });
  vBox.append(h('h3', {}, '설정 검증'), h('ul', { class: 't-vlist' }, ...v.map((x) => h('li', { class: `t-v-${x.level}` }, h('span', { class: `badge ${LEVEL[x.level][1]}` }, LEVEL[x.level][0]), ' ', h('b', {}, x.area), ` ${x.text}`))));
  card.append(vBox);
  return card;
}

async function exportDialog(T) {
  persist(T);
  const errors = validateSetup(T.ad, T.cfg).filter((x) => x.level === 'error').map((x) => `${x.area}: ${x.text}`);
  const v = await choiceDialog({
    title: '설정 저장·내보내기',
    html: true,
    body: `<p>✓ 현재 설정은 <b>${T.storage === 'server' ? '서버' : '이 브라우저'}에 저장</b>되어 있습니다(미리보기에만 적용).</p>
      ${!T.cfg.reviewed ? '<p class="warn">⚠ 교사 검토 필요(임시 후보 설정)</p>' : ''}
      ${errors.length ? `<p class="warn">⚠ 검증 오류: ${escapeHtml(errors.slice(0, 4).join(' / '))}${errors.length > 4 ? ' …' : ''}</p>` : ''}
      <ul><li><b>교사 보관용 파일</b>: 메모까지 모두 들어 있습니다. 다른 컴퓨터에서 이어서 고칠 때 씁니다.</li>
      <li><b>학생용 배포 파일(assessment.json)</b>: 메모를 뺀 설정입니다. 저장소의 <code>data/assessment.json</code>을 이 파일로 바꾸고 배포하면 학생 화면에 적용됩니다.</li></ul>`,
    choices: [
      { label: '닫기', value: 'cancel', kind: 'btn-secondary' },
      { label: '교사 보관용 파일', value: 'teacher', kind: 'btn-secondary' },
      { label: '학생용 배포 파일(assessment.json)', value: 'student', kind: 'btn-primary' },
    ],
  });
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  if (v === 'teacher') downloadBlob(new Blob([JSON.stringify(teacherExport(T.cfg), null, 1)], { type: 'application/json' }), `조석탐구_평가설정_교사보관용_${stamp}.json`);
  if (v === 'student') downloadBlob(new Blob([JSON.stringify(studentDeployment(T.cfg), null, 1)], { type: 'application/json' }), 'assessment.json');
}

async function importSetup(app, T) {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  let cfg;
  try { cfg = parseSetup(JSON.parse(await file.text())); } catch (e) { await alertDialog({ title: '설정 파일을 불러올 수 없습니다', body: `${e.message}\n지금 설정은 바뀌지 않았습니다.` }); return; }
  if (!T.registry.cases.some((c) => c.id === cfg.caseId && !c.sample)) { await alertDialog({ title: '설정 파일을 불러올 수 없습니다', body: `이 앱에 없는 사례(${cfg.caseId})의 설정입니다.` }); return; }
  if (!(await confirmDialog({ title: '설정 파일 불러오기', body: `파일: ${file.name}\n사례: ${cfg.caseId}\n불러오면 이 브라우저의 교사 설정이 이 파일의 내용으로 바뀝니다(학생 화면은 바뀌지 않음).`, okLabel: '불러오기' }))) return;
  T.cfg = cfg;
  await loadCaseFor(T, cfg.caseId);
  persist(T);
  toast('설정 파일을 불러왔습니다.');
  render(app, T);
}

async function revert(app, T) {
  if (!T.deployed) { await alertDialog({ title: '되돌릴 수 없습니다', body: '학생용 배포 설정(data/assessment.json)을 읽지 못했습니다.' }); return; }
  if (!(await confirmDialog({ title: '학생용 배포 설정으로 되돌리기', body: '이 브라우저에 저장한 교사 설정을 지우고, 지금 학생에게 적용된 배포 설정을 다시 불러옵니다. 메모도 지워지니 필요하면 먼저 교사 보관용 파일을 내보내세요.', okLabel: '되돌리기', danger: true }))) return;
  clearTeacherSetup();
  T.cfg = JSON.parse(JSON.stringify(T.deployed));
  T.source = '학생용 배포 설정(data/assessment.json)';
  T.savedAt = null;
  await loadCaseFor(T, T.cfg.caseId);
  if (T.storage === 'server') persist(T);
  render(app, T);
  toast('학생용 배포 설정으로 되돌렸습니다.');
}

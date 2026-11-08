// 교사용 평가 설정 화면 (?mode=teacher)
// - 관측소별: 평가에 사용 여부, 분석할 연·월, 기본·집중 관찰 구간, 달의 위상·기상·태풍 연결, 사용할 문항, 교사용 메모
// - 한 달 그래프에서 끌어서 구간을 고른 뒤 [기본 관찰 구간으로 지정]/[집중 관찰 구간으로 지정]
// - 변경 내용은 이 브라우저(교사 설정)에만 자동 저장되어 [학생용 미리보기]에 적용된다. 학생에게는 적용되지 않는다.
// - 학생에게 적용: [설정 저장·내보내기] → '학생용 배포 파일'(assessment.json, 메모 제외)을 받아 data/assessment.json을 바꾼다.
// - 대조·소조 정답 날짜를 지정하는 기능은 넣지 않는다. 없는 자료는 만들지 않고 검증 결과로 알린다.

import { loadRegistry, loadCase } from '../data/loader.js';
import {
  SETUP_FORMAT, SETUP_VERSION, parseSetup, caseEntries, defaultStationSetup, sanitizeStationSetup, applySetup, availableMonths,
  validateStationSetup, studentDeployment, teacherExport, loadTeacherSetup, saveTeacherSetup, clearTeacherSetup, loadDeployedSetup, fmtLocal, parseLocal,
} from '../setup/setup.js';
import { INQUIRIES, activeQuestions } from '../content/questions.js';
import { inq2MonthSpec, COLORS } from '../chart/specs.js';
import { layoutChart } from '../chart/layout.js';
import { layoutToSVG, screenMeasure } from '../chart/svg.js';
import { $, h, confirmDialog, alertDialog, choiceDialog, downloadBlob, pickFile, toast } from '../util/dom.js';
import { escapeHtml } from '../util/format.js';
import { fmtRange, fmtDateTime, HOUR } from '../util/time.js';

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

  const registry = await loadRegistry();
  let deployed = null;
  try { deployed = await loadDeployedSetup(readText); } catch (e) { deployed = null; app.deployError = e.message; }
  const local = loadTeacherSetup();
  let cfg = local || (deployed ? JSON.parse(JSON.stringify(deployed)) : { format: SETUP_FORMAT, version: SETUP_VERSION, caseId: registry.defaultCase, title: '', reviewNote: '', stations: {} });
  let source = local ? '이 브라우저에 저장한 교사 설정' : deployed ? '학생용 배포 설정(data/assessment.json)' : '새 설정';
  const T = { registry, deployed, cfg, source, raw: null, entries: [], selected: null, sel: null, savedAt: local ? Date.now() : null };
  app.teacher = T; // 검증용
  await loadCaseFor(T, cfg.caseId);
  render(app, T);
}

async function loadCaseFor(T, caseId) {
  const entry = T.registry.cases.find((c) => c.id === caseId) || T.registry.cases.find((c) => !c.sample);
  T.cfg.caseId = entry.id;
  T.raw = await loadCase(entry);
  T.entries = caseEntries(T.raw);
  // 모든 관측소 설정을 채워 둔다(파일에 없는 관측소는 사례 파일의 기간을 임시 후보로, 평가에는 쓰지 않음)
  const st = {};
  for (const e of T.entries) st[e.id] = sanitizeStationSetup(T.cfg.stations?.[e.id], defaultStationSetup(e.cd, { enabled: false }));
  T.cfg.stations = st;
  T.selected = T.entries.find((e) => st[e.id].enabled)?.id || T.entries[0].id;
  T.sel = null;
}

function persist(T) {
  const r = saveTeacherSetup(T.cfg);
  if (r.ok) { T.savedAt = r.time; T.source = '이 브라우저에 저장한 교사 설정'; }
  const el = document.getElementById('t-saved');
  if (el) el.textContent = r.ok ? `이 브라우저에 자동 저장됨 ${fmtDateTime(r.time, { offsetMinutes: -new Date().getTimezoneOffset() })} (학생에게는 아직 적용되지 않음)` : `저장 실패: ${r.error}`;
}

function render(app, T) {
  const screen = $('#screen');
  screen.className = 'screen screen-teacher';
  screen.innerHTML = '';
  const realCases = T.registry.cases.filter((c) => !c.sample);
  const sampleCases = T.registry.cases.filter((c) => c.sample);

  screen.append(h('div', { class: 'inq-head' },
    h('h1', {}, '교사용 평가 설정'),
    h('p', { class: 'inq-intro' }, '관측소별로 평가에 사용할지, 분석할 달과 관찰 구간, 연결할 자료, 사용할 문항을 정합니다. 확보한 실제 자료의 범위 안에서만 고를 수 있고, 없는 자료는 만들지 않습니다.')));

  const steps = h('section', { class: 'card t-howto', id: 't-howto' });
  steps.innerHTML = `<h2>설정 저장과 학생 적용은 다릅니다</h2>
    <ol>
      <li><b>이 브라우저에 저장</b> — 아래에서 바꾼 내용은 이 컴퓨터의 이 브라우저에만 자동 저장됩니다. [학생용 미리보기]에만 적용되고, 학생 화면은 바뀌지 않습니다.</li>
      <li><b>학생에게 적용(배포)</b> — [설정 저장·내보내기]에서 <b>학생용 배포 파일</b>(<code>assessment.json</code>, 교사용 메모 제외)을 받아 저장소의 <code>data/assessment.json</code>을 바꾸고 배포(main 반영)합니다. 학생 화면을 새로 고치면 적용됩니다.</li>
      <li><b>보관·다른 컴퓨터</b> — <b>교사 보관용 파일</b>(메모 포함)을 받아 두고, 다른 컴퓨터에서 [설정 파일 불러오기]로 이어서 고칠 수 있습니다.</li>
    </ol>`;
  screen.append(steps);

  const bar = h('div', { class: 'card t-bar' });
  const caseSel = h('select', { id: 't-case', 'aria-label': '평가 사례' });
  caseSel.innerHTML = realCases.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label || c.id)}</option>`).join('');
  caseSel.value = T.cfg.caseId;
  caseSel.addEventListener('change', async () => {
    if (!(await confirmDialog({ title: '평가 사례 바꾸기', body: '평가 사례를 바꾸면 관측소 설정이 새 사례의 기본값으로 바뀝니다. 지금 설정을 보관하려면 먼저 교사 보관용 파일을 내보내세요.', okLabel: '사례 바꾸기' }))) { caseSel.value = T.cfg.caseId; return; }
    T.cfg = { format: SETUP_FORMAT, version: SETUP_VERSION, caseId: caseSel.value, title: '', reviewNote: '', stations: {} };
    await loadCaseFor(T, caseSel.value);
    persist(T);
    render(app, T);
  });
  const previewA = h('a', { class: 'btn btn-primary', id: 't-preview', href: '?mode=preview', target: '_blank', rel: 'noopener', onclick: () => persist(T) }, '학생용 미리보기');
  bar.append(...[
    h('div', { class: 't-bar-row' }, h('label', { for: 't-case' }, h('b', {}, '평가 사례 ')), caseSel,
      h('span', { class: 'muted small' }, `설정 출처: ${T.source}`)),
    h('div', { class: 't-bar-row' },
      previewA,
      h('button', { type: 'button', class: 'btn btn-secondary', id: 't-export', onclick: () => exportDialog(T) }, '설정 저장·내보내기'),
      h('button', { type: 'button', class: 'btn btn-secondary', id: 't-import', onclick: () => importSetup(app, T) }, '설정 파일 불러오기'),
      h('button', { type: 'button', class: 'btn btn-ghost', id: 't-revert', onclick: () => revert(app, T) }, '학생용 배포 설정으로 되돌리기')),
    h('p', { class: 'muted small', id: 't-saved' }, T.savedAt ? '이 브라우저에 저장된 교사 설정을 불러왔습니다(학생에게는 적용되지 않음).' : '아직 이 브라우저에 저장한 교사 설정이 없습니다. 바꾸는 즉시 자동 저장됩니다.'),
    T.deployed?.reviewNote ? h('p', { class: 'notice notice-accent small' }, `배포 설정 메모: ${T.deployed.reviewNote}`) : null,
    app.deployError ? h('p', { class: 'notice notice-warn small' }, app.deployError) : null,
    sampleCases.length ? h('p', { class: 'small' }, '기능 시험(가상 데이터, 학생에게 제공하지 않음): ', ...sampleCases.map((c, i) => [i ? ' · ' : '', h('a', { href: `?mode=preview&case=${encodeURIComponent(c.id)}`, target: '_blank', rel: 'noopener' }, c.label || c.id)])) : null,
  ].filter(Boolean));
  screen.append(bar);

  const lay = h('div', { class: 't-layout' });
  const listCard = h('section', { class: 'card t-list', 'aria-labelledby': 't-list-h' });
  listCard.append(h('h2', { id: 't-list-h' }, `관측소 (${T.entries.length}곳)`), h('p', { class: 'muted small' }, '교사용 화면에서는 확보한 모든 관측소를 검토할 수 있습니다. 학생 목록에는 ‘사용’을 켠 관측소만 나타납니다.'));
  const tbl = h('table', { class: 'data-table compact', id: 't-stations' });
  tbl.innerHTML = '<thead><tr><th scope="col">사용</th><th scope="col">관측소</th><th scope="col">해역</th><th scope="col">분석 월</th><th scope="col">상태</th></tr></thead>';
  const tb = h('tbody');
  for (const e of T.entries) {
    const st = T.cfg.stations[e.id];
    const v = validateStationSetup(e.cd, st);
    const nErr = v.filter((x) => x.level === 'error').length, nWarn = v.filter((x) => x.level === 'warn').length;
    const tr = h('tr', { class: e.id === T.selected ? 'focus' : '', 'data-id': e.id });
    const cb = h('input', { type: 'checkbox', 'aria-label': `${e.name} 평가에 사용`, class: 't-enable' });
    cb.checked = st.enabled;
    cb.addEventListener('change', () => { st.enabled = cb.checked; persist(T); render(app, T); });
    const td0 = h('td'); td0.append(cb);
    const nameBtn = h('button', { type: 'button', class: 'link-btn', onclick: () => { T.selected = e.id; T.sel = null; render(app, T); } }, `${e.name} `, h('span', { class: 'muted small' }, e.id));
    const td1 = h('td'); td1.append(nameBtn);
    tr.append(td0, td1, h('td', {}, e.sea || '—'), h('td', {}, st.month),
      h('td', {}, !st.reviewed ? h('span', { class: 'badge badge-warn' }, '교사 검토 필요') : h('span', { class: 'badge badge-ok' }, '검토 완료'),
        nErr ? h('span', { class: 'badge badge-err' }, `오류 ${nErr}`) : null, nWarn ? h('span', { class: 'badge badge-info' }, `주의 ${nWarn}`) : null));
    tb.append(tr);
  }
  tbl.append(tb);
  listCard.append(h('div', { class: 'table-host' }, tbl));
  lay.append(listCard, editor(app, T));
  screen.append(lay);
}

function editor(app, T) {
  const e = T.entries.find((x) => x.id === T.selected);
  const raw = e.cd;
  const st = T.cfg.stations[e.id];
  const tz = raw.tz;
  const card = h('section', { class: 'card t-editor', id: 't-editor', 'aria-labelledby': 't-ed-h' });
  card.append(h('h2', { id: 't-ed-h' }, `${e.name} (${e.id}${e.sea ? ` · ${e.sea}` : ''}) 설정`));
  const change = (fn, { rerender = true } = {}) => { fn(); persist(T); if (rerender) render(app, T); };

  const flags = h('div', { class: 't-row' });
  const en = h('input', { type: 'checkbox', id: 't-ed-enabled' }); en.checked = st.enabled;
  en.addEventListener('change', () => change(() => { st.enabled = en.checked; }));
  const rv = h('input', { type: 'checkbox', id: 't-ed-reviewed' }); rv.checked = st.reviewed;
  rv.addEventListener('change', () => change(() => { st.reviewed = rv.checked; }));
  flags.append(...[h('label', { class: 'wx-check', for: 't-ed-enabled' }, en, ' 평가에 사용(학생 목록에 표시)'),
    h('label', { class: 'wx-check', for: 't-ed-reviewed' }, rv, ' 검토 완료(그래프·결측을 확인함)'),
    !st.reviewed ? h('span', { class: 'badge badge-warn', id: 't-review-badge' }, '교사 검토 필요 — 임시 후보 설정') : null].filter(Boolean));
  card.append(flags);

  // 분석할 연·월
  const months = availableMonths(raw);
  const mSel = h('select', { id: 't-month', 'aria-label': '분석할 연·월' });
  mSel.innerHTML = (months.some((m) => m.key === st.month) ? '' : `<option value="${escapeHtml(st.month)}">${escapeHtml(st.month)} (자료 없음)</option>`) + months.map((m) => `<option value="${m.key}">${m.key} (관측 ${m.valid}/${m.expected})</option>`).join('');
  mSel.value = st.month;
  mSel.addEventListener('change', () => change(() => { st.month = mSel.value; }));
  card.append(h('div', { class: 't-row' }, h('label', { for: 't-month' }, h('b', {}, '분석할 연·월 ')), mSel,
    h('span', { class: 'muted small' }, '확보한 관측 자료가 있는 달만 고를 수 있습니다. 다른 연도·기간은 같은 구조의 사례 자료를 수집해 추가하면 여기에 나타납니다.')));

  // 한 달 그래프(끌어서 구간 고르기)
  const cdM = applySetup(raw, st);
  const [m0, m1] = cdM.ranges.inq2;
  const chartCard = h('div', { class: 't-chart' });
  const host = h('div', { class: 't-brush', id: 't-brush', role: 'application', 'aria-label': '한 달 관측 조위. 끌어서 구간을 고릅니다. 키보드로는 아래 시각 입력란을 쓰세요.' });
  const selText = h('p', { class: 'small', id: 't-sel' });
  chartCard.append(h('p', { class: 'small muted' }, '그래프를 끌어서 구간을 고른 뒤 아래 버튼을 누르세요(1시간 단위로 맞춥니다). 점선은 달의 위상 시각(교사용 참고 — 학생에게는 탐구 2에서 공개 전까지 숨김)입니다.'), host, selText);
  const btnRow = h('div', { class: 't-row' },
    h('button', { type: 'button', class: 'btn btn-primary btn-sm', id: 't-set-basic', onclick: () => setRange('basic') }, '기본 관찰 구간으로 지정'),
    h('button', { type: 'button', class: 'btn btn-accent btn-sm', id: 't-set-focus', onclick: () => setRange('focus') }, '집중 관찰 구간으로 지정'));
  chartCard.append(btnRow);
  card.append(chartCard);

  let layout = null;
  const draw = () => {
    const width = Math.max(320, Math.min(900, host.clientWidth || 760));
    const spec = inq2MonthSpec({ cd: { ...cdM, moon: raw.moon }, width, height: 250, measure: screenMeasure, fontSize: 12.5 }, { selectedDays: [], showMoon: !!raw.moon }, null);
    const band = (r, color, op) => { const a = parseLocal(r?.start, tz), b = parseLocal(r?.end, tz); return Number.isFinite(a) && Number.isFinite(b) ? { t0: a, t1: b, fill: color, opacity: op, stroke: color, strokeWidth: 1.2 } : null; };
    spec.bands = [band(st.basic, '#1f5fbf', 0.16), band(st.focus, '#d9480f', 0.16), T.sel ? { t0: T.sel[0], t1: T.sel[1], fill: '#5b6675', opacity: 0.22, stroke: '#1d2733', strokeWidth: 1.4, dash: [4, 3] } : null].filter(Boolean);
    spec.legend = [
      ...spec.legend.filter((L) => L.kind !== 'barHollow'),
      { kind: 'bar', label: '기본 관찰 구간', color: '#1f5fbf' },
      { kind: 'bar', label: '집중 관찰 구간', color: '#d9480f' },
      ...(T.sel ? [{ kind: 'barHollow', label: '끌어서 고른 구간', color: '#1d2733' }] : []),
    ];
    layout = layoutChart(spec);
    host.innerHTML = layoutToSVG(layout, { title: `${e.name} ${st.month} 한 달 관측 조위` });
    selText.textContent = T.sel ? `고른 구간: ${fmtRange(T.sel[0], T.sel[1], tz)} (${Math.round((T.sel[1] - T.sel[0]) / HOUR)}시간)` : '아직 고른 구간이 없습니다.';
  };
  requestAnimationFrame(draw);
  const tAt = (ev) => {
    const r = host.firstElementChild.getBoundingClientRect();
    const x = (ev.clientX - r.left) * (layout.width / r.width);
    const t = layout.xToT(Math.min(layout.plot.x + layout.plot.w, Math.max(layout.plot.x, x)));
    return Math.min(m1, Math.max(m0, Math.round(t / HOUR) * HOUR));
  };
  let drag = null;
  host.addEventListener('pointerdown', (ev) => { if (!layout || ev.button !== 0) return; host.setPointerCapture?.(ev.pointerId); drag = tAt(ev); T.sel = [drag, drag + HOUR]; draw(); });
  host.addEventListener('pointermove', (ev) => { if (drag == null) return; const t = tAt(ev); T.sel = t >= drag ? [drag, Math.max(drag + HOUR, t)] : [t, drag]; draw(); });
  const end = () => { drag = null; };
  host.addEventListener('pointerup', end);
  host.addEventListener('pointercancel', end);
  function setRange(kind) {
    if (!T.sel || T.sel[1] - T.sel[0] < HOUR) { toast('먼저 그래프를 끌어서 구간을 고르세요.'); return; }
    st[kind] = { start: fmtLocal(T.sel[0], tz), end: fmtLocal(T.sel[1], tz) };
    T.sel = null;
    persist(T);
    toast(`${kind === 'basic' ? '기본' : '집중'} 관찰 구간을 지정했습니다. 검증 결과를 확인하세요.`);
    render(app, T);
  }

  // 시각 직접 입력(키보드로도 지정)
  const rangeInputs = (kind, label) => {
    const a = h('input', { type: 'text', id: `t-${kind}-start`, value: st[kind]?.start || '', 'aria-label': `${label} 시작 (YYYY-MM-DD HH:mm)`, size: 16 });
    const b = h('input', { type: 'text', id: `t-${kind}-end`, value: st[kind]?.end || '', 'aria-label': `${label} 끝 (YYYY-MM-DD HH:mm)`, size: 16 });
    const ok = h('button', { type: 'button', class: 'btn btn-ghost btn-xs', id: `t-${kind}-apply`, onclick: () => change(() => { st[kind] = { start: a.value.trim(), end: b.value.trim() }; }) }, '적용');
    return h('div', { class: 't-row' }, h('b', {}, `${label} `), a, ' ~ ', b, ok, h('span', { class: 'muted small' }, `KST · ${(() => { const x = parseLocal(st[kind]?.start, tz), y = parseLocal(st[kind]?.end, tz); return Number.isFinite(x) && Number.isFinite(y) && y > x ? `${Math.round((y - x) / HOUR)}시간` : '형식 확인'; })()}`));
  };
  card.append(rangeInputs('basic', '기본 관찰 구간(탐구 1)'), rangeInputs('focus', '집중 관찰 구간(탐구 3~5)'));

  // 자료 연결
  const linkBox = h('fieldset', { class: 't-fieldset' }, h('legend', {}, '자료 연결'));
  const link = (key, label, availableRaw, note) => {
    const cb = h('input', { type: 'checkbox', id: `t-link-${key}`, disabled: !availableRaw });
    cb.checked = !!st.links[key] && availableRaw;
    cb.addEventListener('change', () => change(() => { st.links[key] = cb.checked; }));
    return h('label', { class: 'wx-check', for: `t-link-${key}` }, cb, ` ${label}`, h('span', { class: 'muted small' }, ` — ${availableRaw ? note : '이 관측소·사례에 자료 없음'}`));
  };
  linkBox.append(
    link('moon', '달의 위상 자료', !!raw.availability.moonPhases, '탐구 2에서 [달의 위상 자료 확인] 후 공개'),
    link('weather', '기상 자료(기압·바람)', !!raw.availability.weather, `탐구 5에서 공개 · ${raw.weather?.station?.name || ''}${raw.weatherDistanceKm != null && raw.weatherDistanceKm >= 0.1 ? ` (약 ${raw.weatherDistanceKm.toFixed(1)} km)` : ''}`),
    link('typhoon', '태풍 정보(경로·시각)', !!raw.availability.typhoon, `탐구 5에서 공개${raw.typhoon ? ` · ${raw.typhoon.name}` : ''} · 태풍이 없는 사례는 끄세요`),
    h('p', { class: 'muted small' }, `예측 조위: ${raw.availability.predicted ? (raw.availability.residual ? '있음(잔차 계산 가능)' : `있음, 잔차 계산 불가 — ${raw.residual?.problems?.[0] || ''}`) : '자료 없음(잔차를 계산하지 않음)'}`));
  card.append(linkBox);

  // 사용할 문항
  const qBox = h('fieldset', { class: 't-fieldset t-questions' }, h('legend', {}, '사용할 문항'));
  for (const def of INQUIRIES) {
    const grp = h('div', { class: 't-qgroup' }, h('p', { class: 't-qtitle' }, `탐구 ${def.no}. ${def.title}`));
    const on = new Set(activeQuestions(def, st).map((q) => q.id));
    def.questions.forEach((q, i) => {
      const cb = h('input', { type: 'checkbox', id: `t-q-${q.id}` });
      cb.checked = on.has(q.id);
      cb.addEventListener('change', () => change(() => { st.questions[q.id] = cb.checked; }));
      grp.append(h('label', { class: 'wx-check t-q', for: `t-q-${q.id}` }, cb, ` ${i + 1}. ${q.text}${q.optional ? ' (선택 문항)' : ''}`));
    });
    qBox.append(grp);
  }
  qBox.append(h('p', { class: 'muted small' }, '대조·소조의 정답 날짜를 학생에게 지정하는 기능은 없습니다. 학생이 자료에서 직접 찾고 근거를 씁니다.'));
  card.append(qBox);

  // 교사용 메모
  const memo = h('textarea', { id: 't-memo', rows: 3, placeholder: '예: 9/6 전후 해수면 상승 관찰 기대. 서해 관측소와 비교할지 결정 필요' });
  memo.value = st.memo || '';
  memo.addEventListener('input', () => { st.memo = memo.value; persist(T); });
  card.append(h('label', { for: 't-memo' }, h('b', {}, '교사용 메모')), h('p', { class: 'muted small' }, '학생 화면, 학생 PDF, 학생용 배포 파일에는 들어가지 않습니다(교사 보관용 파일에만 저장).'), memo);

  // 검증
  const v = validateStationSetup(raw, st);
  const vBox = h('section', { class: 't-valid', id: 't-valid', 'aria-labelledby': 't-valid-h' });
  vBox.append(h('h3', { id: 't-valid-h' }, '설정 검증'));
  vBox.append(h('ul', { class: 't-vlist' }, ...v.map((x) => h('li', { class: `t-v-${x.level}` }, h('span', { class: `badge ${LEVEL[x.level][1]}` }, LEVEL[x.level][0]), ' ', h('b', {}, x.area), ` ${x.text}`))));
  card.append(vBox);
  return card;
}

async function exportDialog(T) {
  persist(T);
  const enabled = Object.entries(T.cfg.stations).filter(([, s]) => s.enabled).map(([id]) => T.entries.find((e) => e.id === id)?.name || id);
  const notReviewed = Object.entries(T.cfg.stations).filter(([, s]) => s.enabled && !s.reviewed).map(([id]) => T.entries.find((e) => e.id === id)?.name || id);
  const errors = T.entries.filter((e) => T.cfg.stations[e.id].enabled).flatMap((e) => validateStationSetup(e.cd, T.cfg.stations[e.id]).filter((x) => x.level === 'error').map((x) => `${e.name}: ${x.text}`));
  const v = await choiceDialog({
    title: '설정 저장·내보내기',
    html: true,
    body: `<p>✓ 현재 설정은 <b>이 브라우저에 저장</b>되어 있습니다(미리보기에만 적용).</p>
      <p>평가에 사용: ${escapeHtml(enabled.join(', ') || '없음')}</p>
      ${notReviewed.length ? `<p class="warn">⚠ 교사 검토 필요(임시 후보): ${escapeHtml(notReviewed.join(', '))}</p>` : ''}
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
  render(app, T);
  toast('학생용 배포 설정으로 되돌렸습니다.');
}

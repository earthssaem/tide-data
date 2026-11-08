// 탐구 1 — 조석의 규칙 (부산 예측 조위)
import { h, toast } from '../util/dom.js';
import { fmtNum, escapeHtml } from '../util/format.js';
import { fmtDateTime, fmtDateKo, fmtRange, DAY } from '../util/time.js';
import { INQUIRIES, PREDICTED_TEXT } from '../content/questions.js';
import { createPanel, tipRow } from '../chart/panel.js';
import { inq1MainSpec, inq1DailySpec, monthDays } from '../chart/assess.js';
import { nearestValid } from '../analysis/series.js';
import { inquiryHeader, questionShell, answerOf, numberInput, revealCard } from './common.js';
import { createDrawingPad } from './drawing-pad.js';

export function render(app, container) {
  const { ad, store } = app;
  const def = INQUIRIES[0];
  const cd = ad.st[ad.rep];
  const tz = ad.tz;
  const S = () => store.state;
  const [Q1, Q2, Q3, Q4] = def.questions;
  const panels = [];
  const moonShown = () => !!S().reveals.moon;

  container.append(inquiryHeader(def));
  const ws = h('div', { class: 'workspace' });
  const left = h('section', { class: 'analysis', 'aria-label': '그래프' });
  const right = h('aside', { class: 'qpanel', 'aria-label': '문항과 답' });
  ws.append(left, right);
  container.append(ws);

  // ── 그래프 1: 3일 예측 조위 ──
  let current = null; // 그래프에서 누른 점
  const card1 = h('div', { class: 'card chart-card', id: 'inq1-main' });
  card1.append(h('div', { class: 'card-head' },
    h('h2', {}, `부산 예측 조위 · ${fmtRange(ad.win.inq1[0], ad.win.inq1[1], tz)}`),
    h('p', { class: 'data-line' }, `예측 조위: ${PREDICTED_TEXT} 1시간 간격 · 단위 cm`)));
  const host1 = h('div', { class: 'chart-host' });
  const pickBar = h('div', { class: 'pick-bar', id: 'q1-pickbar', 'aria-live': 'polite' });
  card1.append(host1, pickBar);
  left.append(card1);
  const pick1 = (t) => {
    const p = nearestValid(cd.predicted.points, t, { t0: ad.win.inq1[0], t1: ad.win.inq1[1] });
    return p ? { t: p.t, v: p.v } : null;
  };
  const p1 = createPanel({
    host: host1, height: 330, ariaLabel: '부산 예측 조위 3일 그래프',
    build: (ctx) => inq1MainSpec(ctx, ad, S().answers, { title: false }),
    pick: pick1,
    describe: (tg) => `<div class="tip-title">${escapeHtml(fmtDateTime(tg.t, tz))}</div>${tipRow('예측 조위', `${fmtNum(tg.v, 1)} cm`)}`,
    onClick: (tg) => { current = tg; renderPickBar(); },
  });
  panels.push(p1);
  function renderPickBar() {
    pickBar.innerHTML = '';
    if (!current) { pickBar.append(h('span', { class: 'muted small' }, '그래프의 점을 누르면 여기에 시각과 높이가 나타납니다.')); return; }
    pickBar.append(h('span', { class: 'pick-now' }, h('b', {}, '누른 점 '), `${fmtDateTime(current.t, tz)} · ${fmtNum(current.v, 1)} cm`));
    if (Q1 && questionShellEnabled(Q1)) {
      pickBar.append(
        h('button', { type: 'button', class: 'btn btn-sm btn-secondary', id: 'q1-set-high', onclick: () => setQ1('high') }, '만조로 기록'),
        h('button', { type: 'button', class: 'btn btn-sm btn-secondary', id: 'q1-set-low', onclick: () => setQ1('low') }, '간조로 기록'));
    }
  }
  const questionShellEnabled = (q) => app.ad.setup?.questions?.[q.id] !== false;
  function setQ1(kind) {
    if (!current) return;
    store.update((s) => { s.answers.q1[kind] = { t: current.t, v: current.v }; }, { topic: 'answer', immediate: true });
    toast(`${kind === 'high' ? '만조' : '간조'}로 기록했습니다.`);
    p1.render();
    renderQ1();
  }
  renderPickBar();

  // ── 그래프 2: 한 달 일별 변동 폭 ──
  let currentDay = null;
  const days = monthDays(cd, ad.win.month);
  const card2 = h('div', { class: 'card chart-card', id: 'inq1-daily' });
  card2.append(h('div', { class: 'card-head' },
    h('h2', {}, `부산 예측 조위 · 한 달 일별 변동 폭 (${ad.setup.month})`),
    h('p', { class: 'data-line' }, '막대 하나 = 하루 동안 예측 조위의 최고값 − 최저값. 막대를 누르면 그날을 고릅니다.')));
  const host2 = h('div', { class: 'chart-host' });
  const dayBar = h('div', { class: 'pick-bar', id: 'q3-pickbar', 'aria-live': 'polite' });
  const moonList = h('div', { class: 'moon-list small', id: 'moon-list' });
  card2.append(host2, dayBar, moonList);
  left.append(card2);
  const dayAt = (t) => days.find((d) => t >= d.start && t < d.end) || null;
  const p2 = createPanel({
    host: host2, height: 280, ariaLabel: '한 달 일별 변동 폭 막대그래프', step: DAY,
    build: (ctx) => inq1DailySpec(ctx, ad, answerQ3View(), { showMoon: moonShown(), focusDay: currentDay?.day, title: false }),
    pick: (t) => { const d = dayAt(t); return d ? { t: d.start + DAY / 2, v: d.range, day: d } : null; },
    describe: (tg) => `<div class="tip-title">${escapeHtml(fmtDateKo(tg.day.start, tz))}</div>${tipRow('변동 폭', tg.day.range != null ? `${fmtNum(tg.day.range, 1)} cm` : '자료 미제공')}${tg.day.complete ? '' : tipRow('주의', `결측 ${tg.day.missing}시간`)}`,
    onClick: (tg) => { currentDay = tg.day; renderDayBar(); p2.render(); },
  });
  panels.push(p2);
  function answerQ3View() { return { q3: answerOf(S(), Q3) || {} }; }
  function renderDayBar() {
    dayBar.innerHTML = '';
    if (!currentDay) { dayBar.append(h('span', { class: 'muted small' }, '막대를 누르면 여기에 날짜와 변동 폭이 나타납니다.')); return; }
    dayBar.append(h('span', { class: 'pick-now' }, h('b', {}, '누른 날 '), `${fmtDateKo(currentDay.start, tz)} · 변동 폭 ${currentDay.range != null ? `${fmtNum(currentDay.range, 1)} cm` : '자료 미제공'}`));
    if (Q3 && questionShellEnabled(Q3) && !S().reveals.moon) {
      dayBar.append(
        h('button', { type: 'button', class: 'btn btn-sm btn-secondary', id: 'q3-set-spring', onclick: () => setQ3('spring') }, '대조로 기록'),
        h('button', { type: 'button', class: 'btn btn-sm btn-secondary', id: 'q3-set-neap', onclick: () => setQ3('neap') }, '소조로 기록'));
    }
  }
  function setQ3(kind) {
    if (!currentDay || S().reveals.moon) return;
    store.update((s) => { s.answers.q3[kind] = currentDay.day; }, { topic: 'answer', immediate: true });
    toast(`${kind === 'spring' ? '대조' : '소조'}로 기록했습니다.`);
    p2.render();
    renderQ3();
  }
  renderDayBar();
  function renderMoonList() {
    moonList.innerHTML = '';
    if (!moonShown() || !cd.moon) return;
    const ph = cd.moon.phases.filter((p) => p.t >= ad.win.month[0] - DAY && p.t < ad.win.month[1] + DAY);
    moonList.append(h('p', {}, h('b', {}, '달의 위상 '), ph.map((p) => `${p.label} ${fmtDateTime(p.t, tz, { year: false })}`).join(' · '), h('span', { class: 'muted' }, ' (계산값, KST)')));
  }
  renderMoonList();

  // ── 문항 ──
  const list = h('ol', { class: 'questions' });
  right.append(list);
  // ①
  const q1Host = h('div');
  function renderQ1() {
    q1Host.innerHTML = '';
    const sh = questionShell(app, Q1);
    if (!sh) return;
    const a = S().answers.q1;
    const row = (label, p, id) => h('tr', { id }, h('th', {}, label), h('td', {}, p ? fmtDateTime(p.t, tz) : '—'), h('td', {}, p ? `${fmtNum(p.v, 1)} cm` : '—'),
      h('td', {}, p ? h('button', { type: 'button', class: 'btn btn-ghost btn-xs', onclick: () => { store.update((s) => { s.answers.q1[id === 'q1-row-high' ? 'high' : 'low'] = null; }, { topic: 'answer', immediate: true }); p1.render(); renderQ1(); } }, '지우기') : ''));
    sh.body.append(h('table', { class: 'data-table compact', id: 'q1-table' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, '시각'), h('th', {}, '높이'), h('th', {}, ''))),
      h('tbody', {}, row('만조', a.high, 'q1-row-high'), row('간조', a.low, 'q1-row-low'))));
    sh.body.append(h('p', { class: 'answer-line' }, '조차 ', numberInput({ id: 'q1-range', value: a.range, label: '조차(cm)', unit: 'cm', onInput: (v) => store.update((s) => { s.answers.q1.range = v; }, { topic: 'answer' }) })));
    q1Host.append(sh.li);
  }
  // ②
  const q2Li = (() => {
    const sh = questionShell(app, Q2);
    if (!sh) return null;
    const a = S().answers.q2;
    const set = (k) => (v) => store.update((s) => { s.answers.q2[k] = v; }, { topic: 'answer' });
    sh.body.append(h('p', { class: 'small muted' }, `24시간: ${fmtRange(ad.win.count[0], ad.win.count[1], tz)}`),
      h('p', { class: 'answer-line' }, '만조 ', numberInput({ id: 'q2-high', value: a.high, label: '만조 횟수', unit: '회', width: 3, onInput: set('high') }),
        ' / 간조 ', numberInput({ id: 'q2-low', value: a.low, label: '간조 횟수', unit: '회', width: 3, onInput: set('low') })),
      h('p', { class: 'answer-line' }, '만조에서 다음 만조까지 약 ', numberInput({ id: 'q2-period', value: a.period, label: '만조에서 다음 만조까지 시간', unit: '시간', width: 4, onInput: set('period') })));
    return sh.li;
  })();
  // ③
  const q3Host = h('div');
  function renderQ3() {
    q3Host.innerHTML = '';
    const sh = questionShell(app, Q3);
    if (!sh) return;
    const a = answerOf(S(), Q3) || {};
    const dayText = (k) => { if (!k) return '—'; const d = days.find((x) => x.day === k); return d ? `${fmtDateKo(d.start, tz)} (변동 폭 ${d.range != null ? `${fmtNum(d.range, 1)} cm` : '자료 미제공'})` : k; };
    sh.body.append(h('table', { class: 'data-table compact', id: 'q3-table' }, h('tbody', {},
      h('tr', {}, h('th', {}, '대조'), h('td', { id: 'q3-spring' }, dayText(a.spring))),
      h('tr', {}, h('th', {}, '소조'), h('td', { id: 'q3-neap' }, dayText(a.neap))))));
    q3Host.append(sh.li);
  }
  // ④
  const q4Li = (() => {
    const sh = questionShell(app, Q4);
    if (!sh) return null;
    const a = answerOf(S(), Q4) || {};
    const grid = h('div', { class: 'draw-grid' });
    for (const [k, label] of [['spring', '대조'], ['neap', '소조']]) {
      const pad = createDrawingPad({
        id: `draw-q4-${k}`, label: `${label}일 때의 위치 관계`, value: a[k] || null, locked: !!sh.locked,
        onChange: (d) => store.update((s) => { s.answers.q4[k] = d; }, { topic: 'drawing' }),
      });
      grid.append(h('div', { class: 'draw-cell' }, h('p', { class: 'draw-label' }, `${label}일 때`), pad.el));
    }
    sh.body.append(h('p', { class: 'small muted' }, '태양·지구·달을 간단한 원과 글자로 그리세요.'), grid);
    return sh.li;
  })();

  renderQ1();
  renderQ3();
  list.append(q1Host, ...(q2Li ? [q2Li] : []), q3Host, ...(q4Li ? [q4Li] : []));
  // [달의 위상 확인] — ④ 아래
  right.append(revealCard(app, 'moon', {
    title: '달의 위상 확인',
    text: `③에서 고른 날짜와 ④의 그림은 이 버튼을 누르는 순간 그대로 보관되고, 그 뒤에는 고칠 수 없습니다. 누르면 한 달 그래프에 달의 위상이 표시됩니다.`,
    doneText: '한 달 그래프에 달의 위상을 표시했습니다. ③·④는 확인 전 답으로 고정되었습니다.',
  }));

  return { destroy() { panels.forEach((p) => p.destroy()); } };
}


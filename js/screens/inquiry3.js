// 탐구 3 — 예측과 실제 (부산, 분석 연월) · 변동 폭 비교만
// 높이 기준면이 확인되지 않아 예측과 관측의 높이를 겹치거나 빼지 않는다(관측−예측 차이는 계산하지 않음).
import { h } from '../util/dom.js';
import { fmtNum, escapeHtml } from '../util/format.js';
import { fmtDateTime, fmtRange, HOUR } from '../util/time.js';
import { INQUIRIES, PREDICTED_TEXT, OBSERVED_TEXT } from '../content/questions.js';
import { createPanel, SharedCursor, tipRow } from '../chart/panel.js';
import { inq3Specs, inq3DailySpec, extremaIn, valueAt } from '../chart/assess.js';
import { nearestValid } from '../analysis/series.js';
import { inquiryHeader, questionShell, textAnswer, simpleTextQuestion } from './common.js';

/** 고른 구간의 변동 폭(최고 − 최저) */
export function intervalRanges(cd, t0, t1) {
  const p = extremaIn(cd.predicted, t0, t1);
  const o = extremaIn(cd.observed, t0, t1);
  return { pred: p, obs: o, hours: Math.round((t1 - t0) / HOUR) };
}

export function render(app, container) {
  const { ad, store } = app;
  const def = INQUIRIES[2];
  const cd = ad.st[ad.rep];
  const tz = ad.tz;
  const S = () => store.state;
  const [Q7, Q8] = def.questions;
  const view = ad.win.inq3;
  const panels = [];
  let drag = null;

  container.append(inquiryHeader(def));
  const ws = h('div', { class: 'workspace' });
  const left = h('section', { class: 'analysis', 'aria-label': '그래프' });
  const right = h('aside', { class: 'qpanel', 'aria-label': '문항과 답' });
  ws.append(left, right);
  container.append(ws);

  const card = h('div', { class: 'card chart-card', id: 'inq3-charts' });
  card.append(h('div', { class: 'card-head' },
    h('h2', {}, `부산 예측 조위와 관측 조위 · ${ad.setup.month}`),
    h('p', { class: 'data-line' }, `예측 조위: ${PREDICTED_TEXT}`),
    h('p', { class: 'data-line' }, `관측 조위: ${OBSERVED_TEXT}`),
    h('p', { class: 'small muted' }, Q7 && app.ad.setup?.questions?.q7 !== false ? '그래프 위에서 누른 채 옆으로 끌면 구간이 골라집니다(키보드: Shift + 화살표).' : '')));
  left.append(card);
  const cursor = new SharedCursor();
  const brushOn = app.ad.setup?.questions?.q7 !== false;
  const onBrush = (r, done) => {
    drag = r;
    if (done && r) {
      store.update((s) => { s.answers.q7.t0 = r[0]; s.answers.q7.t1 = r[1]; }, { topic: 'answer', immediate: true });
      drag = null;
      renderSel();
    }
    panels.forEach((p) => p.render());
  };
  ['predicted', 'observed'].forEach((kind, i) => {
    const host = h('div', { class: 'chart-host', id: `inq3-${kind}` });
    card.append(host);
    panels.push(createPanel({
      host, height: i === 0 ? 230 : 250, ariaLabel: `부산 ${kind === 'predicted' ? '예측' : '관측'} 조위 한 달`, cursor,
      build: (ctx) => inq3Specs(ctx, ad, S().answers, { drag })[i],
      pick: (t) => { const p = nearestValid(cd[kind].points, t, { t0: view[0], t1: view[1] }); return p ? { t: p.t, v: p.v } : null; },
      describe: (tg) => `<div class="tip-title">${escapeHtml(fmtDateTime(tg.t, tz))}</div>${tipRow('예측 조위', fmtCm(valueAt(cd.predicted, tg.t)))}${tipRow('관측 조위', fmtCm(valueAt(cd.observed, tg.t)))}`,
      brush: brushOn ? { domain: view, snap: HOUR, onChange: onBrush } : null,
    }));
  });
  const dailyHost = h('div', { class: 'chart-host', id: 'inq3-daily' });
  const dailyCard = h('div', { class: 'card chart-card' }, dailyHost);
  left.append(dailyCard);
  panels.push(createPanel({ host: dailyHost, height: 240, ariaLabel: '일별 변동 폭: 예측과 관측', build: (ctx) => inq3DailySpec(ctx, ad, S().answers) }));

  // ── 문항 ──
  const list = h('ol', { class: 'questions' });
  right.append(list);
  const selHost = h('div', { id: 'q7-sel' });
  function renderSel() {
    selHost.innerHTML = '';
    const a = S().answers.q7;
    if (a.t0 == null) { selHost.append(h('p', { class: 'muted small' }, '아직 고른 구간이 없습니다.')); return; }
    const r = intervalRanges(cd, a.t0, a.t1);
    selHost.append(h('table', { class: 'data-table compact', id: 'q7-table' },
      h('caption', {}, `고른 구간: ${fmtRange(a.t0, a.t1, tz)} (${r.hours}시간)`),
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, '최고'), h('th', {}, '최저'), h('th', {}, '변동 폭'))),
      h('tbody', {},
        h('tr', {}, h('th', {}, '예측'), h('td', {}, fmtCm(r.pred?.max.v)), h('td', {}, fmtCm(r.pred?.min.v)), h('td', { id: 'q7-pred-range' }, fmtCm(r.pred?.range))),
        h('tr', {}, h('th', {}, '관측'), h('td', {}, fmtCm(r.obs?.max.v)), h('td', {}, fmtCm(r.obs?.min.v)), h('td', { id: 'q7-obs-range' }, fmtCm(r.obs?.range))))),
    h('p', { class: 'small muted' }, '변동 폭 = 구간 안 최고값 − 최저값. 높이 기준이 확인되지 않아 예측과 관측의 높이 자체는 비교하지 않습니다.'),
    h('button', { type: 'button', class: 'btn btn-ghost btn-xs', id: 'q7-clear', onclick: () => { store.update((s) => { s.answers.q7.t0 = null; s.answers.q7.t1 = null; }, { topic: 'answer', immediate: true }); renderSel(); panels.forEach((p) => p.render()); } }, '구간 지우기'));
  }
  const sh7 = questionShell(app, Q7);
  if (sh7) {
    renderSel();
    sh7.body.append(selHost, textAnswer(app, Q7, { value: S().answers.q7.text, onInput: (v) => store.update((s) => { s.answers.q7.text = v; }, { topic: 'answer' }) }));
    list.append(sh7.li);
  }
  const li8 = simpleTextQuestion(app, Q8);
  if (li8) list.append(li8);
  return { destroy() { panels.forEach((p) => p.destroy()); } };
}

const fmtCm = (v) => (v == null ? '자료 없음' : `${fmtNum(v, 1)} cm`);

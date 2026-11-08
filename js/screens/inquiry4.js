// 탐구 4 — 원인 추측하기
// 추가 자료(기압·바람·태풍)를 보기 전에 원인을 추측하게 한다. 선택지나 자동 힌트는 주지 않는다.
// [추가 자료 확인]을 누르면 그 순간의 답을 따로 보관하고, 이후에는 고치지 않는다(설명은 탐구 5에서 보완).
import { h } from '../util/dom.js';
import { fmtDateTime, fmtRange } from '../util/time.js';
import { INQUIRIES } from '../content/questions.js';
import { ViewController, ChartView } from '../chart/interactive.js';
import { focusSpec } from '../chart/specs.js';
import { inquiryHeader, createQuestionPanel } from './common.js';

export function render(app, container) {
  const { cd, store } = app;
  const def = INQUIRIES[3];
  container.append(inquiryHeader(def));
  const ws = h('div', { class: 'workspace' });
  const left = h('section', { class: 'analysis', 'aria-label': '지금까지의 관찰' });
  ws.append(left);
  container.append(ws);

  // 집중 관찰 구간 다시 보기(읽기 전용)
  const R = cd.ranges;
  const recap = h('div', { class: 'card chart-card' });
  recap.append(h('div', { class: 'card-head row' },
    h('h2', {}, `집중 관찰 구간 다시 보기 — ${cd.station.name}`),
    h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => app.navigate('inq3') }, '탐구 3으로 돌아가기')));
  recap.append(h('p', { class: 'data-line' }, `${fmtRange(R.inq3[0], R.inq3[1], cd.tz)} · 탐구 3에서 고른 지점이 표시됩니다.`));
  const el = h('div', { class: 'chart-host' });
  recap.append(el);
  left.append(recap);
  const ctl = new ViewController({ domain: R.inq3, initial: R.inq3 });
  const chart = new ChartView({
    el, controller: ctl, height: 300, ariaLabel: '집중 관찰 구간 관측 조위(다시 보기)',
    build: (ctx) => focusSpec({ ...ctx, cd }, { ...store.state.analysis.inq3, view: R.inq3 }),
    pick: () => null, step: () => null, onSelect: () => {},
  });
  chart.render();

  // 추가 자료 확인
  const card = h('section', { class: 'card reveal-card', id: 'weather-reveal', 'aria-labelledby': 'wr-h' });
  card.append(h('h2', { id: 'wr-h' }, '추가 자료 확인'));
  const r = store.state.reveals.weather;
  if (r) {
    card.append(
      h('p', { class: 'ok-text' }, `✓ 추가 자료를 확인했습니다 (${fmtDateTime(r.at, { offsetMinutes: -new Date().getTimezoneOffset() })}). 이 탐구의 답은 확인 전의 초기 추측으로 보관되어 고칠 수 없습니다.`),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => app.navigate('inq5') }, '탐구 5로 이동'));
  } else {
    card.append(
      h('p', {}, '오른쪽 두 문항에 지금 생각하는 원인과 확인에 필요한 자료를 먼저 쓰세요. 작성한 답은 자동으로 저장됩니다.'),
      h('p', { class: 'small muted' }, '[추가 자료 확인]을 누르면 그 순간의 답이 ‘추가 자료 확인 전의 초기 추측’으로 따로 보관되고 더 이상 고칠 수 없습니다. 추가 자료를 본 뒤의 생각은 탐구 5에 씁니다.'),
      h('button', { type: 'button', class: 'btn btn-primary', id: 'btn-reveal-weather', onclick: () => app.reveal('weather') }, '추가 자료 확인'));
  }
  left.append(card);

  const panel = createQuestionPanel({ app, def, inquiryNo: 4 });
  ws.append(panel.el);
  return { destroy() { chart.destroy(); } };
}

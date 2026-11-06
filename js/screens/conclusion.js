// 종합 결론
import { h } from '../util/dom.js';
import { CONCLUSION, INQUIRIES } from '../content/questions.js';
import { createQuestionPanel } from './common.js';

export function render(app, container) {
  const { store } = app;
  container.append(h('div', { class: 'inq-head' },
    h('h1', {}, CONCLUSION.title),
    h('p', { class: 'inq-intro' }, CONCLUSION.intro)));
  const ws = h('div', { class: 'workspace' });
  const left = h('section', { class: 'analysis', 'aria-label': '탐구별 답안 다시 보기' });
  left.append(h('div', { class: 'card' },
    h('h2', {}, '탐구별 내 답안 다시 보기'),
    h('p', { class: 'muted small' }, '결론을 쓸 때 참고하세요. 답안을 고치려면 해당 탐구로 이동합니다.')));
  for (const inq of INQUIRIES) {
    const card = h('div', { class: 'card review-card' });
    card.append(h('div', { class: 'card-head row' },
      h('h3', {}, `탐구 ${inq.no}. ${inq.title}`),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => app.navigate(inq.step) }, `탐구 ${inq.no}로 이동`)));
    const ol = h('ol', { class: 'review-list' });
    for (const q of inq.questions) {
      const a = store.state.answers[q.id] || '';
      const links = (store.state.links[q.id] || []).map((id) => store.state.evidences.find((e) => e.id === id)?.num).filter(Boolean);
      ol.append(h('li', {},
        h('p', { class: 'q-text small' }, q.text),
        a.trim() ? h('p', { class: 'review-answer' }, a) : h('p', { class: 'muted small' }, '(작성하지 않음)'),
        h('p', { class: 'muted small' }, `연결 근거: ${links.length ? links.map((n) => `근거 ${n}`).join(', ') : '없음'}`)));
    }
    card.append(ol);
    left.append(card);
  }
  ws.append(left);
  const panel = createQuestionPanel({ app, def: CONCLUSION, inquiryNo: null });
  ws.append(panel.el);
  container.append(ws);
  return null;
}

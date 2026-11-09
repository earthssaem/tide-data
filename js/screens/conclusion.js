// 종합 — 문항 ⑫
import { h } from '../util/dom.js';
import { CONCLUSION, INQUIRIES, CIRCLED, isEnabled } from '../content/questions.js';
import { answerLines } from '../report/model.js';
import { inquiryHeader, simpleTextQuestion } from './common.js';

export function render(app, container) {
  const { ad, store } = app;
  container.append(inquiryHeader(CONCLUSION));
  const ws = h('div', { class: 'workspace' });
  const left = h('section', { class: 'analysis', 'aria-label': '탐구별 내 답 다시 보기' });
  left.append(h('div', { class: 'card' }, h('h2', {}, '탐구별 내 답 다시 보기'), h('p', { class: 'muted small' }, '종합을 쓸 때 참고하세요. 답을 고치려면 해당 탐구로 이동합니다(자료 확인 전에 쓴 답은 고칠 수 없습니다).')));
  for (const inq of INQUIRIES) {
    const card = h('div', { class: 'card review-card' });
    card.append(h('div', { class: 'card-head row' }, h('h3', {}, `탐구 ${inq.no}. ${inq.title}`),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => app.navigate(inq.step) }, `탐구 ${inq.no}로 이동`)));
    const ol = h('ul', { class: 'review-list' });
    for (const q of inq.questions.filter((x) => isEnabled(x, ad.setup))) {
      const lines = q.afterReveal && !store.state.reveals[q.afterReveal] ? [] : answerLines(ad, store.state, q);
      const drew = q.id === 'q4' ? ['spring', 'neap'].filter((k) => store.state.answers.q4[k]).length : 0;
      const hidden = q.afterReveal && !store.state.reveals[q.afterReveal];
      ol.append(h('li', {}, h('p', { class: 'q-text small' }, `${CIRCLED[q.no]} ${hidden ? '(추가 자료 확인 뒤에 나타나는 문항)' : q.text}`),
        ...(q.id === 'q4' ? [h('p', { class: drew ? 'review-answer' : 'muted small' }, drew ? `달의 위치 ${drew}칸 배치` : '(배치하지 않음)'), ...lines.map((l) => h('p', { class: 'review-answer' }, l))]
          : lines.length ? lines.map((l) => h('p', { class: 'review-answer' }, l)) : [h('p', { class: 'muted small' }, '(작성하지 않음)')])));
    }
    card.append(ol);
    left.append(card);
  }
  const right = h('aside', { class: 'qpanel', 'aria-label': '문항과 답' });
  const list = h('ol', { class: 'questions' });
  for (const q of CONCLUSION.questions) { const li = simpleTextQuestion(app, q, { rows: 3, placeholder: q.placeholder }); if (li) list.append(li); }
  right.append(list);
  ws.append(left, right);
  container.append(ws);
  return null;
}

// 종합 결론
import { h } from '../util/dom.js';
import { CONCLUSION, INQUIRIES, activeQuestions } from '../content/questions.js';
import { createQuestionPanel, lockedBy, revealedAnswer } from './common.js';

export function render(app, container) {
  const { store, cd } = app;
  const S = store.state;
  container.append(h('div', { class: 'inq-head' },
    h('h1', {}, CONCLUSION.title),
    h('p', { class: 'inq-intro' }, CONCLUSION.intro)));
  const ws = h('div', { class: 'workspace' });
  const left = h('section', { class: 'analysis', 'aria-label': '탐구별 답안 다시 보기' });

  // 처음 생각 ↔ 보완한 설명
  const init = revealedAnswer(S, 'weather', 'a4q1');
  const fin = S.answers.a5q3 || '';
  left.append(h('div', { class: 'card side-card', id: 'side-by-side' },
    h('h2', {}, '처음의 추측과 보완한 설명 나란히 보기'),
    h('div', { class: 'side-grid' },
      h('div', {}, h('h3', {}, '탐구 4 · 추가 자료 확인 전의 초기 추측'), init.trim() ? h('p', { class: 'review-answer' }, init) : h('p', { class: 'muted small' }, '(작성하지 않음)')),
      h('div', {}, h('h3', {}, '탐구 5 · 추가 자료를 확인한 뒤의 설명'), fin.trim() ? h('p', { class: 'review-answer' }, fin) : h('p', { class: 'muted small' }, '(작성하지 않음)')))));

  left.append(h('div', { class: 'card' },
    h('h2', {}, '탐구별 내 답안 다시 보기'),
    h('p', { class: 'muted small' }, '결론을 쓸 때 참고하세요. 답안을 고치려면 해당 탐구로 이동합니다(자료 공개 전에 쓴 답은 고칠 수 없습니다).')));
  for (const inq of INQUIRIES) {
    const card = h('div', { class: 'card review-card' });
    card.append(h('div', { class: 'card-head row' },
      h('h3', {}, `탐구 ${inq.no}. ${inq.title}`),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => app.navigate(inq.step) }, `탐구 ${inq.no}로 이동`)));
    const ol = h('ol', { class: 'review-list' });
    for (const q of activeQuestions(inq, cd.setup)) {
      const lock = lockedBy(S, q);
      const a = lock ? revealedAnswer(S, q.lockAfter, q.id) : (S.answers[q.id] || '');
      const links = (S.links[q.id] || []).map((id) => S.evidences.find((e) => e.id === id)?.num).filter(Boolean);
      ol.append(h('li', {},
        h('p', { class: 'q-text small' }, q.text),
        a.trim() ? h('p', { class: 'review-answer' }, a) : h('p', { class: 'muted small' }, q.afterReveal && !S.reveals[q.afterReveal] ? '(자료 확인 전 — 아직 쓰지 않음)' : '(작성하지 않음)'),
        h('p', { class: 'muted small' }, `연결 근거: ${links.length ? links.map((n) => `근거 ${n}`).join(', ') : '없음'}${lock ? ' · 자료 공개 전 답(고정)' : ''}`)));
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

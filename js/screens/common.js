// 탐구 화면 공통 부품: 머리말, 문항 칸, 글 답 입력, 자료 공개 카드
import { h, autosize } from '../util/dom.js';
import { fmtDateTime } from '../util/time.js';
import { REVEALS, CIRCLED, isEnabled } from '../content/questions.js';

export const localTz = () => ({ offsetMinutes: -new Date().getTimezoneOffset(), label: '' });

export function inquiryHeader(def, extra = null) {
  return h('header', { class: 'inq-head' },
    h('h1', {}, def.no <= 4 ? `탐구 ${def.no}. ${def.title}` : def.title),
    h('p', { class: 'inq-goal' }, h('b', {}, '탐구 목표 '), def.goal),
    def.intro ? h('p', { class: 'inq-intro' }, def.intro) : null,
    extra);
}

/** 이 문항이 자료 공개로 고정되었는지(고정되었으면 공개 기록) */
export function lockOf(state, q) {
  return q.lockAfter && state.reveals[q.lockAfter] ? state.reveals[q.lockAfter] : null;
}

/** 고정된 문항은 공개 순간에 보관한 답, 아니면 현재 답 */
export function answerOf(state, q) {
  const lock = lockOf(state, q);
  if (lock && lock.answers && q.id in lock.answers) return lock.answers[q.id];
  return state.answers[q.id];
}

/**
 * 문항 칸
 * @returns {{li:HTMLElement, body:HTMLElement, locked:object|null, waiting:boolean}|null} 교사가 끈 문항이면 null
 */
export function questionShell(app, q) {
  if (!isEnabled(q, app.ad.setup)) return null;
  const s = app.store.state;
  const li = h('li', { class: 'q', id: `q-${q.id}` });
  li.append(h('div', { class: 'q-head' }, h('span', { class: 'q-no' }, `문항 ${CIRCLED[q.no]}`), q.hint ? h('span', { class: 'chip' }, q.hint) : null));
  const locked = lockOf(s, q);
  const waiting = !!(q.afterReveal && !s.reveals[q.afterReveal]);
  // 공개 뒤에 쓰는 문항은 공개 전에는 문항 내용도 보이지 않는다(원인 자료를 미리 알리지 않음)
  li.append(h('p', { class: 'q-text', id: `qt-${q.id}` }, waiting ? `[${REVEALS[q.afterReveal].label}] 뒤에 문항이 나타납니다.` : q.text));
  if (q.tip && !locked && !waiting) li.append(h('p', { class: 'q-tip' }, q.tip));
  if (locked) li.append(h('p', { class: 'notice notice-lock small' }, `[${REVEALS[q.lockAfter].label}] 전에 작성한 답입니다(${fmtDateTime(locked.at, localTz())}). 고칠 수 없습니다.`));
  const body = h('div', { class: 'q-body' });
  li.append(body);
  return { li, body, locked, waiting };
}

/** 한두 문장 글 답 */
export function textAnswer(app, q, { value, onInput, readOnly = false, rows = 2, placeholder = '한 문장으로 쓰세요.', max = 600, id } = {}) {
  const ta = h('textarea', { id: id || `ans-${q.id}`, class: 'answer answer-short', rows, maxlength: max, 'aria-labelledby': `qt-${q.id}`, placeholder, spellcheck: 'false' });
  ta.value = value || '';
  const count = h('span', { class: 'count', 'aria-hidden': 'true' }, `${ta.value.length}자`);
  if (readOnly) { ta.readOnly = true; ta.classList.add('locked'); } else {
    ta.addEventListener('input', () => { onInput(ta.value); count.textContent = `${ta.value.length}자`; });
  }
  autosize(ta);
  return h('div', { class: 'answer-wrap' }, ta, h('div', { class: 'q-foot' }, h('span'), count));
}

/** 문자열 답 문항(⑧~⑫) */
export function simpleTextQuestion(app, q, opts = {}) {
  const sh = questionShell(app, q);
  if (!sh) return null;
  if (sh.waiting) return sh.li;
  const val = answerOf(app.store.state, q) || '';
  sh.body.append(textAnswer(app, q, {
    value: val, readOnly: !!sh.locked, rows: opts.rows || 2, placeholder: opts.placeholder,
    onInput: (v) => app.store.update((s) => { s.answers[q.id] = v; }, { topic: 'answer' }),
  }));
  return sh.li;
}

/** 자료 공개 카드 */
export function revealCard(app, kind, { title, text, doneText }) {
  const s = app.store.state;
  const R = REVEALS[kind];
  const card = h('div', { class: `card reveal-card${s.reveals[kind] ? ' done' : ''}`, id: `reveal-${kind}` });
  if (s.reveals[kind]) {
    card.append(h('p', { class: 'ok-text' }, `✓ ${R.label} 완료 (${fmtDateTime(s.reveals[kind].at, localTz())}) — ${doneText}`));
  } else {
    card.append(h('h2', { class: 'h-sm' }, title), h('p', { class: 'small' }, text),
      h('button', { type: 'button', class: 'btn btn-accent', id: `btn-reveal-${kind}`, onclick: () => app.reveal(kind) }, `${R.label}`));
  }
  return card;
}

export function numberInput({ id, value, onInput, readOnly, label, unit, width = 5, max = 6 }) {
  const inp = h('input', { type: 'text', inputmode: 'decimal', id, class: 'num-input', size: width, maxlength: max, value: value || '', 'aria-label': label, autocomplete: 'off' });
  if (readOnly) inp.readOnly = true;
  else inp.addEventListener('input', () => { inp.value = inp.value.replace(/[^0-9.\-−]/g, ''); onInput(inp.value); });
  return h('span', { class: 'num-field' }, inp, unit ? h('span', { class: 'unit' }, unit) : null);
}

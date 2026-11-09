// 학생이 탐구 1·2의 기간을 고르는 막대(교사 설정은 처음 보이는 기간).
// [‹ 달 ›]로 달을, [‹ 시작일 ›]로 하루씩 옮긴다(탐구 1의 3일은 그 달 안, 탐구 2는 자료 범위 안에서 달을 넘어 이동).
// 기간을 바꾸면 그 기간에 묶인 기록(① 고른 지점, ③ 고른 날)이 새 기간 밖이면 확인을 받고 지운다(임의로 옮기지 않음).
import { h, confirmDialog, toast } from '../util/dom.js';
import { periodBounds, applyStudentPeriod } from '../setup/setup.js';
import { dayKey } from '../util/time.js';

const monthLabel = (m) => { const [y, mo] = m.split('-').map(Number); return `${y}년 ${mo}월`; };
const toUTC = (k) => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));
const fromUTC = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (k, n) => fromUTC(toUTC(k) + n * 86400e3);
const lastDay = (m) => fromUTC(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0));
const dayLabel = (k) => `${+k.slice(8, 10)}일 (${'일월화수목금토'[new Date(toUTC(k)).getUTCDay()]})`;
const clamp = (k, lo, hi) => (k < lo ? lo : k > hi ? hi : k);
const withDay = (m, k) => `${m}-${k.slice(8, 10)}`;

/** @param {'inq1'|'inq2'} which */
export function periodBar(app, which) {
  const base = app.baseAd || app.ad;
  const B = periodBounds(base);
  const ad = app.ad;
  const tz = ad.tz;
  const S = () => app.store.state;
  const months = B.months;
  const is1 = which === 'inq1';
  const start = dayKey(ad.win[is1 ? 'inq1' : 'inq2'][0], tz);
  const month = is1 ? ad.setup.month : start.slice(0, 7);
  // 그 달에서 고를 수 있는 시작일 범위
  const dayRange = (m) => (is1 ? [B.inq1Min(m), B.inq1Max(m)] : [clamp(`${m}-01`, B.inq2Min, B.inq2Max), clamp(lastDay(m), B.inq2Min, B.inq2Max)]);
  const [lo, hi] = dayRange(month);
  const days = [];
  for (let k = lo; k <= hi; k = addDays(k, 1)) days.push(k);

  const toMonth = (m) => { const [a, b] = dayRange(m); const d = clamp(withDay(m, start), a, b); return is1 ? { month: m, inq1: d } : { inq2: d }; };
  const stepDay = (n) => {
    const k = addDays(start, n);
    if (!is1) return { inq2: k };
    if (k >= lo && k <= hi) return { month, inq1: k };
    const mi = months.indexOf(month) + n; // 그 달을 벗어나면 이웃 달의 처음(끝) 날로
    const m = months[mi];
    if (!m) return null;
    const [a, b] = dayRange(m);
    return { month: m, inq1: n > 0 ? a : b };
  };
  const mi = months.indexOf(month);
  const canDay = (n) => (is1 ? !!stepDay(n) : (n < 0 ? start > B.inq2Min : start < B.inq2Max));

  const btn = (id, label, aria, enabled, fn) => h('button', { type: 'button', class: 'btn btn-secondary btn-sm period-step', id, 'aria-label': aria, disabled: !enabled, onclick: fn }, label);
  const bar = h('div', { class: 'period-bar', id: `${which}-period`, role: 'group', 'aria-label': is1 ? '탐구 1 기간 고르기' : '탐구 2 기간 고르기' });
  const mSel = h('select', { id: `${which}-month`, 'aria-label': '달' });
  mSel.innerHTML = months.map((m) => `<option value="${m}">${monthLabel(m)}</option>`).join('');
  mSel.value = month;
  mSel.addEventListener('change', () => change(toMonth(mSel.value)));
  const dSel = h('select', { id: `${which}-start`, 'aria-label': `${is1 ? B.days1 : B.days2}일 그래프 시작일` });
  dSel.innerHTML = days.map((k) => `<option value="${k}">${dayLabel(k)}</option>`).join('');
  dSel.value = start;
  dSel.addEventListener('change', () => change(is1 ? { month, inq1: dSel.value } : { inq2: dSel.value }));
  bar.append(
    h('b', { class: 'small' }, '기간 고르기'),
    h('span', { class: 'period-field' }, h('span', { class: 'small' }, '달'),
      btn(`${which}-month-prev`, '‹', '이전 달', mi > 0, () => change(toMonth(months[mi - 1]))), mSel,
      btn(`${which}-month-next`, '›', '다음 달', mi < months.length - 1, () => change(toMonth(months[mi + 1])))),
    h('span', { class: 'period-field' }, h('span', { class: 'small' }, `${is1 ? B.days1 : B.days2}일 그래프 시작`),
      btn(`${which}-day-prev`, '‹', '하루 앞으로', canDay(-1), () => change(stepDay(-1))), dSel,
      btn(`${which}-day-next`, '›', '하루 뒤로', canDay(1), () => change(stepDay(1)))));
  const isCustom = is1 ? (S().period.month || S().period.inq1) : S().period.inq2;
  if (isCustom) bar.append(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: `${which}-period-reset`, onclick: () => change(is1 ? { month: null, inq1: null } : { inq2: null }) }, '처음 기간으로'));

  async function change(patch) {
    if (!patch) return;
    const next = { ...S().period, ...patch };
    const nad = applyStudentPeriod(base, next);
    if (is1) {
      const a = S().answers;
      const out = [];
      const inWin = (p) => p && p.t >= nad.win.inq1[0] && p.t <= nad.win.inq1[1];
      if ((a.q1.high && !inWin(a.q1.high)) || (a.q1.low && !inWin(a.q1.low))) out.push('①에서 고른 만조·간조 지점');
      const inMonth = (k) => k && k.startsWith(nad.setup.month);
      if ((a.q3.spring && !inMonth(a.q3.spring)) || (a.q3.neap && !inMonth(a.q3.neap))) out.push('③에서 고른 대조·소조 날짜');
      if (out.length) {
        const ok = await confirmDialog({ title: '기간을 바꿀까요?', body: `새 기간에는 ${out.join('과 ')}이(가) 없어 그 기록이 지워집니다.\n바꾼 뒤 새 기간에서 다시 고르세요.`, okLabel: '바꾸고 기록 지우기' });
        if (!ok) { app.navigate(app.currentStep, { replace: true }); return; }
      }
      const countMoved = nad.win.count[0] !== ad.win.count[0];
      app.store.update((s) => {
        s.period = next;
        if (s.answers.q1.high && !inWin(s.answers.q1.high)) s.answers.q1.high = null;
        if (s.answers.q1.low && !inWin(s.answers.q1.low)) s.answers.q1.low = null;
        if (s.answers.q3.spring && !inMonth(s.answers.q3.spring)) s.answers.q3.spring = null;
        if (s.answers.q3.neap && !inMonth(s.answers.q3.neap)) s.answers.q3.neap = null;
      }, { topic: 'answer', immediate: true });
      const a2 = S().answers.q2;
      if (countMoved && (a2.high || a2.low || a2.period)) toast('24시간 색칠 구간이 바뀌었습니다. ②의 답을 다시 확인하세요.');
    } else {
      app.store.update((s) => { s.period = next; }, { topic: 'ui', immediate: true });
    }
    const keep = document.activeElement?.id;
    app.navigate(app.currentStep, { replace: true });
    // 다시 그린 뒤에도 누르던 버튼·목록에 초점을 두어 연달아 이동할 수 있게(끝에 닿아 꺼졌으면 목록으로)
    const el = keep && document.getElementById(keep);
    (el && !el.disabled ? el : document.getElementById(`${which}-start`))?.focus?.({ preventScroll: true });
  }
  return bar;
}

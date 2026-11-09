// 학생이 탐구 1·2의 기간을 고르는 막대(교사 설정은 처음 보이는 기간).
// 기간을 바꾸면 그 기간에 묶인 기록(① 고른 지점, ③ 고른 날)이 새 기간 밖이면 확인을 받고 지운다(임의로 옮기지 않음).
import { h, confirmDialog, toast } from '../util/dom.js';
import { periodBounds, applyStudentPeriod } from '../setup/setup.js';
import { dayKey } from '../util/time.js';

const monthLabel = (m) => { const [y, mo] = m.split('-').map(Number); return `${y}년 ${mo}월`; };

/** @param {'inq1'|'inq2'} which */
export function periodBar(app, which) {
  const base = app.baseAd || app.ad;
  const B = periodBounds(base);
  const ad = app.ad;
  const tz = ad.tz;
  const S = () => app.store.state;
  const bar = h('div', { class: 'period-bar', id: `${which}-period`, role: 'group', 'aria-label': which === 'inq1' ? '탐구 1 기간 고르기' : '탐구 2 기간 고르기' });
  bar.append(h('b', { class: 'small' }, '기간 고르기'));
  if (which === 'inq1') {
    const mSel = h('select', { id: 'inq1-month', 'aria-label': '한 달 그래프의 달' });
    mSel.innerHTML = B.months.map((m) => `<option value="${m}">${monthLabel(m)}</option>`).join('');
    mSel.value = ad.setup.month;
    const curMonth = ad.setup.month;
    const dIn = h('input', { type: 'date', id: 'inq1-start', min: B.inq1Min(curMonth), max: B.inq1Max(curMonth), value: dayKey(ad.win.inq1[0], tz), 'aria-label': `${B.days1}일 그래프 시작 날짜` });
    mSel.addEventListener('change', () => change({ month: mSel.value, inq1: null }));
    dIn.addEventListener('change', () => { if (dIn.value) change({ month: S().period.month || ad.setup.month, inq1: dIn.value }); });
    bar.append(h('label', { class: 'period-field' }, '달 ', mSel), h('label', { class: 'period-field' }, `${B.days1}일 그래프 시작 `, dIn));
  } else {
    const dIn = h('input', { type: 'date', id: 'inq2-start', min: B.inq2Min, max: B.inq2Max, value: dayKey(ad.win.inq2[0], tz), 'aria-label': `${B.days2}일 그래프 시작 날짜` });
    dIn.addEventListener('change', () => { if (dIn.value) change({ inq2: dIn.value }); });
    bar.append(h('label', { class: 'period-field' }, `${B.days2}일 그래프 시작 `, dIn));
  }
  const isCustom = which === 'inq1' ? (S().period.month || S().period.inq1) : S().period.inq2;
  if (isCustom) bar.append(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: `${which}-period-reset`, onclick: () => change(which === 'inq1' ? { month: null, inq1: null } : { inq2: null }) }, '처음 기간으로'));

  async function change(patch) {
    const next = { ...S().period, ...patch };
    const nad = applyStudentPeriod(base, next);
    if (which === 'inq1') {
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
      app.store.update((s) => {
        s.period = next;
        if (s.answers.q1.high && !inWin(s.answers.q1.high)) s.answers.q1.high = null;
        if (s.answers.q1.low && !inWin(s.answers.q1.low)) s.answers.q1.low = null;
        if (s.answers.q3.spring && !inMonth(s.answers.q3.spring)) s.answers.q3.spring = null;
        if (s.answers.q3.neap && !inMonth(s.answers.q3.neap)) s.answers.q3.neap = null;
      }, { topic: 'answer', immediate: true });
      const a2 = S().answers.q2;
      if (a2.high || a2.low || a2.period) toast('24시간 색칠 구간이 바뀌었습니다. ②의 답을 다시 확인하세요.');
    } else {
      app.store.update((s) => { s.period = next; }, { topic: 'ui', immediate: true });
    }
    app.navigate(app.currentStep, { replace: true });
  }
  return bar;
}

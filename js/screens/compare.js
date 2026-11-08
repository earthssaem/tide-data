// 두 관측소 비교 조작부(탐구 1·2 공통)
// - 비교할 관측소 고르기, 세로축 눈금(개별 / 같은 눈금) 고르기
// - 서로 다른 관측소의 조위 숫자로 해수면 높낮이를 판단하지 않도록 안내

import { h } from '../util/dom.js';
import { stationCaseData } from '../data/loader.js';

/**
 * @param {object} o
 * @param {object} o.app
 * @param {'inq1'|'inq2'} o.key
 * @param {string} o.sameLabel '같은 눈금' 설명
 * @param {string} o.note 안내문
 * @param {()=>void} o.onChange
 */
export function createCompareControls({ app, key, sameLabel, note, onChange }) {
  const { store } = app;
  const cd = app.cd;
  const A = () => store.state.analysis[key];
  const wrap = h('div', { class: 'compare-controls' });
  if (!cd.multi || cd.stations.length < 2) return { el: null, cdB: () => null };
  const sel = h('select', { id: `cmp-${key}`, 'aria-label': '비교할 관측소' });
  sel.innerHTML = `<option value="">비교 안 함</option>${['서해', '남해', '동해', '']
    .map((sea) => cd.stations.filter((s) => s.id !== cd.station.id && (sea ? s.sea === sea : !['서해', '남해', '동해'].includes(s.sea))))
    .flat().map((s) => `<option value="${s.id}">${s.sea ? `[${s.sea}] ` : ''}${s.name} (${s.id})</option>`).join('')}`;
  const cur = A().compare;
  sel.value = cur && stationCaseData(cd, cur.stationId) ? cur.stationId : '';
  const radios = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': '세로축 눈금' });
  for (const [v, label] of [['separate', '개별 눈금'], ['same', sameLabel]]) {
    const id = `cmp-${key}-${v}`;
    const inp = h('input', { type: 'radio', name: `cmp-${key}-y`, id, value: v });
    inp.checked = (cur?.yMode || 'separate') === v;
    inp.addEventListener('change', () => { if (A().compare) { store.update((s) => { s.analysis[key].compare.yMode = v; }, { topic: 'analysis' }); onChange(); } });
    radios.append(inp, h('label', { for: id }, label));
  }
  const setDisabled = () => radios.querySelectorAll('input').forEach((i) => { i.disabled = !sel.value; });
  sel.addEventListener('change', () => {
    const yMode = radios.querySelector('input:checked')?.value || 'separate';
    store.update((s) => { s.analysis[key].compare = sel.value ? { stationId: sel.value, yMode } : null; }, { topic: 'analysis' });
    setDisabled();
    onChange();
  });
  setDisabled();
  wrap.append(
    h('div', { class: 'compare-row' }, h('label', { for: `cmp-${key}` }, h('b', {}, '비교 관측소 ')), sel, h('span', { class: 'compare-y' }, '세로축: ', radios)),
    h('p', { class: 'notice notice-warn small' }, note),
  );
  return {
    el: wrap,
    cdB: () => {
      const c = A().compare;
      return c ? stationCaseData(cd, c.stationId) : null;
    },
    yMode: () => A().compare?.yMode || 'separate',
  };
}

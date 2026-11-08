// 탐구 2 — 지역별 차이 (인천·부산·묵호 예측 조위, 같은 시간 축)
import { h } from '../util/dom.js';
import { fmtNum, escapeHtml } from '../util/format.js';
import { fmtDateTime, fmtRange } from '../util/time.js';
import { INQUIRIES, PREDICTED_TEXT, DATUM_CAUTION, TIDE_TYPES } from '../content/questions.js';
import { createPanel, SharedCursor, tipRow, staticLayoutHTML } from '../chart/panel.js';
import { inq2Specs, inq2Series, stationsMapLayout } from '../chart/assess.js';
import { screenMeasure } from '../chart/svg.js';
import { loadKoreaMap } from '../chart/map.js';
import { nearestValid } from '../analysis/series.js';
import { inquiryHeader, questionShell } from './common.js';

export function render(app, container) {
  const { ad, store } = app;
  const def = INQUIRIES[1];
  const tz = ad.tz;
  const S = () => store.state;
  const [Q5, Q6] = def.questions;
  const view = ad.win.inq2;
  const panels = [];

  container.append(inquiryHeader(def));
  const ws = h('div', { class: 'workspace' });
  const left = h('section', { class: 'analysis', 'aria-label': '그래프' });
  const right = h('aside', { class: 'qpanel', 'aria-label': '문항과 답' });
  ws.append(left, right);
  container.append(ws);

  const card = h('div', { class: 'card chart-card', id: 'inq2-charts' });
  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': '세로 눈금' });
  const mk = (val, label) => {
    const b = h('button', { type: 'button', role: 'radio', class: `seg-btn${S().ui.inq2Scale === val ? ' on' : ''}`, 'aria-checked': S().ui.inq2Scale === val ? 'true' : 'false', id: `inq2-scale-${val}`, onclick: () => {
      store.update((s) => { s.ui.inq2Scale = val; }, { topic: 'ui' });
      seg.querySelectorAll('button').forEach((x) => { const on = x.id === `inq2-scale-${val}`; x.classList.toggle('on', on); x.setAttribute('aria-checked', on ? 'true' : 'false'); });
      panels.forEach((p) => p.render());
    } }, label);
    return b;
  };
  seg.append(mk('same', '같은 축(평균 0)'), mk('own', '개별 눈금'));
  card.append(h('div', { class: 'card-head' },
    h('h2', {}, `세 지역의 예측 조위 · ${fmtRange(view[0], view[1], tz)}`),
    h('p', { class: 'data-line' }, `예측 조위: ${PREDICTED_TEXT}`),
    h('p', { class: 'notice notice-warn small', id: 'datum-caution' }, DATUM_CAUTION)),
  h('div', { class: 'tool-inline' }, h('b', { class: 'small' }, '세로 눈금 '), seg));
  left.append(card);

  const cursor = new SharedCursor();
  ad.stationList.forEach((s, i) => {
    const cd = ad.st[s.id];
    const host = h('div', { class: 'chart-host', id: `inq2-${s.id}` });
    card.append(host);
    panels.push(createPanel({
      host, height: i === ad.stationList.length - 1 ? 210 : 190, ariaLabel: `${s.name} 예측 조위`, cursor,
      build: (ctx) => inq2Specs(ctx, ad, S().ui.inq2Scale)[i],
      pick: (t) => {
        const d = inq2Series(ad, S().ui.inq2Scale)[i];
        const p = nearestValid(d.series.points, t, { t0: view[0], t1: view[1] });
        return p ? { t: p.t, v: p.v, raw: d.mean == null ? p.v : p.v + d.mean, dev: d.mean == null ? null : p.v } : null;
      },
      describe: (tg) => `<div class="tip-title">${escapeHtml(s.name)} · ${escapeHtml(fmtDateTime(tg.t, tz))}</div>${tipRow('예측 조위', `${fmtNum(tg.raw, 1)} cm`)}${tg.dev != null ? tipRow('기간 평균과의 차이', `${tg.dev >= 0 ? '+' : '−'}${fmtNum(Math.abs(tg.dev), 1)} cm`) : ''}`,
    }));
  });

  // 지도
  const mapCard = h('div', { class: 'card map-card', id: 'inq2-map' });
  const mapHost = h('div', { class: 'station-map' });
  mapCard.append(mapHost);
  left.append(mapCard);
  const drawMap = () => {
    const w = Math.min(340, Math.max(240, mapHost.clientWidth || 320));
    mapHost.innerHTML = staticLayoutHTML(stationsMapLayout({ stations: ad.stationList, width: w, measure: screenMeasure, fontSize: 12, title: '세 관측소의 위치' }), '인천·부산·묵호 관측소 위치 지도');
  };
  requestAnimationFrame(drawMap);
  loadKoreaMap()?.then?.(drawMap);

  // ── 문항 ──
  const list = h('ol', { class: 'questions' });
  right.append(list);
  const names = ad.stationList.map((s) => [s.id, s.name]);
  const sh5 = questionShell(app, Q5);
  if (sh5) {
    const row = h('p', { class: 'answer-line order-line', id: 'q5-order' });
    const sels = [0, 1, 2].map((i) => {
      const sel = h('select', { id: `q5-${i}`, 'aria-label': `조차가 ${i + 1}번째로 큰 지역` });
      sel.innerHTML = `<option value="">선택</option>${names.map(([id, n]) => `<option value="${id}">${escapeHtml(n)}</option>`).join('')}`;
      sel.value = S().answers.q5[i] || '';
      sel.addEventListener('change', () => store.update((s) => { s.answers.q5[i] = sel.value; }, { topic: 'answer' }));
      return sel;
    });
    row.append(sels[0], ' > ', sels[1], ' > ', sels[2]);
    sh5.body.append(row);
    list.append(sh5.li);
  }
  const sh6 = questionShell(app, Q6);
  if (sh6) {
    for (const [id, n] of names) {
      const cur = S().answers.q6[id] || { type: '', reason: '' };
      const box = h('fieldset', { class: 'type-box', id: `q6-${id}` }, h('legend', {}, n));
      const radios = h('div', { class: 'type-radios', role: 'radiogroup', 'aria-label': `${n} 조석 형태` });
      TIDE_TYPES.forEach((t, k) => {
        const rid = `q6-${id}-${k}`;
        const r = h('input', { type: 'radio', name: `q6-${id}`, id: rid, value: t });
        r.checked = cur.type === t;
        r.addEventListener('change', () => store.update((s) => { s.answers.q6[id] = { ...(s.answers.q6[id] || { reason: '' }), type: t }; }, { topic: 'answer' }));
        radios.append(h('label', { for: rid, class: 'radio-chip' }, r, ` ${t}`));
      });
      const reason = h('input', { type: 'text', id: `q6-${id}-reason`, class: 'reason-input', maxlength: 200, value: cur.reason || '', placeholder: '근거 한 줄', 'aria-label': `${n} 판단 근거` });
      reason.addEventListener('input', () => store.update((s) => { s.answers.q6[id] = { ...(s.answers.q6[id] || { type: '' }), reason: reason.value }; }, { topic: 'answer' }));
      box.append(radios, reason);
      sh6.body.append(box);
    }
    list.append(sh6.li);
  }
  return { destroy() { panels.forEach((p) => p.destroy()); } };
}

// 탐구 1 — 하루의 규칙 찾기
import { h, toast } from '../util/dom.js';
import { escapeHtml, fmtValue, fmtSignedValue } from '../util/format.js';
import { fmtDateTime, fmtDuration, hoursDecimal } from '../util/time.js';
import { INQUIRIES } from '../content/questions.js';
import { ViewController, ChartView, createToolbar, tipRow } from '../chart/interactive.js';
import { inq1Spec, inq1CompareSpec, sameSpanDomains } from '../chart/specs.js';
import { createCompareControls } from './compare.js';
import { nearestValid, stepValid, dataDomain } from '../analysis/series.js';
import { inq1Values, effectivePair } from '../state/evidence.js';
import { inquiryHeader, createQuestionPanel, addEvidenceBar, nextLetter } from './common.js';

const MAX_POINTS = 8;
const QUALITY = { ok: '정상', suspect: '의심', bad: '오류', missing: '결측' };

export function render(app, container) {
  const { cd, store } = app;
  const def = INQUIRIES[0];
  const A = () => store.state.analysis.inq1;
  let replaceLabel = null;

  container.append(inquiryHeader(def));
  const ws = h('div', { class: 'workspace' });
  const left = h('section', { class: 'analysis', 'aria-label': '그래프와 분석 도구' });
  ws.append(left);
  container.append(ws);

  const obs = cd.observed;
  const controller = new ViewController({
    domain: dataDomain(obs.points),
    initial: cd.ranges.inq1,
    onChange: (v) => store.update((s) => { s.analysis.inq1.view = v; }, { topic: 'analysis' }),
  });
  if (A().view) controller.set(A().view[0], A().view[1], true);

  const card = h('div', { class: 'card chart-card' });
  card.append(h('div', { class: 'card-head' },
    h('h2', {}, `관측 조위 — ${cd.station.name}`),
    h('p', { class: 'data-line' }, `관측 간격 ${obs.intervalMs / 3600e3}시간 · 단위 cm · 높이 기준면: ${obs.datumLabel} · 시간대 ${cd.tz.name || cd.tz.label}`)));
  card.append(createToolbar(controller, { label: '관측 조위 그래프' }));
  const chartEl = h('div', { class: 'chart-host' });
  card.append(chartEl);
  card.append(h('p', { class: 'chart-help' },
    '그래프의 자료점(●)을 누르면 A, B, C … 순서로 선택됩니다. 그래프를 좌우로 끌면 이동합니다. ',
    h('span', { class: 'kbd-help' }, '키보드: 그래프를 선택(Tab)한 뒤 ←/→로 자료점 이동, Enter로 선택, +/−로 확대·축소')));
  card.append(h('p', { class: 'notice notice-info' }, '이 자료는 1시간 간격 관측값입니다. 실제 만조·간조의 시각과 높이는 관측 시각 사이에 있을 수 있으므로, 선택한 값은 “관측값 중 가장 높은(낮은) 값”으로 해석하세요.'));
  left.append(card);

  const chart = new ChartView({
    el: chartEl,
    controller,
    height: 420,
    ariaLabel: `${cd.station.name} 관측 조위 그래프`,
    build: (ctx) => inq1Spec({ ...ctx, cd, yDomain: sameDoms()?.a }, { ...A(), view: controller.view }),
    pick: (t) => {
      const p = nearestValid(obs.points, t, { t0: controller.view[0], t1: controller.view[1] });
      return p ? { t: p.t, v: p.v, q: p.q } : null;
    },
    step: (tg, dir) => { const p = stepValid(obs.points, tg.t, dir); return p ? { t: p.t, v: p.v, q: p.q } : null; },
    describe: (tg) => {
      const sel = A().points.find((p) => p.t === tg.t);
      return `<div class="tip-title">${escapeHtml(fmtDateTime(tg.t, cd.tz))}</div>${tipRow('조위', fmtValue(tg.v, 'cm'))}${tipRow('품질', QUALITY[tg.q] || tg.q)}${sel ? tipRow('선택', sel.label) : '<div class="tip-hint">누르면 선택</div>'}`;
    },
    onSelect: (tg) => select(tg),
  });

  // 선택 지점 표
  // ── 다른 관측소와 비교(여러 관측소 사례) ──
  let cmpChart = null;
  const cmp = createCompareControls({
    app, key: 'inq1', sameLabel: '같은 눈금 크기',
    note: '두 그래프의 시간 범위는 함께 움직입니다. 관측소마다 조위의 높이 기준면이 다를 수 있고 아직 확인되지 않았으므로, 세로축 숫자로 어느 지역의 해수면이 더 높다고 판단하지 마세요. ‘같은 눈금 크기’는 두 그래프의 세로축 간격(높이 범위)을 같게 해 변동 폭을 비교하기 위한 것이며, 축의 숫자는 관측소마다 다릅니다.',
    onChange: () => { buildCompareChart(); chart.render(); },
  });
  const sameDoms = () => {
    const b = cmp.cdB?.();
    return b && cmp.yMode() === 'same' ? sameSpanDomains(cd, b, controller.view) : null;
  };
  const cmpHost = h('div', { class: 'chart-host' });
  if (cmp.el) {
    const cmpCard = h('div', { class: 'card chart-card compare-card' });
    cmpCard.append(h('div', { class: 'card-head' }, h('h2', {}, '다른 관측소와 비교'), h('p', { class: 'data-line' }, '같은 기간에 다른 관측소에서는 하루 동안 해수면이 어떻게 변했는지 나란히 비교합니다. 비교 그래프의 세로선은 위에서 고른 지점(A, B, C …)의 시각입니다.')), cmp.el, cmpHost);
    left.append(cmpCard);
  }
  function buildCompareChart() {
    cmpChart?.destroy();
    cmpChart = null;
    cmpHost.innerHTML = '';
    const b = cmp.cdB?.();
    if (!b) return;
    const el = h('div');
    cmpHost.append(el);
    cmpChart = new ChartView({
      el, controller, height: 360, ariaLabel: `${b.station.name} 관측 조위 비교 그래프`,
      build: (ctx) => inq1CompareSpec({ ...ctx, cd }, { ...A(), view: controller.view }, b, sameDoms()?.b),
      pick: (t) => { const p = nearestValid(b.observed.points, t, { t0: controller.view[0], t1: controller.view[1] }); return p ? { t: p.t, v: p.v, q: p.q } : null; },
      step: (tg, dir) => { const p = stepValid(b.observed.points, tg.t, dir); return p ? { t: p.t, v: p.v, q: p.q } : null; },
      describe: (tg) => `<div class="tip-title">${escapeHtml(b.station.name)} · ${escapeHtml(fmtDateTime(tg.t, cd.tz))}</div>${tipRow('조위', fmtValue(tg.v, 'cm'))}<div class="tip-hint">비교 그래프(지점 선택은 위 그래프에서)</div>`,
      onSelect: () => toast('지점 선택은 위쪽(분석 중인 관측소) 그래프에서 합니다.'),
    });
    cmpChart.render();
  }
  buildCompareChart();

  const selCard = h('div', { class: 'card' });
  const selHead = h('div', { class: 'card-head row' }, h('h2', {}, '선택한 지점'));
  const clearBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => clearAll() }, '선택 모두 해제');
  selHead.append(clearBtn);
  const replaceNote = h('p', { class: 'notice notice-accent', hidden: true, role: 'status' });
  const selTable = h('div', { class: 'table-host', id: 'inq1-points' });
  const diffHost = h('div', { class: 'table-host', id: 'inq1-diffs' });
  selCard.append(selHead, replaceNote, selTable, h('h3', { class: 'sub-h' }, '두 지점 사이의 차이'), diffHost);
  left.append(selCard);
  left.append(addEvidenceBar({ onAdd: () => { app.addEvidence(1, A()); panel.renderEvidence(); } }));

  const panel = createQuestionPanel({
    app, def, inquiryNo: 1,
    getAnalysis: () => ({ ...A(), view: controller.view }),
    applyState: (st) => {
      store.update((s) => { s.analysis.inq1 = { ...s.analysis.inq1, ...st }; }, { topic: 'analysis' });
      if (st.view) controller.set(st.view[0], st.view[1], true);
      refresh();
      toast('근거의 분석 상태를 그래프에 다시 열었습니다. 근거 자체는 바뀌지 않습니다.');
    },
  });
  ws.append(panel.el);

  function select(tg) {
    const pts = A().points;
    if (replaceLabel) {
      const dup = pts.find((p) => p.t === tg.t && p.label !== replaceLabel);
      if (dup) { toast(`이미 ${dup.label}로 선택된 지점입니다.`); return; }
      const lab = replaceLabel;
      store.update((s) => { const p = s.analysis.inq1.points.find((x) => x.label === lab); if (p) p.t = tg.t; }, { topic: 'analysis' });
      replaceLabel = null;
      toast(`${lab} 지점을 바꿨습니다.`);
      refresh();
      return;
    }
    const dup = pts.find((p) => p.t === tg.t);
    if (dup) { toast(`이미 ${dup.label}로 선택된 지점입니다. 해제하려면 표에서 [해제]를 누르세요.`); return; }
    if (pts.length >= MAX_POINTS) { toast(`지점은 최대 ${MAX_POINTS}개까지 선택할 수 있습니다.`); return; }
    const label = nextLetter(pts.map((p) => p.label));
    store.update((s) => {
      s.analysis.inq1.points.push({ label, t: tg.t });
      s.analysis.inq1.points.sort((a, b) => a.label.localeCompare(b.label));
    }, { topic: 'analysis' });
    refresh();
  }

  function clearAll() {
    if (!A().points.length) return;
    store.update((s) => { s.analysis.inq1.points = []; s.analysis.inq1.pair = null; }, { topic: 'analysis' });
    replaceLabel = null;
    refresh();
  }

  function refresh() {
    chart.render();
    cmpChart?.render();
    const v = inq1Values(cd, A());
    replaceNote.hidden = !replaceLabel;
    if (replaceLabel) replaceNote.textContent = `그래프에서 새 자료점을 누르면 ${replaceLabel} 지점이 그 지점으로 바뀝니다.`;
    clearBtn.disabled = !v.points.length;
    if (!v.points.length) {
      selTable.innerHTML = '<p class="muted">아직 선택한 지점이 없습니다. 만조라고 판단한 자료점을 그래프에서 눌러 보세요.</p>';
    } else {
      selTable.innerHTML = '';
      const tbl = h('table', { class: 'data-table' });
      tbl.innerHTML = `<caption class="sr-only">선택한 지점 목록</caption><thead><tr><th scope="col">기호</th><th scope="col">시각 (${escapeHtml(cd.tz.label)})</th><th scope="col">조위</th><th scope="col">품질</th><th scope="col"><span class="sr-only">작업</span></th></tr></thead>`;
      const tb = h('tbody');
      for (const p of v.points) {
        const tr = h('tr', { class: replaceLabel === p.label ? 'replacing' : '' });
        tr.innerHTML = `<th scope="row"><span class="mark-badge">${escapeHtml(p.label)}</span></th><td>${escapeHtml(fmtDateTime(p.t, cd.tz))}</td><td class="num">${escapeHtml(fmtValue(p.v, 'cm'))}</td><td>${escapeHtml(QUALITY[p.q] || '—')}</td>`;
        const td = h('td', { class: 'actions' });
        td.append(
          h('button', { type: 'button', class: 'btn btn-ghost btn-xs', 'aria-pressed': replaceLabel === p.label ? 'true' : 'false', onclick: () => { replaceLabel = replaceLabel === p.label ? null : p.label; refresh(); } }, replaceLabel === p.label ? '변경 취소' : '변경'),
          h('button', { type: 'button', class: 'btn btn-ghost btn-xs', onclick: () => {
            store.update((s) => { s.analysis.inq1.points = s.analysis.inq1.points.filter((x) => x.label !== p.label); }, { topic: 'analysis' });
            if (replaceLabel === p.label) replaceLabel = null;
            refresh();
          } }, '해제'),
        );
        tr.append(td);
        tb.append(tr);
      }
      tbl.append(tb);
      selTable.append(tbl);
    }
    // 차이
    diffHost.innerHTML = '';
    if (v.points.length < 2) {
      diffHost.innerHTML = '<p class="muted">두 지점 이상 선택하면 시간 차이와 높이 차이(뒤 지점 − 앞 지점)가 계산됩니다.</p>';
    } else {
      const tbl = h('table', { class: 'data-table' });
      tbl.innerHTML = `<thead><tr><th scope="col">구간</th><th scope="col">시간 차이</th><th scope="col">높이 차이 (뒤 − 앞)</th></tr></thead><tbody>${v.diffs.map((d) => `<tr${d.custom ? ' class="custom"' : ''}><th scope="row">${escapeHtml(d.from)} → ${escapeHtml(d.to)}</th><td class="num">${escapeHtml(fmtDuration(d.dtMs))} <span class="muted">(${escapeHtml(hoursDecimal(d.dtMs))}시간)</span></td><td class="num">${escapeHtml(fmtSignedValue(d.dv, 'cm'))}</td></tr>`).join('')}</tbody>`;
      diffHost.append(tbl);
      // 임의의 두 지점
      const opts = v.points.map((p) => `<option value="${escapeHtml(p.label)}">${escapeHtml(p.label)}</option>`).join('');
      const pair = effectivePair(A().pair, v.points);
      const row = h('div', { class: 'pair-row' });
      row.innerHTML = `<label>다른 두 지점 비교: <select class="sel-a" aria-label="앞 지점">${opts}</select></label> → <select class="sel-b" aria-label="뒤 지점">${opts}</select>`;
      const sa = row.querySelector('.sel-a'), sb = row.querySelector('.sel-b');
      sa.value = pair[0]; sb.value = pair[1];
      const onPair = () => { store.update((s) => { s.analysis.inq1.pair = [sa.value, sb.value]; }, { topic: 'analysis' }); refresh(); };
      sa.addEventListener('change', onPair); sb.addEventListener('change', onPair);
      diffHost.append(row);
    }
  }

  refresh();
  return {
    destroy() { chart.destroy(); cmpChart?.destroy(); },
  };
}

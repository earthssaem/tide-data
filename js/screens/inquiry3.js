// 탐구 3 — 집중 관찰 구간
// 선생님이 지정한 구간을 확대해서 보여 준다. 이 단계에서는 원인(기상·태풍) 정보나 '비정상' 같은 결론을 붙이지 않는다.
import { h, toast } from '../util/dom.js';
import { escapeHtml, fmtValue, fmtSignedValue, fmtNum } from '../util/format.js';
import { fmtDateTime, fmtDateKo, fmtTime, fmtDuration, hoursDecimal, fmtRange, DAY } from '../util/time.js';
import { INQUIRIES } from '../content/questions.js';
import { ViewController, ChartView, createToolbar, tipRow } from '../chart/interactive.js';
import { focusSpec, monthContextSpec, dayStats } from '../chart/specs.js';
import { nearestValid, stepValid } from '../analysis/series.js';
import { inq3Values, effectivePair } from '../state/evidence.js';
import { inquiryHeader, createQuestionPanel, addEvidenceBar, nextLetter } from './common.js';

const MAX_POINTS = 12;
const QUALITY = { ok: '정상', suspect: '의심', bad: '오류', missing: '결측' };

export function render(app, container) {
  const { cd, store } = app;
  const def = INQUIRIES[2];
  const A = () => store.state.analysis.inq3;
  const obs = cd.observed;
  const R = cd.ranges;

  container.append(inquiryHeader(def));
  const ws = h('div', { class: 'workspace' });
  const left = h('section', { class: 'analysis', 'aria-label': '그래프와 분석 도구' });
  ws.append(left);
  container.append(ws);

  const domain = [Math.min(R.inq2[0], R.inq1[0], R.inq3[0]), Math.max(R.inq2[1], R.inq1[1], R.inq3[1])];
  const controller = new ViewController({
    domain, initial: R.inq3, minSpan: 6 * 3600e3,
    onChange: (v) => store.update((s) => { s.analysis.inq3.view = v; }, { topic: 'analysis' }),
  });
  if (A().view) controller.set(A().view[0], A().view[1], true);

  const card = h('div', { class: 'card chart-card' });
  card.append(h('div', { class: 'card-head' },
    h('h2', {}, `집중 관찰 구간 — ${cd.station.name}`),
    h('p', { class: 'data-line' }, `선생님 지정 구간 ${fmtRange(R.inq3[0], R.inq3[1], cd.tz)} · 관측 간격 ${obs.intervalMs / 3600e3}시간 · 단위 cm · 높이 기준면: ${obs.datumLabel}`)));
  const extra = `<span class="tool-sep" aria-hidden="true"></span>
    <button type="button" class="tool" data-go="focus" title="선생님이 지정한 집중 관찰 구간">집중 관찰 구간</button>
    <button type="button" class="tool" data-go="basic" title="탐구 1의 기본 관찰 구간">기본 관찰 구간</button>
    <button type="button" class="tool" data-go="month" title="탐구 2의 한 달 전체">한 달 전체</button>`;
  const tb = createToolbar(controller, { label: '집중 관찰 구간 그래프', extra });
  tb.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-go]');
    if (!b) return;
    const r = b.dataset.go === 'basic' ? R.inq1 : b.dataset.go === 'month' ? R.inq2 : R.inq3;
    controller.set(r[0], r[1]);
  });
  card.append(tb);
  const chartEl = h('div', { class: 'chart-host' });
  card.append(chartEl);
  card.append(h('p', { class: 'chart-help' },
    '자료점(●)을 누르면 A, B, C … 순서로 선택됩니다. 그래프를 좌우로 끌면 이동합니다. ',
    h('span', { class: 'kbd-help' }, '키보드: 그래프를 선택(Tab)한 뒤 ←/→로 자료점 이동, Enter로 선택, +/−로 확대·축소')));
  card.append(h('p', { class: 'notice notice-info' }, '해수면이 전체적으로 높아진 것(최고값·최저값·평균이 함께 달라짐)과 해수면 변동 폭이 커진 것(최고값 − 최저값이 달라짐)을 구분해서 관찰하세요. 뚜렷한 차이가 없다고 판단해도 근거를 들어 쓰면 됩니다.'));
  left.append(card);

  const chart = new ChartView({
    el: chartEl, controller, height: 400, ariaLabel: `${cd.station.name} 집중 관찰 구간 관측 조위 그래프`,
    build: (ctx) => focusSpec({ ...ctx, cd }, { ...A(), view: controller.view }),
    pick: (t) => { const p = nearestValid(obs.points, t, { t0: controller.view[0], t1: controller.view[1] }); return p ? { t: p.t, v: p.v, q: p.q } : null; },
    step: (tg, dir) => { const p = stepValid(obs.points, tg.t, dir); return p ? { t: p.t, v: p.v, q: p.q } : null; },
    describe: (tg) => {
      const sel = A().points.find((p) => p.t === tg.t);
      return `<div class="tip-title">${escapeHtml(fmtDateTime(tg.t, cd.tz))}</div>${tipRow('조위', fmtValue(tg.v, 'cm'))}${tipRow('품질', QUALITY[tg.q] || tg.q)}${sel ? tipRow('선택', sel.label) : '<div class="tip-hint">누르면 선택</div>'}`;
    },
    onSelect: (tg) => select(tg),
  });

  // ── 한 달 그래프에서의 위치 ──
  const monthCtl = new ViewController({ domain: R.inq2, initial: R.inq2, minSpan: DAY });
  const monthCard = h('div', { class: 'card chart-card' });
  monthCard.append(h('div', { class: 'card-head' }, h('h2', {}, '한 달 관측 조위에서의 위치'), h('p', { class: 'data-line' }, '띠는 위 그래프에서 보고 있는 범위입니다. 한 달 그래프를 누르면 그 날짜 쪽으로 위 그래프가 이동합니다.')));
  const monthEl = h('div', { class: 'chart-host' });
  monthCard.append(monthEl);
  left.append(monthCard);
  const monthChart = new ChartView({
    el: monthEl, controller: monthCtl, height: 220, ariaLabel: '한 달 관측 조위에서 집중 관찰 구간의 위치',
    build: (ctx) => monthContextSpec({ ...ctx, cd }, controller.view),
    pick: (t) => ({ t }),
    step: (tg, dir) => ({ t: tg.t + dir * DAY }),
    describe: (tg) => `<div class="tip-title">${escapeHtml(fmtDateKo(tg.t, cd.tz))}</div><div class="tip-hint">누르면 위 그래프를 이 날짜 쪽으로 이동</div>`,
    onSelect: (tg) => { const [a, b] = controller.view; const half = (b - a) / 2; controller.set(tg.t - half, tg.t + half); },
  });
  monthChart.hoverValue = () => null;

  // ── 날짜별 통계 ──
  const statCard = h('div', { class: 'card' });
  statCard.append(h('div', { class: 'card-head' }, h('h2', {}, '날짜별 관측 최고값·최저값·평균과 변동 폭'), h('p', { class: 'data-line' }, '위 그래프에서 보고 있는 범위에 걸친 날짜입니다. 변동 폭 = 그날 관측 최고값 − 관측 최저값, 평균 = 그날 1시간 간격 관측값의 평균.')));
  const statHost = h('div', { class: 'table-host', id: 'inq3-days' });
  statCard.append(statHost);
  left.append(statCard);

  // ── 선택 지점 ──
  const selCard = h('div', { class: 'card' });
  const clearBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => {
    store.update((s) => { s.analysis.inq3.points = []; s.analysis.inq3.pair = null; }, { topic: 'analysis' });
    refresh();
  } }, '선택 모두 해제');
  selCard.append(h('div', { class: 'card-head row' }, h('h2', {}, '선택한 지점'), clearBtn));
  const selTable = h('div', { class: 'table-host', id: 'inq3-points' });
  const diffHost = h('div', { class: 'table-host', id: 'inq3-diffs' });
  selCard.append(selTable, h('h3', { class: 'sub-h' }, '두 지점 사이의 차이'), diffHost);
  left.append(selCard);
  left.append(addEvidenceBar({ onAdd: () => { app.addEvidence(3, { ...A(), view: controller.view }); panel.renderEvidence(); } }));

  const panel = createQuestionPanel({
    app, def, inquiryNo: 3,
    getAnalysis: () => ({ ...A(), view: controller.view }),
    applyState: (st) => {
      store.update((s) => { s.analysis.inq3 = { ...s.analysis.inq3, ...st }; }, { topic: 'analysis' });
      if (st.view) controller.set(st.view[0], st.view[1], true);
      refresh();
      toast('근거의 분석 상태를 그래프에 다시 열었습니다. 근거 자체는 바뀌지 않습니다.');
    },
  });
  ws.append(panel.el);

  function select(tg) {
    const pts = A().points;
    const dup = pts.find((p) => p.t === tg.t);
    if (dup) { toast(`이미 ${dup.label}로 선택된 지점입니다. 해제하려면 표에서 [해제]를 누르세요.`); return; }
    if (pts.length >= MAX_POINTS) { toast(`지점은 최대 ${MAX_POINTS}개까지 선택할 수 있습니다.`); return; }
    const label = nextLetter(pts.map((p) => p.label));
    store.update((s) => {
      s.analysis.inq3.points.push({ label, t: tg.t });
      s.analysis.inq3.points.sort((a, b) => a.label.localeCompare(b.label));
    }, { topic: 'analysis' });
    refresh();
  }

  function renderStats() {
    const [a, b] = controller.view;
    const days = dayStats(cd, a, b);
    statHost.innerHTML = '';
    const tbl = h('table', { class: 'data-table compact' });
    tbl.innerHTML = `<thead><tr><th scope="col">날짜</th><th scope="col">관측 최고값 (시각)</th><th scope="col">관측 최저값 (시각)</th><th scope="col">관측값 평균</th><th scope="col">변동 폭</th><th scope="col">자료</th></tr></thead>
      <tbody>${days.map((d) => `<tr><th scope="row">${escapeHtml(fmtDateKo(d.start, cd.tz))}</th>
        <td class="num">${d.max ? `${escapeHtml(fmtNum(d.max.v))} cm (${escapeHtml(fmtTime(d.max.t, cd.tz))})` : '자료 없음'}</td>
        <td class="num">${d.min ? `${escapeHtml(fmtNum(d.min.v))} cm (${escapeHtml(fmtTime(d.min.t, cd.tz))})` : '자료 없음'}</td>
        <td class="num">${d.mean == null ? '—' : `${escapeHtml(fmtNum(d.mean, 1))} cm`}</td>
        <td class="num"><b>${d.range == null ? '자료 없음' : `${escapeHtml(fmtNum(d.range))} cm`}</b></td>
        <td>${d.complete ? `완전 ${d.valid}/${d.expected}` : `<span class="warn-text">불완전 ${d.valid}/${d.expected}</span>`}</td></tr>`).join('')}</tbody>`;
    statHost.append(tbl);
    if (days.some((d) => !d.complete)) statHost.append(h('p', { class: 'muted small' }, '자료가 빠진 날은 최고·최저·평균이 실제와 다를 수 있으니 다른 날과 같은 조건으로 비교하지 마세요. 그래프의 끊긴 부분도 확인하세요.'));
  }

  function refresh() {
    chart.render();
    monthChart.render();
    renderStats();
    const v = inq3Values(cd, { ...A(), view: controller.view });
    clearBtn.disabled = !v.points.length;
    selTable.innerHTML = '';
    if (!v.points.length) selTable.innerHTML = '<p class="muted">아직 선택한 지점이 없습니다. 특징이 잘 드러난다고 생각하는 자료점을 눌러 보세요.</p>';
    else {
      const tbl = h('table', { class: 'data-table' });
      tbl.innerHTML = `<thead><tr><th scope="col">기호</th><th scope="col">시각 (${escapeHtml(cd.tz.label)})</th><th scope="col">조위</th><th scope="col">품질</th><th scope="col"><span class="sr-only">작업</span></th></tr></thead>`;
      const tbody = h('tbody');
      for (const p of v.points) {
        const tr = h('tr');
        tr.innerHTML = `<th scope="row"><span class="mark-badge">${escapeHtml(p.label)}</span></th><td>${escapeHtml(fmtDateTime(p.t, cd.tz))}</td><td class="num">${escapeHtml(fmtValue(p.v, 'cm'))}</td><td>${escapeHtml(QUALITY[p.q] || '—')}</td>`;
        const td = h('td', { class: 'actions' });
        td.append(h('button', { type: 'button', class: 'btn btn-ghost btn-xs', onclick: () => {
          store.update((s) => { s.analysis.inq3.points = s.analysis.inq3.points.filter((x) => x.label !== p.label); }, { topic: 'analysis' });
          refresh();
        } }, '해제'));
        tr.append(td);
        tbody.append(tr);
      }
      tbl.append(tbody);
      selTable.append(tbl);
    }
    diffHost.innerHTML = '';
    if (v.points.length < 2) { diffHost.innerHTML = '<p class="muted">두 지점 이상 선택하면 시간 차이와 높이 차이(뒤 지점 − 앞 지점)가 계산됩니다.</p>'; return; }
    const tbl = h('table', { class: 'data-table' });
    tbl.innerHTML = `<thead><tr><th scope="col">구간</th><th scope="col">시간 차이</th><th scope="col">높이 차이 (뒤 − 앞)</th></tr></thead><tbody>${v.diffs.map((d) => `<tr${d.custom ? ' class="custom"' : ''}><th scope="row">${escapeHtml(d.from)} → ${escapeHtml(d.to)}</th><td class="num">${escapeHtml(fmtDuration(d.dtMs))} <span class="muted">(${escapeHtml(hoursDecimal(d.dtMs))}시간)</span></td><td class="num">${escapeHtml(fmtSignedValue(d.dv, 'cm'))}</td></tr>`).join('')}</tbody>`;
    diffHost.append(tbl);
    const opts = v.points.map((p) => `<option value="${escapeHtml(p.label)}">${escapeHtml(p.label)}</option>`).join('');
    const pair = effectivePair(A().pair, v.points);
    const row = h('div', { class: 'pair-row' });
    row.innerHTML = `<label>다른 두 지점 비교: <select class="sel-a" aria-label="앞 지점">${opts}</select></label> → <select class="sel-b" aria-label="뒤 지점">${opts}</select>`;
    const sa = row.querySelector('.sel-a'), sb = row.querySelector('.sel-b');
    sa.value = pair[0]; sb.value = pair[1];
    const onPair = () => { store.update((s) => { s.analysis.inq3.pair = [sa.value, sb.value]; }, { topic: 'analysis' }); refresh(); };
    sa.addEventListener('change', onPair); sb.addEventListener('change', onPair);
    diffHost.append(row);
  }

  controller.subscribe((k) => { if (k === 'view') { monthChart.render(); renderStats(); } });
  refresh();
  return { destroy() { chart.destroy(); monthChart.destroy(); } };
}

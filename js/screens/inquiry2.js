// 탐구 2 — 한 달의 규칙 찾기
import { h, toast } from '../util/dom.js';
import { escapeHtml, fmtNum, fmtValue } from '../util/format.js';
import { fmtDateTime, fmtDateKo, fmtTime, DAY } from '../util/time.js';
import { INQUIRIES } from '../content/questions.js';
import { ViewController, ChartView, createToolbar, tipRow } from '../chart/interactive.js';
import { inq2MonthSpec, inq2DailySpec, inq2DetailSpec, inq2Days, inq2DetailView } from '../chart/specs.js';
import { nearestValid, stepValid, dataDomain } from '../analysis/series.js';
import { inq2Values, effectivePair } from '../state/evidence.js';
import { inquiryHeader, createQuestionPanel, addEvidenceBar, nextLetter, unavailableText } from './common.js';

const MAX_DAYS = 8;

export function render(app, container) {
  const { cd, store } = app;
  const def = INQUIRIES[1];
  const A = () => store.state.analysis.inq2;
  const days = inq2Days(cd);
  const dayAt = (t) => days.find((d) => t >= d.start && t < d.end) || null;
  const obs = cd.observed;

  container.append(inquiryHeader(def));
  const ws = h('div', { class: 'workspace' });
  const left = h('section', { class: 'analysis', 'aria-label': '그래프와 분석 도구' });
  ws.append(left);
  container.append(ws);

  // ── 한 달 보기 컨트롤러(고정) ──
  const monthCtl = new ViewController({ domain: cd.ranges.inq2, initial: cd.ranges.inq2, minSpan: DAY });

  // ── 달의 위상 토글 ──
  const moonAvail = cd.availability.moonPhases;
  const moonBox = h('div', { class: 'moon-box' });
  const moonToggle = h('input', { type: 'checkbox', id: 'moon-toggle', role: 'switch', disabled: !moonAvail });
  moonToggle.checked = !!A().showMoon && moonAvail;
  moonToggle.addEventListener('change', () => {
    store.update((s) => { s.analysis.inq2.showMoon = moonToggle.checked; }, { topic: 'analysis' });
    refreshAll();
  });
  moonBox.append(h('label', { class: 'switch', for: 'moon-toggle' }, moonToggle, h('span', { class: 'switch-ui', 'aria-hidden': 'true' }), h('span', {}, '달의 위상 표시')));
  const moonInfo = h('div', { class: 'moon-info' });
  moonBox.append(moonInfo);

  // ── 1. 한 달 관측 조위 ──
  const monthCard = h('div', { class: 'card chart-card' });
  monthCard.append(h('div', { class: 'card-head' },
    h('h2', {}, `한 달 관측 조위 — ${cd.station.name}`),
    h('p', { class: 'data-line' }, `관측 간격 ${obs.intervalMs / 3600e3}시간 · 단위 cm · 기준면: ${obs.datumLabel} · 그래프를 누르면 그 날짜를 아래에서 확대해 봅니다.`)));
  monthCard.append(moonBox);
  const monthEl = h('div', { class: 'chart-host' });
  monthCard.append(monthEl);
  left.append(monthCard);

  // ── 2. 일별 변동 폭 ──
  const dailyCard = h('div', { class: 'card chart-card' });
  dailyCard.append(h('div', { class: 'card-head' }, h('h2', {}, '일별 해수면 변동 폭')));
  dailyCard.append(h('div', { class: 'definition' },
    h('p', {}, h('b', {}, '일별 해수면 변동 폭'), ` = 해당 날짜(00:00~24:00, ${cd.tz.label})의 관측 최고값 − 관측 최저값`),
    h('p', { class: 'small' }, '인접한 만조와 간조 한 쌍의 높이 차이(조차)와는 다른 값입니다. 날짜 경계에 걸친 만조·간조나 하루 두 번 만조의 높이 차이(일조부등)에 영향을 받을 수 있으니 앞뒤 며칠의 양상을 함께 보세요. 자료가 빠진 날은 점선 막대(!)로 표시하며, 완전한 날과 같은 조건으로 비교하지 않습니다.')));
  const dailyEl = h('div', { class: 'chart-host' });
  dailyCard.append(dailyEl);
  dailyCard.append(h('p', { class: 'chart-help' }, '막대를 누르면 그 날짜가 A, B, C … 순서로 선택되고 아래에서 확대됩니다. ', h('span', { class: 'kbd-help' }, '키보드: ←/→로 날짜 이동, Enter로 선택')));
  left.append(dailyCard);

  // ── 3. 확대 ──
  const detailCtl = new ViewController({
    domain: dataDomain(obs.points),
    initial: inq2DetailView(cd, { ...A(), detailView: null }),
    minSpan: 12 * 3600e3,
    onChange: (v) => store.update((s) => { s.analysis.inq2.detailView = v; }, { topic: 'analysis' }),
  });
  if (A().detailView) detailCtl.set(A().detailView[0], A().detailView[1], true);
  else detailCtl.set(detailCtl.initial[0], detailCtl.initial[1], true);
  const detailCard = h('div', { class: 'card chart-card' });
  const ctxSel = h('select', { id: 'ctx-days', 'aria-label': '앞뒤로 함께 볼 날 수' });
  ctxSel.innerHTML = [1, 2, 3].map((n) => `<option value="${n}">앞뒤 ${n}일</option>`).join('');
  ctxSel.value = String(A().contextDays || 2);
  ctxSel.addEventListener('change', () => {
    store.update((s) => { s.analysis.inq2.contextDays = Number(ctxSel.value); }, { topic: 'analysis' });
    recenter();
  });
  detailCard.append(h('div', { class: 'card-head' }, h('h2', {}, '선택 구간 확대'), h('p', { class: 'data-line' }, '점선 세로선은 날짜 경계(00:00)입니다. ▲·▼는 그날 변동 폭 계산에 쓰인 관측 최고값·최저값입니다.')));
  detailCard.append(createToolbar(detailCtl, { label: '확대 그래프', extra: '<label class="tool-inline">함께 보기 </label>' }));
  detailCard.querySelector('.tool-inline').append(ctxSel);
  const detailEl = h('div', { class: 'chart-host' });
  detailCard.append(detailEl);
  const dayBox = h('div', { class: 'day-box', 'aria-live': 'polite' });
  detailCard.append(dayBox);
  left.append(detailCard);

  // ── 4. 선택 날짜 ──
  const selCard = h('div', { class: 'card' });
  const clearBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => {
    store.update((s) => { s.analysis.inq2.selectedDays = []; s.analysis.inq2.pair = null; }, { topic: 'analysis' });
    refreshAll();
  } }, '선택 모두 해제');
  selCard.append(h('div', { class: 'card-head row' }, h('h2', {}, '선택한 날짜'), clearBtn));
  const selHost = h('div', { class: 'table-host', id: 'inq2-days' });
  const intHost = h('div', { class: 'table-host', id: 'inq2-intervals' });
  selCard.append(selHost, h('h3', { class: 'sub-h' }, '선택 날짜 사이의 간격'), intHost);
  left.append(selCard);
  left.append(addEvidenceBar({ onAdd: () => { app.addEvidence(2, { ...A(), detailView: detailCtl.view }); panel.renderEvidence(); } }));

  const panel = createQuestionPanel({
    app, def, inquiryNo: 2,
    getAnalysis: () => ({ ...A(), detailView: detailCtl.view }),
    applyState: (st) => {
      store.update((s) => { s.analysis.inq2 = { ...s.analysis.inq2, ...st }; }, { topic: 'analysis' });
      moonToggle.checked = !!st.showMoon && moonAvail;
      ctxSel.value = String(st.contextDays || 2);
      if (st.detailView) detailCtl.set(st.detailView[0], st.detailView[1], true);
      refreshAll();
      toast('근거의 분석 상태를 그래프에 다시 열었습니다. 근거 자체는 바뀌지 않습니다.');
    },
  });
  ws.append(panel.el);

  // ── 그래프 ──
  const dayTip = (d) => {
    if (!d) return '';
    const sel = A().selectedDays.find((s) => s.day === d.day);
    return `<div class="tip-title">${escapeHtml(fmtDateKo(d.start, cd.tz))}</div>${tipRow('변동 폭', d.range == null ? '자료 없음' : `${fmtNum(d.range)} cm`)}${tipRow('자료', d.complete ? `완전 ${d.valid}/${d.expected}` : `불완전 ${d.valid}/${d.expected}`)}${sel ? tipRow('선택', sel.label) : '<div class="tip-hint">누르면 선택</div>'}`;
  };
  const monthChart = new ChartView({
    el: monthEl, controller: monthCtl, height: 270, ariaLabel: '한 달 관측 조위 그래프',
    build: (ctx) => inq2MonthSpec({ ...ctx, cd }, A(), detailCtl.view),
    pick: (t) => { const d = dayAt(t); return d ? { t: d.start + DAY / 2, v: null, day: d.day } : null; },
    step: (tg, dir) => { const i = days.findIndex((d) => d.day === tg.day); const d = days[i + dir]; return d ? { t: d.start + DAY / 2, v: null, day: d.day } : null; },
    describe: (tg) => dayTip(days.find((d) => d.day === tg.day)),
    onSelect: (tg) => focusDay(tg.day),
  });
  const dailyChart = new ChartView({
    el: dailyEl, controller: monthCtl, height: 270, ariaLabel: '일별 해수면 변동 폭 막대그래프',
    build: (ctx) => inq2DailySpec({ ...ctx, cd }, A()),
    pick: (t) => { const d = dayAt(t); return d ? { t: d.start + DAY / 2, v: d.range, day: d.day } : null; },
    step: (tg, dir) => { const i = days.findIndex((d) => d.day === tg.day); const d = days[i + dir]; return d ? { t: d.start + DAY / 2, v: d.range, day: d.day } : null; },
    describe: (tg) => dayTip(days.find((d) => d.day === tg.day)),
    onSelect: (tg) => selectDay(tg.day),
  });
  monthChart.hoverValue = () => null;
  dailyChart.hoverValue = () => null;
  const detailChart = new ChartView({
    el: detailEl, controller: detailCtl, height: 360, ariaLabel: '선택 구간 확대 그래프',
    build: (ctx) => inq2DetailSpec({ ...ctx, cd }, A(), detailCtl.view),
    pick: (t) => { const p = nearestValid(obs.points, t, { t0: detailCtl.view[0], t1: detailCtl.view[1] }); return p ? { t: p.t, v: p.v, q: p.q } : null; },
    step: (tg, dir) => { const p = stepValid(obs.points, tg.t, dir); return p ? { t: p.t, v: p.v, q: p.q } : null; },
    describe: (tg) => `<div class="tip-title">${escapeHtml(fmtDateTime(tg.t, cd.tz))}</div>${tipRow('조위', fmtValue(tg.v, 'cm'))}<div class="tip-hint">누르면 이 날짜를 살펴봄</div>`,
    onSelect: (tg) => { const d = dayAt(tg.t); if (d) focusDay(d.day, { recenter: false }); },
  });
  detailCtl.subscribe((k) => { if (k === 'view') monthChart.render(); });

  function focusDay(day, { recenter: rc = true } = {}) {
    store.update((s) => { s.analysis.inq2.focusDay = day; }, { topic: 'analysis' });
    if (rc) recenter(); else refreshAll();
  }

  function recenter() {
    const v = inq2DetailView(cd, { ...A(), detailView: null });
    detailCtl.initial = v;
    detailCtl.set(v[0], v[1]);
    refreshAll();
  }

  function selectDay(day) {
    const sel = A().selectedDays;
    if (!sel.some((s) => s.day === day)) {
      if (sel.length >= MAX_DAYS) toast(`날짜는 최대 ${MAX_DAYS}개까지 선택할 수 있습니다.`);
      else {
        const label = nextLetter(sel.map((s) => s.label));
        store.update((s) => {
          s.analysis.inq2.selectedDays.push({ label, day });
          s.analysis.inq2.selectedDays.sort((a, b) => a.label.localeCompare(b.label));
        }, { topic: 'analysis' });
        const d = days.find((x) => x.day === day);
        if (d && !d.complete) toast('이 날은 자료가 빠진 날입니다. 변동 폭을 다른 날과 같은 조건으로 비교할 수 없습니다.', 'warn');
      }
    }
    focusDay(day);
  }

  function renderMoonInfo() {
    moonInfo.innerHTML = '';
    if (!moonAvail) {
      moonInfo.append(h('p', { class: 'notice notice-warn' }, unavailableText(cd, { needs: ['moonPhases'] })));
      return;
    }
    if (!A().showMoon) {
      moonInfo.append(h('p', { class: 'muted small' }, '달의 위상은 숨겨져 있습니다. 변동 폭이 큰 시기와 작은 시기를 먼저 찾은 뒤 켜서 비교해 보세요.'));
      return;
    }
    const [t0, t1] = cd.ranges.inq2;
    const list = cd.moon.phases.filter((p) => p.t >= t0 - 3 * DAY && p.t <= t1 + 3 * DAY);
    moonInfo.append(h('p', { class: 'small moon-list' }, ...list.map((p) => h('span', { class: 'moon-item' }, `${p.label} ${fmtDateTime(p.t, cd.tz, { year: false })}${p.lunar ? ` (음력 ${p.lunar})` : ''}`))));
    moonInfo.append(h('p', { class: 'muted small' }, `출처: ${cd.moon.meta.provider || '사례 설정 자료'}. 음력 날짜: ${list.some((p) => p.lunar) ? '자료 제공' : '자료 미제공'}`));
  }

  function renderDayBox() {
    dayBox.innerHTML = '';
    const d = days.find((x) => x.day === A().focusDay);
    if (!d) {
      dayBox.innerHTML = '<p class="muted">막대나 그래프를 눌러 날짜를 고르면, 그날의 관측 최고값·최저값과 시각이 여기에 표시됩니다.</p>';
      return;
    }
    const sel = A().selectedDays.find((s) => s.day === d.day);
    const head = h('div', { class: 'day-head' },
      h('h3', {}, `${fmtDateKo(d.start, cd.tz)}${sel ? ` (선택 ${sel.label})` : ''}`),
      h('span', { class: `badge ${d.complete ? 'badge-ok' : 'badge-warn'}` }, d.complete ? `완전한 자료 ${d.valid}/${d.expected}` : `불완전 ${d.valid}/${d.expected} — 비교 주의`));
    dayBox.append(head);
    const dl = h('dl', { class: 'day-stats' });
    dl.innerHTML = `
      <div><dt>관측 최고값 ▲</dt><dd>${d.max ? `${escapeHtml(fmtNum(d.max.v))} cm <span class="muted">(${escapeHtml(fmtTime(d.max.t, cd.tz))})</span>` : '자료 없음'}</dd></div>
      <div><dt>관측 최저값 ▼</dt><dd>${d.min ? `${escapeHtml(fmtNum(d.min.v))} cm <span class="muted">(${escapeHtml(fmtTime(d.min.t, cd.tz))})</span>` : '자료 없음'}</dd></div>
      <div><dt>일별 변동 폭</dt><dd><b>${d.range == null ? '자료 없음' : `${escapeHtml(fmtNum(d.range))} cm`}</b> <span class="muted">= 최고값 − 최저값</span></dd></div>`;
    dayBox.append(dl);
    // 앞뒤 며칠
    const i = days.indexOf(d);
    const k = A().contextDays || 2;
    const around = days.slice(Math.max(0, i - k), i + k + 1);
    const tbl = h('table', { class: 'data-table compact around' });
    tbl.innerHTML = `<caption>앞뒤 ${k}일의 일별 변동 폭</caption><thead><tr><th scope="col">날짜</th>${around.map((x) => `<th scope="col"${x === d ? ' class="cur"' : ''}>${escapeHtml(fmtDateKo(x.start, cd.tz, { weekday: false }))}</th>`).join('')}</tr></thead>
      <tbody><tr><th scope="row">변동 폭</th>${around.map((x) => `<td class="num${x === d ? ' cur' : ''}">${x.range == null ? '없음' : `${escapeHtml(fmtNum(x.range))} cm`}${x.complete ? '' : ' <span class="warn-text" title="자료가 빠진 날">!</span>'}</td>`).join('')}</tr></tbody>`;
    dayBox.append(tbl);
    const btns = h('div', { class: 'day-actions' });
    if (!sel) btns.append(h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => selectDay(d.day) }, '이 날짜 선택하기'));
    dayBox.append(btns);
    if (A().showMoon && cd.moon) {
      const near = cd.moon.phases.reduce((b, p) => (!b || Math.abs(p.t - (d.start + DAY / 2)) < Math.abs(b.t - (d.start + DAY / 2)) ? p : b), null);
      if (near) {
        const diffDays = (near.t - (d.start + DAY / 2)) / DAY;
        dayBox.append(h('p', { class: 'small' }, `가장 가까운 달의 위상: ${near.label} ${fmtDateTime(near.t, cd.tz, { year: false })} (이 날짜 정오 기준 ${Math.abs(diffDays).toFixed(1)}일 ${diffDays >= 0 ? '뒤' : '앞'})`));
      }
    }
  }

  function renderSelected() {
    const v = inq2Values(cd, A());
    clearBtn.disabled = !v.days.length;
    selHost.innerHTML = '';
    if (!v.days.length) {
      selHost.innerHTML = '<p class="muted">아직 선택한 날짜가 없습니다. 일별 변동 폭 막대를 눌러 선택하세요.</p>';
    } else {
      const tbl = h('table', { class: 'data-table' });
      tbl.innerHTML = `<thead><tr><th scope="col">기호</th><th scope="col">날짜</th><th scope="col">변동 폭</th><th scope="col">관측 최고값 (시각)</th><th scope="col">관측 최저값 (시각)</th><th scope="col">자료</th><th scope="col"><span class="sr-only">작업</span></th></tr></thead>`;
      const tb = h('tbody');
      for (const d of v.days) {
        const tr = h('tr', { class: d.day === A().focusDay ? 'focus' : '' });
        tr.innerHTML = `<th scope="row"><span class="mark-badge">${escapeHtml(d.label)}</span></th>
          <td>${escapeHtml(d.start != null ? fmtDateKo(d.start, cd.tz) : d.day)}</td>
          <td class="num"><b>${d.range == null ? '자료 없음' : `${escapeHtml(fmtNum(d.range))} cm`}</b></td>
          <td class="num">${d.max ? `${escapeHtml(fmtNum(d.max.v))} cm (${escapeHtml(fmtTime(d.max.t, cd.tz))})` : '—'}</td>
          <td class="num">${d.min ? `${escapeHtml(fmtNum(d.min.v))} cm (${escapeHtml(fmtTime(d.min.t, cd.tz))})` : '—'}</td>
          <td>${d.complete ? '완전' : '<span class="warn-text">불완전</span>'} ${d.valid}/${d.expected}</td>`;
        const td = h('td', { class: 'actions' });
        td.append(
          h('button', { type: 'button', class: 'btn btn-ghost btn-xs', onclick: () => focusDay(d.day) }, '보기'),
          h('button', { type: 'button', class: 'btn btn-ghost btn-xs', onclick: () => {
            store.update((s) => { s.analysis.inq2.selectedDays = s.analysis.inq2.selectedDays.filter((x) => x.day !== d.day); }, { topic: 'analysis' });
            refreshAll();
          } }, '해제'),
        );
        tr.append(td);
        tb.append(tr);
      }
      tbl.append(tb);
      selHost.append(tbl);
    }
    intHost.innerHTML = '';
    if (v.days.length < 2) {
      intHost.innerHTML = '<p class="muted">두 날짜 이상 선택하면 날짜 사이의 간격(일)이 계산됩니다.</p>';
    } else {
      const tbl = h('table', { class: 'data-table' });
      tbl.innerHTML = `<thead><tr><th scope="col">구간</th><th scope="col">날짜 간격</th></tr></thead><tbody>${v.intervals.map((d) => `<tr${d.custom ? ' class="custom"' : ''}><th scope="row">${escapeHtml(d.from)} → ${escapeHtml(d.to)}</th><td class="num">${d.days}일</td></tr>`).join('')}</tbody>`;
      intHost.append(tbl);
      const opts = v.days.map((p) => `<option value="${escapeHtml(p.label)}">${escapeHtml(p.label)}</option>`).join('');
      const pair = effectivePair(A().pair, v.days);
      const row = h('div', { class: 'pair-row' });
      row.innerHTML = `<label>다른 두 날짜 비교: <select class="sel-a" aria-label="앞 날짜">${opts}</select></label> → <select class="sel-b" aria-label="뒤 날짜">${opts}</select>`;
      const sa = row.querySelector('.sel-a'), sb = row.querySelector('.sel-b');
      sa.value = pair[0]; sb.value = pair[1];
      const onPair = () => { store.update((s) => { s.analysis.inq2.pair = [sa.value, sb.value]; }, { topic: 'analysis' }); renderSelected(); };
      sa.addEventListener('change', onPair); sb.addEventListener('change', onPair);
      intHost.append(row);
    }
  }

  function refreshAll() {
    monthChart.render();
    dailyChart.render();
    detailChart.render();
    renderMoonInfo();
    renderDayBox();
    renderSelected();
  }

  refreshAll();
  return { destroy() { monthChart.destroy(); dailyChart.destroy(); detailChart.destroy(); } };
}

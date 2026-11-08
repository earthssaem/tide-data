// 탐구 3 — 태풍의 영향 찾기
import { h, toast } from '../util/dom.js';
import { escapeHtml, fmtValue, fmtSignedValue, fmtWindDir, fmtNum } from '../util/format.js';
import { fmtDateTime, fmtRange, DAY } from '../util/time.js';
import { INQUIRIES } from '../content/questions.js';
import { ViewController, ChartView, createToolbar, tipRow } from '../chart/interactive.js';
import {
  inq3TideSpec, inq3ResidualSpec, inq3WeatherSpec, WEATHER_KINDS, weatherKinds, inq3Panels, weatherLabel, fmtWeather, obsAt, predAt, residualAt, weatherAt,
} from '../chart/specs.js';
import { lowerBound, dataDomain } from '../analysis/series.js';
import { haversineKm, fmtLatLon } from '../analysis/geo.js';
import { inq3Values } from '../state/evidence.js';
import { inquiryHeader, createQuestionPanel, addEvidenceBar, nextLetter, unavailableText } from './common.js';

const MAX_MARKS = 8;

function nearestAny(points, t, t0, t1) {
  const i = lowerBound(points, t);
  const cand = [points[i - 1], points[i]].filter((p) => p && p.t >= t0 && p.t <= t1);
  if (!cand.length) return null;
  return cand.reduce((a, b) => (Math.abs(a.t - t) <= Math.abs(b.t - t) ? a : b));
}

export function render(app, container) {
  const { cd, store } = app;
  const def = INQUIRIES[2];
  const A = () => store.state.analysis.inq3;
  const obs = cd.observed;

  container.append(inquiryHeader(def));
  const ws = h('div', { class: 'workspace' });
  const left = h('section', { class: 'analysis', 'aria-label': '그래프와 분석 도구' });
  ws.append(left);
  container.append(ws);

  // ── 사례 정보 ──
  const info = h('div', { class: 'card info-card' });
  const ty = cd.typhoon;
  const wx = cd.weather;
  const [r0, r1] = cd.ranges.inq3;
  info.innerHTML = `
    <div class="info-grid">
      <div><h2 class="h-sm">태풍 사례</h2><p>${ty ? `<b>${escapeHtml(ty.name)}</b> (${escapeHtml(String(ty.year))}년)${ty.note ? `<br><span class="muted small">${escapeHtml(ty.note)}</span>` : ''}` : '태풍 정보 미제공'}</p></div>
      <div><h2 class="h-sm">분석 구간(교사 설정)</h2><p>${escapeHtml(fmtRange(r0, r1, cd.tz))}</p>
        ${cd.keyTimes.length ? `<ul class="key-times">${cd.keyTimes.map((k) => `<li><span class="key-swatch" aria-hidden="true"></span>${escapeHtml(k.label)}: ${escapeHtml(fmtDateTime(k.t, cd.tz))}</li>`).join('')}</ul>` : ''}</div>
      <div><h2 class="h-sm">관측 위치</h2>
        <p>조위: ${escapeHtml(cd.station.name)} <span class="muted small">(${escapeHtml(fmtLatLon(cd.station.lat, cd.station.lon))})</span></p>
        <p>기상: ${wx ? `${escapeHtml(wx.station?.name || '—')} <span class="muted small">(${escapeHtml(fmtLatLon(wx.station?.lat, wx.station?.lon))})</span>` : '자료 미제공'}</p>
        ${cd.weatherDistanceKm != null ? (cd.weatherDistanceKm < 0.1 ? '<p class="notice notice-info small">기상 자료는 조위 관측소와 같은 지점에서 관측되었습니다.</p>' : `<p class="notice notice-info small">기상 자료는 조위 관측소에서 약 <b>${cd.weatherDistanceKm.toFixed(1)} km</b> 떨어진 지점${wx?.station?.elevation_m != null ? `(해발 ${wx.station.elevation_m} m)` : ''}에서 관측되었습니다. 두 위치의 기압·바람이 같다고 단정할 수 없습니다.</p>`) : ''}
      </div>
    </div>`;
  if (ty && ty.track.length) {
    const det = h('details', { class: 'track' });
    det.innerHTML = `<summary>태풍 경로 자료 보기 (${ty.track.length}개 시각${ty.trackKind ? ` · ${escapeHtml(ty.trackKind)}` : ''})</summary>
      <p class="muted small">${escapeHtml(ty.trackNote || '태풍 중심의 위치입니다.')} 중심기압은 태풍 중심의 기압으로, 부산에서 관측한 기압이 아닙니다.</p>
      <div class="table-host"><table class="data-table compact"><thead><tr><th scope="col">시각</th><th scope="col">중심 위치</th><th scope="col">태풍 중심기압</th><th scope="col">중심 최대풍속</th><th scope="col">조위 관측소까지 거리</th></tr></thead>
      <tbody>${ty.track.map((p) => {
        const d = haversineKm(cd.station.lat, cd.station.lon, p.lat, p.lon);
        return `<tr><th scope="row">${escapeHtml(fmtDateTime(p.t, cd.tz))}</th><td>${escapeHtml(fmtLatLon(p.lat, p.lon))}</td><td class="num">${p.pressure != null ? `${fmtNum(p.pressure)} hPa` : '자료 없음'}</td><td class="num">${p.maxWind != null ? `${fmtNum(p.maxWind)} m/s` : '자료 없음'}</td><td class="num">${d != null ? `${d.toFixed(0)} km` : '—'}</td></tr>`;
      }).join('')}</tbody></table></div>
      <p class="muted small">출처: ${escapeHtml(ty.meta.provider || '사례 설정 자료')} (${escapeHtml(ty.meta.identifier || '')})</p>`;
    info.append(det);
  }
  left.append(info);

  // ── 공유 시간축 ──
  const d0 = dataDomain(obs.points);
  const domain = [Math.max(d0[0], r0 - 2 * DAY), Math.min(d0[1], r1 + 2 * DAY)];
  const controller = new ViewController({
    domain, initial: cd.ranges.inq3,
    onChange: (v) => store.update((s) => { s.analysis.inq3.view = v; }, { topic: 'analysis' }),
  });
  if (A().view) controller.set(A().view[0], A().view[1], true);

  const card = h('div', { class: 'card chart-card' });
  card.append(h('div', { class: 'card-head' },
    h('h2', {}, '같은 시간축 비교'),
    h('p', { class: 'data-line' }, `모든 그래프는 확대·이동이 함께 움직입니다. 그래프를 누르면 그 시각이 A, B, C … 로 표시되고 모든 그래프에 같은 시각선이 나타납니다.`)));
  card.append(createToolbar(controller, { label: '태풍 비교 그래프' }));
  const chartHosts = [h('div', { class: 'chart-host' }), h('div', { class: 'chart-host' })];
  const panelTitle = (t, sub) => h('div', { class: 'panel-title' }, h('h3', {}, t), sub ? h('span', { class: 'muted small' }, sub) : null);
  card.append(panelTitle('① 관측 조위와 천문조 예측 조위', `기준면: ${obs.datumLabel} · 단위 cm`), chartHosts[0]);
  if (!cd.availability.predicted) card.append(h('p', { class: 'notice notice-warn' }, '이 사례에는 천문조 예측 조위 자료가 제공되지 않았습니다. 예측값을 만들어 채우지 않습니다.'));
  card.append(panelTitle('② 조위 잔차', '잔차 = 같은 시각의 관측 조위 − 예측 조위. 잔차에는 태풍 외의 요인(관측 오차, 다른 기상 효과, 예측 오차 등)도 포함될 수 있습니다.'), chartHosts[1]);
  if (!cd.availability.residual) card.append(h('p', { class: 'notice notice-warn' }, unavailableText(cd, { needs: ['residual'] })));

  // ③ 기상 자료: 항목마다 별도 그래프(같은 시간축). 서로 다른 기압 종류는 다른 그래프로 둔다.
  const kindsAvail = weatherKinds(cd);
  const wxSel = h('div', { class: 'wx-select', role: 'group', 'aria-label': '표시할 기상 그래프 선택' });
  const syncChecks = () => {
    const sel = inq3Panels(cd, A());
    wxSel.querySelectorAll('input').forEach((inp) => { inp.checked = sel.includes(inp.value); });
  };
  for (const k of kindsAvail) {
    const id = `wx-${k}`;
    const inp = h('input', { type: 'checkbox', id, value: k });
    inp.addEventListener('change', () => {
      const cur = new Set(inq3Panels(cd, A()));
      if (inp.checked) cur.add(k); else cur.delete(k);
      const ordered = kindsAvail.filter((x) => cur.has(x));
      store.update((s) => { s.analysis.inq3.panels = ordered; }, { topic: 'analysis' });
      buildWeatherCharts();
    });
    wxSel.append(h('label', { class: 'wx-check', for: id }, inp, ` ${weatherLabel(cd, k)} (${WEATHER_KINDS[k].unit})`));
  }
  syncChecks();
  card.append(h('div', { class: 'panel-title' }, h('h3', {}, `③ 기상 자료${wx ? ` — ${wx.station?.name || ''}` : ''}`), kindsAvail.length ? wxSel : null));
  if (wx) {
    const notes = kindsAvail.map((k) => `${weatherLabel(cd, k)}: ${wx.fields[k].note || WEATHER_KINDS[k].desc}`).join(' · ');
    card.append(h('p', { class: 'muted small' }, `${notes}. 단위나 종류가 다른 자료는 한 축에 섞지 않고 각각 따로 그립니다. 태풍 중심기압은 이 그래프에 넣지 않습니다(부산의 관측 기압이 아님).`));
  }
  const wxHost = h('div', { class: 'wx-host' });
  card.append(wxHost);
  if (!cd.availability.weather) card.append(h('p', { class: 'notice notice-warn' }, unavailableText(cd, { needs: ['weather'] })));
  card.append(h('p', { class: 'notice notice-info small' }, '풍향은 바람이 불어오는 방향입니다. 예: 풍향 90°(동풍)는 동쪽에서 서쪽으로 부는 바람입니다.'));
  left.append(card);

  // ── 선택 시각 표 ──
  const tblCard = h('div', { class: 'card' });
  const clearBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => {
    store.update((s) => { s.analysis.inq3.marks = []; s.analysis.inq3.cursor = null; }, { topic: 'analysis' });
    refreshAll();
  } }, '선택 모두 해제');
  tblCard.append(h('div', { class: 'card-head row' }, h('h2', {}, '선택 시각의 값'), clearBtn));
  const tblHost = h('div', { class: 'table-host wide' });
  tblCard.append(tblHost);
  tblCard.append(h('p', { class: 'muted small' }, '“자료 없음”은 그 시각에 값이 없거나(결측) 그 시각의 관측 기록이 없다는 뜻입니다. 앱은 가까운 시각의 값을 대신 넣거나 보간하지 않습니다. 관측 조위의 최고값은 1시간 간격 관측값 중의 최고값입니다.'));
  left.append(tblCard);
  left.append(addEvidenceBar({ onAdd: () => { app.addEvidence(3, { ...A(), view: controller.view }); panel.renderEvidence(); } }));

  const panel = createQuestionPanel({
    app, def, inquiryNo: 3,
    getAnalysis: () => ({ ...A(), view: controller.view }),
    applyState: (st) => {
      store.update((s) => { s.analysis.inq3 = { ...s.analysis.inq3, ...st }; }, { topic: 'analysis' });
      if (!Array.isArray(st.panels) && st.bottom) store.update((s) => { s.analysis.inq3.panels = [st.bottom]; }, { topic: 'analysis' });
      syncChecks();
      buildWeatherCharts();
      if (st.view) controller.set(st.view[0], st.view[1], true);
      refreshAll();
      toast('근거의 분석 상태를 그래프에 다시 열었습니다. 근거 자체는 바뀌지 않습니다.');
    },
  });
  ws.append(panel.el);

  // ── 그래프 ──
  const fs = 13.5;
  const padFor = (measure) => Math.max(measure('0000', fs - 1.5), measure('북 360°', fs - 1.5)) + fs + 18;
  const pick = (t) => {
    const p = nearestAny(obs.points, t, controller.view[0], controller.view[1]);
    return p ? { t: p.t } : null;
  };
  const step = (tg, dir) => {
    const i = lowerBound(obs.points, tg.t) + (dir > 0 ? 1 : -1);
    const p = obs.points[i];
    return p ? { t: p.t } : null;
  };
  const describe = (tg) => {
    const w = weatherAt(cd, tg.t);
    const res = residualAt(cd, tg.t);
    return `<div class="tip-title">${escapeHtml(fmtDateTime(tg.t, cd.tz))}</div>
      ${tipRow('관측 조위', fmtValue(obsAt(cd, tg.t), 'cm'))}
      ${tipRow('예측 조위', cd.predicted ? fmtValue(predAt(cd, tg.t), 'cm') : '자료 미제공')}
      ${tipRow('잔차', cd.residual?.ok ? fmtSignedValue(res, 'cm') : '계산 불가')}
      ${cd.weather ? kindsAvail.map((k) => tipRow(weatherLabel(cd, k), fmtWeather(k, w?.[k] ?? null))).join('') : tipRow('기상 자료', '자료 미제공')}
      <div class="tip-hint">누르면 이 시각을 표시</div>`;
  };
  const view = () => ({ ...A(), view: controller.view });
  const builders = [
    (ctx) => inq3TideSpec({ ...ctx, cd, padLeft: padFor(ctx.measure), hideXTitle: true }, view()),
    (ctx) => inq3ResidualSpec({ ...ctx, cd, padLeft: padFor(ctx.measure), hideXTitle: true }, view()),
  ];
  const hoverVals = [
    (t) => ({ v: obsAt(cd, t) }),
    (t) => ({ v: residualAt(cd, t) }),
  ];
  const labels = ['관측·예측 조위 그래프', '조위 잔차 그래프'];
  const heights = [320, 230];
  const charts = chartHosts.map((el, i) => {
    const c = new ChartView({
      el, controller, height: heights[i], fontSize: fs, ariaLabel: labels[i],
      build: builders[i], pick, step, describe, onSelect: (tg) => mark(tg.t),
    });
    c.hoverValue = hoverVals[i];
    return c;
  });
  let wxCharts = [];
  function buildWeatherCharts() {
    wxCharts.forEach((c) => c.destroy());
    wxHost.innerHTML = '';
    let kinds = inq3Panels(cd, A());
    if (!cd.weather) kinds = ['pressure']; // '기상 자료 미제공' 그래프 하나
    if (cd.weather && !kinds.length) {
      wxHost.append(h('p', { class: 'muted small' }, '표시할 기상 그래프를 위에서 고르세요.'));
      wxCharts = [];
      return;
    }
    wxCharts = kinds.map((k, i) => {
      const el = h('div', { class: 'chart-host' });
      wxHost.append(el);
      const c = new ChartView({
        el, controller, height: 210, fontSize: fs, ariaLabel: `${cd.weather ? weatherLabel(cd, k) : '기상 자료'} 그래프`,
        build: (ctx) => inq3WeatherSpec({ ...ctx, cd, padLeft: padFor(ctx.measure), hideXTitle: i < kinds.length - 1 }, view(), k),
        pick, step, describe, onSelect: (tg) => mark(tg.t),
      });
      c.hoverValue = (t) => ({ v: weatherAt(cd, t)?.[k] ?? null });
      c.render();
      return c;
    });
  }
  buildWeatherCharts();

  function mark(t) {
    const marks = A().marks;
    const ex = marks.find((m) => m.t === t);
    if (ex) {
      store.update((s) => { s.analysis.inq3.cursor = t; }, { topic: 'analysis' });
      toast(`이미 ${ex.label}로 표시된 시각입니다.`);
    } else if (marks.length >= MAX_MARKS) {
      toast(`시각은 최대 ${MAX_MARKS}개까지 표시할 수 있습니다.`);
      store.update((s) => { s.analysis.inq3.cursor = t; }, { topic: 'analysis' });
    } else {
      const label = nextLetter(marks.map((m) => m.label));
      store.update((s) => {
        s.analysis.inq3.marks.push({ label, t });
        s.analysis.inq3.marks.sort((a, b) => a.label.localeCompare(b.label));
        s.analysis.inq3.cursor = t;
      }, { topic: 'analysis' });
    }
    refreshAll();
  }

  function renderTable() {
    const v = inq3Values(cd, A());
    clearBtn.disabled = !v.marks.length;
    tblHost.innerHTML = '';
    if (!v.marks.length) {
      tblHost.innerHTML = '<p class="muted">그래프에서 시각을 누르면 그 시각의 관측·예측 조위, 잔차, 기압, 풍속, 풍향이 이 표에 나타납니다.</p>';
      return;
    }
    const tbl = h('table', { class: 'data-table' });
    const wxHead = cd.weather ? kindsAvail.map((k) => `<th scope="col">${escapeHtml(weatherLabel(cd, k))}${k === 'windDir' ? '<br><span class="small">(불어오는 방향)</span>' : ''}</th>`).join('') : '<th scope="col">기상</th>';
    tbl.innerHTML = `<thead><tr><th scope="col">기호</th><th scope="col">시각 (${escapeHtml(cd.tz.label)})</th><th scope="col">관측 조위</th><th scope="col">예측 조위</th><th scope="col">잔차<br><span class="small">(관측 − 예측)</span></th>${wxHead}<th scope="col"><span class="sr-only">작업</span></th></tr></thead>`;
    const tb = h('tbody');
    for (const m of v.marks) {
      const tr = h('tr', { class: m.t === A().cursor ? 'focus' : '' });
      const wxCells = cd.weather ? kindsAvail.map((k) => `<td class="num">${escapeHtml(fmtWeather(k, m.weather?.[k] ?? null))}</td>`).join('') : '<td>자료 미제공</td>';
      tr.innerHTML = `<th scope="row"><span class="mark-badge">${escapeHtml(m.label)}</span></th>
        <td>${escapeHtml(fmtDateTime(m.t, cd.tz))}</td>
        <td class="num">${escapeHtml(fmtValue(m.obs, 'cm'))}</td>
        <td class="num">${escapeHtml(cd.predicted ? fmtValue(m.pred, 'cm') : '자료 미제공')}</td>
        <td class="num"><b>${escapeHtml(v.residualOk ? fmtSignedValue(m.res, 'cm') : '계산 불가')}</b></td>
        ${wxCells}`;
      const td = h('td', { class: 'actions' });
      td.append(h('button', { type: 'button', class: 'btn btn-ghost btn-xs', onclick: () => {
        store.update((s) => {
          s.analysis.inq3.marks = s.analysis.inq3.marks.filter((x) => x.label !== m.label);
          if (s.analysis.inq3.cursor === m.t) s.analysis.inq3.cursor = null;
        }, { topic: 'analysis' });
        refreshAll();
      } }, '해제'));
      tr.append(td);
      tb.append(tr);
    }
    tbl.append(tb);
    tblHost.append(tbl);
  }

  function refreshAll() {
    charts.forEach((c) => c.render());
    wxCharts.forEach((c) => c.render());
    renderTable();
  }

  refreshAll();
  return { destroy() { charts.forEach((c) => c.destroy()); wxCharts.forEach((c) => c.destroy()); } };
}

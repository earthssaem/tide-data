// 탐구별 그래프 설명(spec) 만들기
// 같은 함수를 화면(현재 분석 상태)과 근거·PDF(고정된 분석 상태)에 함께 사용한다.

import { MARK_SHAPES } from './layout.js';
import { pointAt } from '../analysis/series.js';
import { dailyRanges } from '../analysis/daily.js';
import { fmtRange, fmtDateTime, fmtDateKo, DAY } from '../util/time.js';

export const COLORS = {
  obs: '#1f3a68',
  pred: '#0f8b8d',
  residual: '#34465c',
  pressure: '#1f3a68',
  wind: '#0f8b8d',
  accent: '#d9480f',
  key: '#a14f00',
  moon: '#3b4652',
  band: '#0f8b8d',
  daily: '#7d9cc0',
  dailySel: '#1f3a68',
  maxmin: '#0b6e70',
};

const intervalLabel = (ms) => (ms >= 3600e3 ? `${ms / 3600e3}시간` : `${ms / 60000}분`);

function sampleTag(cd) {
  return cd.isSample ? ' · 기능 확인용 예시 데이터' : '';
}

export function obsAt(cd, t) {
  const p = pointAt(cd.observed.points, t);
  return p && p.v != null ? p.v : null;
}
export function obsPointAt(cd, t) { return pointAt(cd.observed.points, t); }
export function predAt(cd, t) {
  if (!cd.predicted) return null;
  const p = pointAt(cd.predicted.points, t);
  return p && p.v != null ? p.v : null;
}
export function residualAt(cd, t) {
  if (!cd.residual?.ok) return null;
  const p = pointAt(cd.residual.points, t);
  return p && p.v != null ? p.v : null;
}
export function weatherAt(cd, t) {
  if (!cd.weather) return null;
  return pointAt(cd.weather.points, t);
}

function moonLines(cd, show) {
  if (!show || !cd.moon) return [];
  return cd.moon.phases.map((p) => ({
    t: p.t, icon: p.phase, label: `${p.label} ${fmtDateTime(p.t, cd.tz, { year: false }).replace(/^0/, '').replace('-', '/')}`,
    color: COLORS.moon, dash: [2, 3], width: 1.1,
  }));
}

function moonLegend(cd, show) {
  if (!show || !cd.moon) return [];
  return [{ kind: 'moon', icon: 'full', label: '달의 위상(삭●·상현◑·망○·하현◐) 시각', color: COLORS.moon }];
}

function hasSuspect(cd, t0, t1) {
  return cd.observed.points.some((p) => p.q === 'suspect' && p.v != null && p.t >= t0 && p.t <= t1);
}

function base(ctx, view) {
  return {
    width: ctx.width,
    height: ctx.height,
    measure: ctx.measure,
    fontSize: ctx.fontSize || 12,
    x: { domain: view, tz: ctx.cd.tz, label: `날짜·시각 (${ctx.cd.tz.label})`, hideAxisTitle: ctx.hideXTitle },
    padLeft: ctx.padLeft,
  };
}

function obsSeries(cd, extra = {}) {
  return {
    kind: 'line', points: cd.observed.points, maxGapMs: cd.observed.intervalMs * 1.5,
    color: COLORS.obs, width: 1.8, dots: true, flagSuspect: true, ...extra,
  };
}

function obsLegend(cd, t0, t1, withDots = true) {
  const L = [{ kind: 'line', label: `관측 조위 (${intervalLabel(cd.observed.intervalMs)} 간격 관측값, 직선 연결)`, color: COLORS.obs, marker: withDots ? 'circle' : null }];
  if (hasSuspect(cd, t0, t1)) L.push({ kind: 'marker', marker: 'diamond', label: '품질 의심 자료', color: '#9a3412', fill: '#ffffff', stroke: '#9a3412' });
  return L;
}

// ───────────────────────── 탐구 1 ─────────────────────────
export function inq1Spec(ctx, a) {
  const { cd } = ctx;
  const view = a.view || cd.ranges.inq1;
  const marks = (a.points || []).map((p, i) => ({
    t: p.t, v: obsAt(cd, p.t), label: p.label, shape: MARK_SHAPES[i % MARK_SHAPES.length], color: COLORS.accent,
  }));
  const legend = obsLegend(cd, view[0], view[1]);
  if (marks.length) legend.push({ kind: 'marker', marker: 'circle', label: '선택 지점 (A, B, C … 기호와 모양으로 구분)', color: COLORS.accent });
  return {
    ...base(ctx, view),
    header: ctx.header ? {
      title: `관측 조위 — ${cd.station.name}`,
      subtitle: `${fmtRange(view[0], view[1], cd.tz)} · 높이 기준면: ${cd.observed.datumLabel}${sampleTag(cd)}`,
    } : null,
    legend,
    y: { label: '조위 (cm)' },
    series: [obsSeries(cd)],
    marks,
  };
}

// ───────────────────────── 탐구 2 ─────────────────────────
export function inq2Days(cd) {
  const [t0, t1] = cd.ranges.inq2;
  return dailyRanges(cd.observed.points, cd.tz, cd.observed.intervalMs, t0, t1);
}

export function inq2DetailView(cd, a) {
  if (a.detailView) return a.detailView;
  const days = inq2Days(cd);
  const focus = days.find((d) => d.day === a.focusDay);
  const ctxDays = a.contextDays ?? 2;
  if (focus) return [focus.start - ctxDays * DAY, focus.end + ctxDays * DAY];
  const [t0] = cd.ranges.inq2;
  return [t0, t0 + 5 * DAY];
}

export function inq2MonthSpec(ctx, a, detailView) {
  const { cd } = ctx;
  const view = cd.ranges.inq2;
  const days = inq2Days(cd);
  const bands = [];
  if (detailView) bands.push({ t0: detailView[0], t1: detailView[1], fill: COLORS.band, opacity: 0.1, stroke: COLORS.band, strokeWidth: 1, dash: [3, 2] });
  for (const s of a.selectedDays || []) {
    const d = days.find((x) => x.day === s.day);
    if (d) bands.push({ t0: d.start, t1: d.end, fill: COLORS.accent, opacity: 0.14 });
  }
  const legend = obsLegend(cd, view[0], view[1], false);
  if (detailView) legend.push({ kind: 'barHollow', label: '아래 확대 그래프의 범위', color: COLORS.band });
  legend.push(...moonLegend(cd, a.showMoon));
  return {
    ...base(ctx, view),
    x: { ...base(ctx, view).x, minTickSpacing: 40 },
    header: ctx.header ? {
      title: `한 달 관측 조위 — ${cd.station.name}`,
      subtitle: `${fmtRange(view[0], view[1], cd.tz)} · 기준면: ${cd.observed.datumLabel}${sampleTag(cd)}`,
    } : null,
    legend,
    y: { label: '조위 (cm)' },
    series: [obsSeries(cd, { dots: false, width: 1.2 })],
    bands,
    vlines: moonLines(cd, a.showMoon),
  };
}

export function inq2DailySpec(ctx, a) {
  const { cd } = ctx;
  const view = cd.ranges.inq2;
  const days = inq2Days(cd);
  const sel = new Map((a.selectedDays || []).map((s) => [s.day, s.label]));
  const bars = days.map((d) => ({
    t0: d.start, t1: d.end, v: d.range, hollow: !d.complete,
    selected: sel.has(d.day), label: sel.get(d.day) || null, focus: d.day === a.focusDay,
    color: sel.has(d.day) ? COLORS.dailySel : COLORS.daily,
  }));
  const legend = [{ kind: 'bar', label: '일별 해수면 변동 폭 = 그날 관측 최고값 − 관측 최저값', color: COLORS.daily }];
  if (days.some((d) => !d.complete)) legend.push({ kind: 'barHollow', label: '자료가 빠진 날(점선·!, 순위 비교 제외)' });
  legend.push(...moonLegend(cd, a.showMoon));
  return {
    ...base(ctx, view),
    x: { ...base(ctx, view).x, minTickSpacing: 40 },
    header: ctx.header ? {
      title: `일별 해수면 변동 폭 — ${cd.station.name}`,
      subtitle: `${fmtRange(view[0], view[1], cd.tz)} · 날짜 경계 00:00(${cd.tz.label}) · 인접 만조·간조의 조차와 다른 값${sampleTag(cd)}`,
    } : null,
    legend,
    y: { label: '변동 폭 (cm)', includeZero: true, floorZero: true, pad: 0.14 },
    series: [{ kind: 'bars', bars, color: COLORS.daily }],
    vlines: moonLines(cd, a.showMoon),
  };
}

export function inq2DetailSpec(ctx, a, view) {
  const { cd } = ctx;
  const days = inq2Days(cd);
  const marks = [];
  const shown = new Set();
  const addDay = (dayKey, letter) => {
    if (shown.has(dayKey)) return;
    const d = days.find((x) => x.day === dayKey);
    if (!d || !d.max) return;
    shown.add(dayKey);
    marks.push({ t: d.max.t, v: d.max.v, label: `${letter ? letter + ' ' : ''}최고`, shape: 'triangle', color: COLORS.maxmin, fill: COLORS.maxmin });
    marks.push({ t: d.min.t, v: d.min.v, label: `${letter ? letter + ' ' : ''}최저`, shape: 'triangleDown', color: COLORS.maxmin, fill: COLORS.maxmin, labelPos: 'below' });
  };
  const sel = new Map((a.selectedDays || []).map((s) => [s.day, s.label]));
  if (a.focusDay) addDay(a.focusDay, sel.get(a.focusDay));
  for (const s of a.selectedDays || []) addDay(s.day, s.label);
  const bands = [];
  for (const d of days) {
    if (d.day === a.focusDay) bands.push({ t0: d.start, t1: d.end, fill: COLORS.accent, opacity: 0.08 });
    else if (sel.has(d.day)) bands.push({ t0: d.start, t1: d.end, fill: COLORS.accent, opacity: 0.05 });
  }
  const dayLines = days.filter((d) => d.start > view[0] && d.start < view[1]).map((d) => ({
    t: d.start, color: '#8a94a1', dash: [1, 3], width: 1,
  }));
  const legend = obsLegend(cd, view[0], view[1]);
  if (marks.length) legend.push({ kind: 'marker', marker: 'triangle', label: '변동 폭 계산에 쓰인 그날의 관측 최고값(▲)·최저값(▼)', color: COLORS.maxmin });
  legend.push(...moonLegend(cd, a.showMoon));
  return {
    ...base(ctx, view),
    header: ctx.header ? {
      title: `선택 구간 확대 — ${cd.station.name}`,
      subtitle: `${fmtRange(view[0], view[1], cd.tz)} · 점선 세로선: 날짜 경계(00:00)${sampleTag(cd)}`,
    } : null,
    legend,
    y: { label: '조위 (cm)' },
    series: [obsSeries(cd)],
    marks,
    bands,
    vlines: [...dayLines, ...moonLines(cd, a.showMoon)],
  };
}

// ───────────────────────── 탐구 3 ─────────────────────────
function keyLines(cd) {
  return cd.keyTimes.map((k, i) => ({ t: k.t, label: k.label, color: COLORS.key, dash: [6, 3], width: 1.3, row: i % 2, bold: true }));
}

function inq3Marks(a, valueFn) {
  return (a.marks || []).map((m, i) => ({
    t: m.t, v: valueFn(m.t), label: m.label, shape: MARK_SHAPES[i % MARK_SHAPES.length], color: COLORS.accent, vline: true,
  }));
}

export function inq3TideSpec(ctx, a) {
  const { cd } = ctx;
  const view = a.view || cd.ranges.inq3;
  const series = [obsSeries(cd, { dots: true, dotMinSpacing: 7 })];
  const legend = [{ kind: 'line', label: '관측 조위 (실선·점)', color: COLORS.obs, marker: 'circle' }];
  if (cd.predicted) {
    series.push({ kind: 'line', points: cd.predicted.points, maxGapMs: cd.predicted.intervalMs * 1.5, color: COLORS.pred, width: 2, dash: [7, 4] });
    legend.push({ kind: 'line', label: '천문조 예측 조위 (파선)', color: COLORS.pred, dash: [7, 4], width: 2 });
  } else {
    legend.push({ kind: 'line', label: '예측 조위: 자료 미제공', color: '#b8c0ca', dash: [2, 3] });
  }
  if (cd.keyTimes.length) legend.push({ kind: 'vline', label: '태풍 관련 주요 시각(교사 설정)', color: COLORS.key, dash: [6, 3] });
  return {
    ...base(ctx, view),
    header: ctx.header ? {
      title: `관측 조위와 예측 조위 — ${cd.station.name}`,
      subtitle: `${fmtRange(view[0], view[1], cd.tz)} · 기준면: ${cd.observed.datumLabel}${cd.typhoon ? ` · ${cd.typhoon.name}` : ''}${sampleTag(cd)}`,
    } : null,
    legend,
    y: { label: '조위 (cm)' },
    series,
    vlines: keyLines(cd),
    marks: inq3Marks(a, (t) => obsAt(cd, t)),
    cursor: a.cursor != null ? { t: a.cursor } : null,
  };
}

export function inq3ResidualSpec(ctx, a) {
  const { cd } = ctx;
  const view = a.view || cd.ranges.inq3;
  const ok = cd.residual?.ok;
  return {
    ...base(ctx, view),
    header: ctx.header ? { title: '조위 잔차 (관측 − 예측)', subtitle: `${fmtRange(view[0], view[1], cd.tz)}${sampleTag(cd)}` } : null,
    legend: [
      { kind: 'line', label: '조위 잔차 = 같은 시각의 관측 조위 − 예측 조위', color: COLORS.residual, marker: 'circle' },
    ],
    y: { label: '잔차 (cm)', includeZero: true, zeroLine: true, zeroLabel: '0 (관측 = 예측)' },
    series: ok ? [{ kind: 'line', points: cd.residual.points, maxGapMs: cd.observed.intervalMs * 1.5, color: COLORS.residual, width: 1.6, dots: true, dotMinSpacing: 7 }] : [],
    vlines: keyLines(cd).map((v) => ({ ...v, label: '' })),
    marks: ok ? inq3Marks(a, (t) => residualAt(cd, t)) : [],
    cursor: a.cursor != null ? { t: a.cursor } : null,
    message: ok ? null : `잔차 계산 불가 — ${cd.residual?.problems?.[0] || '예측 조위 자료 없음'}`,
  };
}

export const BOTTOM_KINDS = {
  pressure: { label: '기압', unit: 'hPa', axis: '기압 (hPa)', desc: '해면기압. 1 hPa = 100 Pa' },
  windSpeed: { label: '풍속', unit: 'm/s', axis: '풍속 (m/s)', desc: '평균 풍속' },
  windDir: { label: '풍향', unit: '°', axis: '풍향 (°)', desc: '바람이 불어오는 방향. 북 0°, 동 90°, 남 180°, 서 270°' },
};

export function inq3BottomSpec(ctx, a) {
  const { cd } = ctx;
  const view = a.view || cd.ranges.inq3;
  const kind = a.bottom || 'pressure';
  const K = BOTTOM_KINDS[kind];
  const w = cd.weather;
  const s = {
    ...base(ctx, view),
    header: ctx.header ? {
      title: `${K.label} — ${w?.station?.name || '기상 관측 지점'}`,
      subtitle: `${fmtRange(view[0], view[1], cd.tz)}${cd.weatherDistanceKm != null ? ` · 조위 관측소에서 약 ${cd.weatherDistanceKm.toFixed(0)} km 떨어진 지점` : ''}${sampleTag(cd)}`,
    } : null,
    y: { label: K.axis },
    vlines: keyLines(cd).map((v) => ({ ...v, label: '' })),
    cursor: a.cursor != null ? { t: a.cursor } : null,
    series: [],
    legend: [],
  };
  if (!w || !w.fields[kind]) {
    s.message = '기상 자료 미제공';
    s.legend = [{ kind: 'line', label: `${K.label}: 자료 미제공`, color: '#b8c0ca', dash: [2, 3] }];
    return s;
  }
  const station = w.station?.name || '기상 관측 지점';
  if (kind === 'windDir') {
    s.y = {
      label: K.axis, domain: [0, 360],
      ticks: [
        { v: 0, label: '북 0°' }, { v: 90, label: '동 90°' }, { v: 180, label: '남 180°' }, { v: 270, label: '서 270°' }, { v: 360, label: '북 360°' },
      ],
    };
    s.series = [{ kind: 'dots', points: w.points, key: 'windDir', color: COLORS.wind, marker: 'circle', markerSize: 2.6 }];
    s.legend = [{ kind: 'marker', marker: 'circle', label: `풍향 (${station}, 바람이 불어오는 방향)`, color: COLORS.wind }];
  } else {
    const color = kind === 'pressure' ? COLORS.pressure : COLORS.wind;
    s.series = [{ kind: 'line', points: w.points, key: kind, maxGapMs: w.intervalMs * 1.5, color, width: 1.7, dots: true, dotMinSpacing: 7 }];
    s.legend = [{ kind: 'line', label: `${K.label} (${K.unit}, ${station})`, color, marker: 'circle' }];
    if (kind === 'windSpeed') s.y.floorZero = true;
  }
  s.marks = inq3Marks(a, (t) => weatherAt(cd, t)?.[kind] ?? null);
  return s;
}

/** 근거·PDF용 그림 구성: 패널 목록 */
export function figurePanels(cd, ev, { width, measure, fontSize = 9.5, scale = 1 }) {
  const st = ev.state;
  const ctxBase = { cd, measure, fontSize, width };
  const H = (r) => Math.round(width * r * scale);
  if (ev.inquiry === 1) {
    return [{ spec: inq1Spec({ ...ctxBase, height: H(0.5), header: true }, st) }];
  }
  if (ev.inquiry === 2) {
    const dv = st.detailView || inq2DetailView(cd, st);
    return [
      { spec: inq2DailySpec({ ...ctxBase, height: H(0.36), header: true }, st) },
      { spec: inq2DetailSpec({ ...ctxBase, height: H(0.44), header: true }, st, dv) },
    ];
  }
  const padLeft = measure('0000', fontSize - 1.5) + fontSize + 18;
  const pad = Math.max(padLeft, measure('북 360°', fontSize - 1.5) + fontSize + 18);
  return [
    { spec: inq3TideSpec({ ...ctxBase, height: H(0.42), header: true, padLeft: pad }, st) },
    { spec: inq3ResidualSpec({ ...ctxBase, height: H(0.3), header: true, padLeft: pad }, st) },
    { spec: inq3BottomSpec({ ...ctxBase, height: H(0.3), header: true, padLeft: pad }, st) },
  ];
}

export function dayLabel(cd, dayKey, days) {
  const d = days.find((x) => x.day === dayKey);
  return d ? fmtDateKo(d.start, cd.tz) : dayKey;
}

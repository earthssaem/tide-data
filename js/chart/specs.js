// 탐구별 그래프 설명(spec) 만들기
// 같은 함수를 화면(현재 분석 상태)과 근거·PDF(고정된 분석 상태)에 함께 사용한다.

import { MARK_SHAPES } from './layout.js';
import { pointAt, extent } from '../analysis/series.js';
import { stationCaseData } from '../data/loader.js';
import { dailyRanges } from '../analysis/daily.js';
import { fmtRange, fmtDateTime, fmtDateKo, DAY } from '../util/time.js';
import { fmtValue, fmtWindDir } from '../util/format.js';

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
    y: { label: '조위 (cm)', domain: ctx.yDomain || null },
    series: [obsSeries(cd)],
    marks,
  };
}

// ───────────────────────── 관측소 비교 ─────────────────────────
/**
 * '같은 눈금': 두 관측소 그래프의 세로축 높이 범위(cm 간격)를 같게 하되, 각자 자기 자료의 가운데에 맞춘다.
 * 관측소마다 조위 기준면이 달라(미확인) 숫자를 직접 비교할 수 없으므로, 두 축을 같은 절대값으로 맞추지 않는다.
 */
export function sameSpanDomains(cdA, cdB, view) {
  const ea = extent(cdA.observed.points, view[0], view[1]);
  const eb = extent(cdB.observed.points, view[0], view[1]);
  if (!ea || !eb) return null;
  const span = Math.max(ea[1] - ea[0], eb[1] - eb[0], 10) * 1.12;
  const dom = (e) => { const m = (e[0] + e[1]) / 2; return [m - span / 2, m + span / 2]; };
  return { a: dom(ea), b: dom(eb), span };
}

/** 비교 관측소의 조위 그래프(선택 지점은 원래 관측소의 것이므로 시각선만 표시) */
export function inq1CompareSpec(ctx, a, cdB, yDomain) {
  const view = a.view || ctx.cd.ranges.inq1;
  const s = inq1Spec({ ...ctx, cd: cdB, yDomain }, { ...a, view, points: [] });
  s.vlines = (a.points || []).map((p) => ({ t: p.t, label: p.label, color: COLORS.accent, dash: [2, 3], width: 1, textColor: COLORS.accent }));
  if (s.header) s.header.subtitle += ' · 비교 관측소(세로선은 원래 관측소에서 고른 지점의 시각)';
  return s;
}

export function compareCaseData(cd, a) {
  const id = a?.compare?.stationId;
  if (!id || !cd.stations) return null;
  const other = stationCaseData(cd, id);
  return other && other !== cd ? other : null;
}

// ───────────────────────── 탐구 2 ─────────────────────────
/** 일별 변동 폭은 기준면과 무관한 '차이'이므로, 같은 눈금이면 두 관측소에 같은 축을 쓴다 */
export function sameDailyDomain(cdA, cdB) {
  const max = Math.max(...[cdA, cdB].flatMap((c) => inq2Days(c).map((d) => d.range ?? 0)), 10);
  return [0, max * 1.14];
}

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
    y: ctx.yDomain ? { label: '변동 폭 (cm)', domain: ctx.yDomain } : { label: '변동 폭 (cm)', includeZero: true, floorZero: true, pad: 0.14 },
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
  return cd.keyTimes.map((k, i) => ({ t: k.t, label: k.label, color: COLORS.key, dash: [6, 3], width: 1.3, row: i % 3, bold: true }));
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

// 기상 그래프 종류 — 단위·종류가 다른 자료는 각각 별도 그래프(같은 시간축)로 그린다.
// 해면기압과 현지기압은 서로 다른 항목이며 한 그래프에 섞지 않는다.
export const WEATHER_KINDS = {
  pressureSea: { label: '해면기압', unit: 'hPa', axis: '해면기압 (hPa)', desc: '관측값을 해수면 높이로 환산한 기압', color: '#1f3a68' },
  pressureStation: { label: '현지기압', unit: 'hPa', axis: '현지기압 (hPa)', desc: '관측소 높이에서 잰 기압(해면기압과 섞지 않음)', color: '#5a4a86' },
  pressure: { label: '기압', unit: 'hPa', axis: '기압 (hPa)', desc: '기압(종류는 자료 설명 참고)', color: '#1f3a68' },
  windSpeed: { label: '풍속', unit: 'm/s', axis: '풍속 (m/s)', desc: '평균 풍속', color: '#0f8b8d' },
  windDir: { label: '풍향', unit: '°', axis: '풍향 (°)', desc: '바람이 불어오는 방향. 북 0°, 동 90°, 남 180°, 서 270°', color: '#0f8b8d' },
};
export const BOTTOM_KINDS = WEATHER_KINDS; // 이전 이름 호환

/** 기상 값 표시 */
export function fmtWeather(kind, v) {
  if (v == null || Number.isNaN(v)) return '자료 없음';
  if (kind === 'windDir') return fmtWindDir(v);
  return fmtValue(v, WEATHER_KINDS[kind].unit, 1);
}

/** 이 사례에 있는 기상 항목 */
export function weatherKinds(cd) {
  return Object.keys(WEATHER_KINDS).filter((k) => cd.weather?.fields?.[k]);
}

/** 화면·근거에 그릴 기상 그래프 목록(학생이 고른 것, 없으면 기본: 기압 1종·풍속·풍향) */
export function inq3Panels(cd, a) {
  const avail = weatherKinds(cd);
  if (Array.isArray(a.panels)) return a.panels.filter((k) => avail.includes(k));
  const p = ['pressureSea', 'pressure', 'pressureStation'].find((k) => avail.includes(k));
  return [p, 'windSpeed', 'windDir'].filter((k) => k && avail.includes(k));
}

/** 기상 항목 이름(자료에 적힌 이름 우선, 예: '기압(종류 미확인)') */
export function weatherLabel(cd, kind) {
  return cd.weather?.fields?.[kind]?.label || WEATHER_KINDS[kind].label;
}

function distText(cd) {
  const d = cd.weatherDistanceKm;
  if (d == null) return '';
  if (d < 0.1) return ' · 조위 관측소와 같은 지점';
  return ` · 조위 관측소에서 약 ${d < 10 ? d.toFixed(1) : d.toFixed(0)} km 떨어진 지점`;
}

export function inq3WeatherSpec(ctx, a, kind = 'pressure') {
  const { cd } = ctx;
  const view = a.view || cd.ranges.inq3;
  const K = WEATHER_KINDS[kind] || WEATHER_KINDS.pressure;
  const w = cd.weather;
  const label = weatherLabel(cd, kind);
  const s = {
    ...base(ctx, view),
    header: ctx.header ? {
      title: `${label} — ${w?.station?.name || '기상 관측 지점'}`,
      subtitle: `${fmtRange(view[0], view[1], cd.tz)}${distText(cd)}${sampleTag(cd)}`,
    } : null,
    y: { label: K.axis },
    vlines: keyLines(cd).map((v) => ({ ...v, label: '' })),
    cursor: a.cursor != null ? { t: a.cursor } : null,
    series: [],
    legend: [],
  };
  if (!w || !w.fields[kind]) {
    s.message = '기상 자료 미제공';
    s.legend = [{ kind: 'line', label: '기상 자료: 자료 미제공', color: '#b8c0ca', dash: [2, 3] }];
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
    s.series = [{ kind: 'dots', points: w.points, key: 'windDir', color: K.color, marker: 'circle', markerSize: 2.6 }];
    s.legend = [{ kind: 'marker', marker: 'circle', label: `${label} (${station}, 바람이 불어오는 방향)`, color: K.color }];
  } else {
    s.series = [{ kind: 'line', points: w.points, key: kind, maxGapMs: w.intervalMs * 1.5, color: K.color, width: 1.7, dots: true, dotMinSpacing: 7 }];
    s.legend = [{ kind: 'line', label: `${label} (${K.unit}, ${station})`, color: K.color, marker: 'circle' }];
    if (kind === 'windSpeed') s.y.floorZero = true;
  }
  s.marks = inq3Marks(a, (t) => weatherAt(cd, t)?.[kind] ?? null);
  return s;
}

/** 이전 이름 호환: a.bottom 하나만 그리기 */
export function inq3BottomSpec(ctx, a) {
  return inq3WeatherSpec(ctx, a, a.bottom || inq3Panels(ctx.cd, a)[0] || 'pressure');
}

/** 근거·PDF용 그림 구성: 패널 목록 */
export function figurePanels(cd0, ev, { width, measure, fontSize = 9.5, scale = 1 }) {
  const st = ev.state;
  // 근거를 만든 관측소의 자료로 그린다(지금 화면에서 고른 관측소와 다를 수 있음)
  const cd = stationCaseData(cd0, ev.stationId);
  if (!cd) {
    const msg = { width, height: Math.round(width * 0.2), measure, fontSize, x: { domain: ev.period || [0, 1], tz: cd0.tz, label: '' }, y: { label: '' }, series: [], message: `관측소 ${ev.station || ev.stationId} 자료를 찾을 수 없어 그래프를 그릴 수 없습니다(표의 값은 근거 당시 기록).` };
    return [{ spec: msg }];
  }
  const cdB = compareCaseData(cd, st);
  const ctxBase = { cd, measure, fontSize, width };
  const H = (r) => Math.round(width * r * scale);
  if (ev.inquiry === 1) {
    if (!cdB) return [{ spec: inq1Spec({ ...ctxBase, height: H(0.5), header: true }, st) }];
    const dom = st.compare.yMode === 'same' ? sameSpanDomains(cd, cdB, st.view || cd.ranges.inq1) : null;
    return [
      { spec: inq1Spec({ ...ctxBase, height: H(0.42), header: true, yDomain: dom?.a }, st) },
      { spec: inq1CompareSpec({ ...ctxBase, height: H(0.42), header: true }, st, cdB, dom?.b) },
    ];
  }
  if (ev.inquiry === 2) {
    const dv = st.detailView || inq2DetailView(cd, st);
    const dd = cdB && st.compare.yMode === 'same' ? sameDailyDomain(cd, cdB) : null;
    return [
      { spec: inq2DailySpec({ ...ctxBase, height: H(0.34), header: true, yDomain: dd }, st) },
      ...(cdB ? [{ spec: inq2DailySpec({ ...ctxBase, cd: cdB, height: H(0.34), header: true, yDomain: dd }, { ...st, selectedDays: [], focusDay: null }) }] : []),
      { spec: inq2DetailSpec({ ...ctxBase, height: H(cdB ? 0.38 : 0.44), header: true }, st, dv) },
    ];
  }
  const padLeft = measure('0000', fontSize - 1.5) + fontSize + 18;
  const pad = Math.max(padLeft, measure('북 360°', fontSize - 1.5) + fontSize + 18);
  // 근거 당시 고른 기상 그래프(옛 근거는 bottom 하나). 자료가 없으면 '자료 미제공' 그래프 하나
  let kinds = Array.isArray(st.panels) ? st.panels.filter((k) => cd.weather?.fields?.[k]) : st.bottom ? [st.bottom] : inq3Panels(cd, st);
  if (!kinds.length) kinds = ['pressure'];
  // 한 그림이 A4 한 쪽에 들어가도록 높이 비율을 줄인다(그래프와 캡션이 떨어지지 않게)
  const ratios = [0.4, 0.27, ...kinds.map(() => 0.22)];
  const total = ratios.reduce((x, y) => x + y, 0);
  const f = Math.min(1, 1.3 / total);
  return [
    { spec: inq3TideSpec({ ...ctxBase, height: H(ratios[0] * f), header: true, padLeft: pad }, st) },
    { spec: inq3ResidualSpec({ ...ctxBase, height: H(ratios[1] * f), header: true, padLeft: pad }, st) },
    ...kinds.map((k) => ({ spec: inq3WeatherSpec({ ...ctxBase, height: H(0.22 * f), header: true, padLeft: pad }, st, k) })),
  ];
}

export function dayLabel(cd, dayKey, days) {
  const d = days.find((x) => x.day === dayKey);
  return d ? fmtDateKo(d.start, cd.tz) : dayKey;
}

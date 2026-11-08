// 수행평가 그래프 설명(spec) — 화면(SVG)과 보고서(PDF)가 같은 함수를 쓴다.
// 원칙: 앱이 만조·간조·대조·소조·조석 형태를 표시하지 않는다(학생이 고른 지점만 학생이 붙인 이름으로 표시).
//       자료 공개 전에는 기상·태풍·달의 위상과 관련된 표시를 하지 않는다.
//       높이 기준면이 확인되지 않았으므로 관측소끼리, 예측과 관측끼리 높이를 겹쳐 그리지 않는다.

import { MARK_SHAPES, niceStep } from './layout.js';
import { projection, koreaMapSync, trackMapLayout } from './map.js';
import { pointAt, lowerBound } from '../analysis/series.js';
import { dailyRanges } from '../analysis/daily.js';
import { fmtRange, fmtDateTime, parts, DAY, HOUR } from '../util/time.js';
import { fmtValue, fmtWindDir } from '../util/format.js';

export const COLORS = {
  pred: '#0f6b8d',
  obs: '#1f3a68',
  pick: '#d9480f',
  pick2: '#7048e8',
  band: '#f2b705',
  sel: '#5b6675',
  bar: '#9db4cf',
  barObs: '#4b6a99',
  barPred: '#7fc4c8',
  moon: '#3b4652',
  pressure: '#1f3a68',
  wind: '#0f8b8d',
  past: '#9c3d10',
  recent: '#1f5fbf',
};

const sampleTag = (cd) => (cd.isSample ? ' · 기능 확인용 예시 데이터' : '');

export function valueAt(series, t) {
  if (!series) return null;
  const p = pointAt(series.points, t);
  return p && p.v != null ? p.v : null;
}

/** 범위 안의 최댓값·최솟값 */
export function extremaIn(series, t0, t1, key = 'v') {
  if (!series) return null;
  let max = null, min = null, n = 0;
  const pts = series.points;
  for (let i = lowerBound(pts, t0); i < pts.length && pts[i].t <= t1; i++) {
    const v = pts[i][key];
    if (v == null) continue;
    n++;
    if (!max || v > max.v) max = { t: pts[i].t, v };
    if (!min || v < min.v) min = { t: pts[i].t, v };
  }
  return n ? { max, min, range: Math.round((max.v - min.v) * 100) / 100, n } : null;
}

/** 여러 그래프의 세로 범위: 'same'은 같은 눈금 크기(cm 간격 같음, 각자 가운데), 'own'은 각자 */
export function yDomains(list, mode = 'same', pad = 0.12) {
  const ext = list.map(({ series, t0, t1, key }) => extremaIn(series, t0, t1, key));
  const spans = ext.map((e) => (e ? e.max.v - e.min.v : 0));
  const S = Math.max(10, ...spans);
  return ext.map((e, i) => {
    if (!e) return null;
    const span = mode === 'same' ? S : Math.max(10, spans[i]);
    const c = (e.max.v + e.min.v) / 2;
    const h = (span * (1 + 2 * pad)) / 2;
    return [c - h, c + h];
  });
}

/** 같은 눈금 크기일 때 모든 그래프에 같은 눈금 간격 */
export function sharedTickStep(domains, plotH) {
  const spans = domains.filter(Boolean).map((d) => d[1] - d[0]);
  if (!spans.length) return null;
  return niceStep(Math.max(...spans), Math.max(2, Math.floor(plotH / 34)));
}

function baseSpec(ctx, cd, view) {
  return {
    width: ctx.width, height: ctx.height, measure: ctx.measure, fontSize: ctx.fontSize || 12,
    x: { domain: view, tz: cd.tz, label: `날짜·시각 (${cd.tz.label})`, hideAxisTitle: !!ctx.hideXTitle },
    padLeft: ctx.padLeft,
  };
}

/**
 * 조위 그래프 한 개
 * @param {{cd, kind:'predicted'|'observed', view, title?, subtitle?, color?, yDomain?, marks?, bands?, cursor?, legendExtra?, vlines?}} o
 */
export function tideSpec(ctx, o) {
  const { cd, kind, view } = o;
  const s = o.series || cd[kind];
  const color = o.color || (kind === 'predicted' ? COLORS.pred : COLORS.obs);
  const label = kind === 'predicted' ? '예측 조위' : '관측 조위';
  const step = Math.round((s?.intervalMs || HOUR) / 60000);
  const stepText = step >= 60 ? `${step / 60}시간` : `${step}분`;
  const spec = {
    ...baseSpec(ctx, cd, view),
    header: o.title ? { title: o.title, subtitle: o.subtitle ?? `${fmtRange(view[0], view[1], cd.tz)}${sampleTag(cd)}` } : null,
    legend: o.noLegend ? [] : [{ kind: 'line', label: `${label} (${stepText} 간격 값을 이은 선)`, color, marker: step >= 60 ? 'circle' : null }, ...(o.legendExtra || [])],
    y: { label: '조위 (cm)', domain: o.yDomain || null, tickStep: o.tickStep || null },
    series: s ? [{ kind: 'line', points: s.points, maxGapMs: (s.intervalMs || HOUR) * 1.5, color, width: 1.8, dots: true, dotMinSpacing: o.dotMinSpacing ?? 5 }] : [],
    marks: o.marks || [],
    bands: o.bands || [],
    vlines: o.vlines || [],
    cursor: o.cursor != null ? { t: o.cursor } : null,
  };
  if (!s) spec.message = `${label} 자료 미제공`;
  return spec;
}

// ───────────── 탐구 1 ─────────────
/** 탐구 1에 쓸 예측 조위: 그 구간 전체에 10분 간격 자료가 있으면 10분, 없으면 1시간 */
export function inq1Series(ad, view = ad.win.inq1) {
  const cd = ad.st[ad.rep];
  const p10 = cd.predicted10;
  if (p10) {
    const n = p10.points.filter((p) => p.t >= view[0] && p.t <= view[1] && p.v != null).length;
    if (n >= Math.round((view[1] - view[0]) / p10.intervalMs)) return p10;
  }
  return cd.predicted;
}

export function q1Marks(ad, q1) {
  const s = inq1Series(ad);
  const out = [];
  if (q1?.high) out.push({ t: q1.high.t, v: q1.high.v ?? valueAt(s, q1.high.t), label: '만조(내가 고름)', shape: 'triangle', color: COLORS.pick });
  if (q1?.low) out.push({ t: q1.low.t, v: q1.low.v ?? valueAt(s, q1.low.t), label: '간조(내가 고름)', shape: 'triangleDown', color: COLORS.pick2, labelPos: 'below' });
  return out;
}

export function inq1MainSpec(ctx, ad, ans, { cursor = null, title = true } = {}) {
  const cd = ad.st[ad.rep];
  const [c0, c1] = ad.win.count;
  return tideSpec(ctx, {
    cd, kind: 'predicted', view: ad.win.inq1, series: inq1Series(ad),
    title: title ? `부산 예측 조위 — 3일` : null,
    marks: q1Marks(ad, ans.q1),
    bands: [{ t0: c0, t1: c1, fill: COLORS.band, opacity: 0.18, stroke: '#b98900', strokeWidth: 1 }],
    legendExtra: [{ kind: 'bar', label: `문항 ② 24시간 (${fmtRange(c0, c1, cd.tz, { withTz: false })})`, color: '#f6dc8a' }],
    cursor,
  });
}

/** 한 달 일별 변동 폭(예측 조위의 하루 최고 − 최저) */
export function monthDays(cd, month, kind = 'predicted') {
  const s = cd[kind];
  return s ? dailyRanges(s.points, cd.tz, s.intervalMs, month[0], month[1]) : [];
}

/** 한 달 예측 조위(점을 이은 선). ③에서 고른 날은 색칠하고 위쪽에 학생이 붙인 이름 표시 */
export function inq1MonthSpec(ctx, ad, ans, { showMoon = false, focusDay = null, title = true } = {}) {
  const cd = ad.st[ad.rep];
  const month = ad.win.month;
  const dayStart = (k) => Date.parse(`${k}T00:00:00Z`) - cd.tz.offsetMinutes * 60000;
  const picks = [[ans.q3?.spring, '대조', COLORS.pick], [ans.q3?.neap, '소조', COLORS.pick2]].filter(([k]) => k);
  const bands = picks.map(([k, , c]) => ({ t0: dayStart(k), t1: dayStart(k) + DAY, fill: c, opacity: 0.16, stroke: c, strokeWidth: 1 }));
  if (focusDay && !picks.some(([k]) => k === focusDay)) bands.push({ t0: dayStart(focusDay), t1: dayStart(focusDay) + DAY, fill: COLORS.sel, opacity: 0.14, stroke: '#1d2733', strokeWidth: 1, dash: [4, 3] });
  const marks = picks.map(([k, name, c]) => ({ t: dayStart(k) + DAY / 2, v: null, label: `${name}(내가 고름)`, color: c }));
  const vlines = showMoon && cd.moon ? cd.moon.phases.filter((p) => p.t >= month[0] - DAY && p.t <= month[1] + DAY).map((p) => ({
    t: p.t, icon: p.phase, label: `${p.label} ${fmtDateTime(p.t, cd.tz, { year: false }).slice(3, 5).replace(/^0/, '')}일`, color: COLORS.moon, dash: [2, 3], width: 1.1,
  })) : [];
  const spec = tideSpec(ctx, {
    cd, kind: 'predicted', view: month, title: title ? '부산 예측 조위 — 한 달' : null,
    bands, marks, vlines, dotMinSpacing: 4,
    legendExtra: [
      ...(picks.length ? [{ kind: 'bar', label: '내가 고른 날', color: '#f3c6b4' }] : []),
      ...(showMoon && cd.moon ? [{ kind: 'moon', icon: 'full', label: '달의 위상(삭●·상현◑·망○·하현◐) 시각', color: COLORS.moon }] : []),
    ],
  });
  spec.x = { ...spec.x, minTickSpacing: 30 };
  return spec;
}

// ───────────── 탐구 2 ─────────────
export function inq2Specs(ctx, ad, mode = 'same', { cursor = null } = {}) {
  const view = ad.win.inq2;
  const list = ad.stationList.map((s) => ({ s, cd: ad.st[s.id] }));
  const doms = yDomains(list.map(({ cd }) => ({ series: cd.predicted, t0: view[0], t1: view[1] })), mode);
  const step = mode === 'same' ? sharedTickStep(doms, (ctx.height || 190) - 90) : null;
  return list.map(({ s, cd }, i) => tideSpec({ ...ctx, hideXTitle: i < list.length - 1 }, {
    cd, kind: 'predicted', view, yDomain: doms[i], tickStep: step,
    title: `${s.name} (${s.sea}) 예측 조위`,
    subtitle: `${fmtRange(view[0], view[1], cd.tz)} · 세로 눈금: ${mode === 'same' ? '세 지역 같은 눈금 크기(각자 가운데)' : '지역마다 따로'}${sampleTag(cd)}`,
    noLegend: i > 0, cursor,
  }));
}

/** 관측소 위치 지도 */
export function stationsMapLayout({ stations, width, measure, fontSize = 11, title = '관측소 위치' }) {
  const map = koreaMapSync();
  const box = map?.bbox || { minX: 123.6, maxX: 131.4, minY: 32.6, maxY: 38.9 };
  const { X, Y, height: mapH } = projection(box, width);
  const small = fontSize - 1.5;
  const items = [];
  const oy = fontSize + 10;
  items.push({ type: 'text', x: 2, y: fontSize + 2, text: title, size: fontSize + 1, bold: true, fill: '#1d2733' });
  items.push({ type: 'rect', x: 0, y: oy, w: width, h: mapH, fill: '#eaf3f7', stroke: '#c5ced8', strokeWidth: 0.8 });
  for (const r of map?.rings || []) items.push({ type: 'polygon', pts: r.map(([lo, la]) => [X(lo), Y(la) + oy]), fill: '#f6f4ee', stroke: '#9aa5b1', strokeWidth: 0.6 });
  if (!map) items.push({ type: 'text', x: width / 2, y: oy + mapH / 2, text: '지도 자료를 불러오지 못했습니다', size: small, anchor: 'middle', fill: '#5b6675' });
  for (const s of stations) {
    const x = X(s.lon), y = Y(s.lat) + oy;
    items.push({ type: 'rect', x: x - 5, y: y - 5, w: 10, h: 10, fill: '#1f3a68', stroke: '#ffffff', strokeWidth: 1.2 });
    const t = `${s.name}`;
    const lw = measure(t, small, true);
    const left = x + 9 + lw > width;
    items.push({ type: 'text', x: left ? x - 9 : x + 9, y: y + small * 0.35, text: t, size: small, bold: true, fill: '#1f3a68', anchor: left ? 'end' : 'start' });
  }
  items.push({ type: 'text', x: width - 2, y: oy + mapH + small + 4, text: '해안선: Natural Earth(단순화)', size: small - 1, fill: '#5b6675', anchor: 'end' });
  return { items, width, height: oy + mapH + small + 8 };
}

// ───────────── 탐구 3 ─────────────
export function inq3Specs(ctx, ad, ans, { cursor = null, drag = null } = {}) {
  const cd = ad.st[ad.rep];
  const view = ad.win.inq3;
  const sel = drag || (ans.q7?.t0 != null ? [ans.q7.t0, ans.q7.t1] : null);
  const bands = sel ? [{ t0: sel[0], t1: sel[1], fill: COLORS.sel, opacity: 0.22, stroke: '#1d2733', strokeWidth: 1.2, dash: [4, 3] }] : [];
  const doms = yDomains([{ series: cd.predicted, t0: view[0], t1: view[1] }, { series: cd.observed, t0: view[0], t1: view[1] }], 'same');
  const step = sharedTickStep(doms, (ctx.height || 230) - 90);
  const legendSel = sel ? [{ kind: 'barHollow', label: '내가 고른 구간', color: '#1d2733' }] : [];
  return [
    tideSpec({ ...ctx, hideXTitle: true }, { cd, kind: 'predicted', view, yDomain: doms[0], title: '부산 예측 조위', subtitle: `${fmtRange(view[0], view[1], cd.tz)} · 세로 눈금 간격은 아래 관측 조위와 같음${sampleTag(cd)}`, bands, cursor, legendExtra: legendSel, dotMinSpacing: 7, tickStep: step }),
    tideSpec(ctx, { cd, kind: 'observed', view, yDomain: doms[1], title: '부산 관측 조위', subtitle: `높이의 기준(0 cm)이 확인되지 않아 예측과 높이를 겹쳐 그리지 않음${sampleTag(cd)}`, bands, cursor, noLegend: false, dotMinSpacing: 7, tickStep: step }),
  ];
}

/** 일별 변동 폭: 예측(왼쪽 반)과 관측(오른쪽 반)을 나란히 */
export function inq3DailySpec(ctx, ad, ans) {
  const cd = ad.st[ad.rep];
  const month = ad.win.inq3;
  const P = monthDays(cd, month, 'predicted'), O = monthDays(cd, month, 'observed');
  const sel = ans.q7?.t0 != null ? [ans.q7.t0, ans.q7.t1] : null;
  const bars = [];
  P.forEach((d, i) => {
    const o = O[i];
    const mid = d.start + DAY / 2;
    bars.push({ t0: d.start, t1: mid, v: d.complete ? d.range : null, hollow: !d.complete && d.range != null, color: COLORS.barPred });
    bars.push({ t0: mid, t1: d.end, v: o?.complete ? o.range : null, hollow: o && !o.complete && o.range != null, color: COLORS.barObs });
  });
  return {
    ...baseSpec(ctx, cd, month),
    header: { title: '부산 일별 변동 폭 — 예측과 관측', subtitle: `하루 동안 최고값 − 최저값 · ${fmtRange(month[0], month[1], cd.tz)}${sampleTag(cd)}` },
    legend: [{ kind: 'bar', label: '예측 조위', color: COLORS.barPred }, { kind: 'bar', label: '관측 조위', color: COLORS.barObs }, ...(sel ? [{ kind: 'barHollow', label: '내가 고른 구간', color: '#1d2733' }] : [])],
    y: { label: '변동 폭 (cm)', includeZero: true, floorZero: true },
    x: { ...baseSpec(ctx, cd, month).x, minTickSpacing: 30 },
    series: [{ kind: 'bars', bars, color: COLORS.bar }],
    bands: sel ? [{ t0: sel[0], t1: sel[1], fill: COLORS.sel, opacity: 0.12, stroke: '#1d2733', strokeWidth: 1.2, dash: [4, 3] }] : [],
  };
}

// ───────────── 탐구 4 ─────────────
export const PERIOD_NAMES = { a: '기간 A', b: '기간 B' };
export function periodTitle(ad, k, revealed) {
  const [t0, t1] = ad.win[k];
  const a = parts(t0, ad.tz), b = parts(t1 - 1, ad.tz);
  const d = `${a.year}년 ${a.month}월 ${a.day}일 ~ ${b.year !== a.year ? `${b.year}년 ` : ''}${b.month}월 ${b.day}일`;
  if (!revealed) return `${PERIOD_NAMES[k]}: ${d}`;
  return k === 'a' ? `${PERIOD_NAMES[k]}: ${d}` : `${PERIOD_NAMES[k]}: ${d} — 확인한 기압·바람이 상대적으로 안정적인 기간`;
}
export const periodCd = (ad, k) => (k === 'a' ? ad.past : ad.st[ad.rep]);

export function inq4TideSpecs(ctx, ad, { revealed = false, cursor = {} } = {}) {
  const ks = ['a', 'b'];
  const doms = yDomains(ks.map((k) => ({ series: periodCd(ad, k).observed, t0: ad.win[k][0], t1: ad.win[k][1] })), 'same');
  const step = sharedTickStep(doms, (ctx.height || 230) - 90);
  return ks.map((k, i) => tideSpec(ctx, {
    cd: periodCd(ad, k), kind: 'observed', view: ad.win[k], yDomain: doms[i], tickStep: step,
    title: `부산 관측 조위 — ${periodTitle(ad, k, revealed)}`,
    subtitle: `세로 눈금 간격은 두 기간이 같음(각자 가운데)${sampleTag(periodCd(ad, k))}`,
    color: k === 'a' ? COLORS.past : COLORS.recent, cursor: cursor[k] ?? null, dotMinSpacing: 7,
  }));
}

export const WEATHER = {
  pressureSea: { label: '해면기압', unit: 'hPa', axis: '해면기압 (hPa)', color: COLORS.pressure },
  windSpeed: { label: '풍속', unit: 'm/s', axis: '풍속 (m/s)', color: COLORS.wind },
  windDir: { label: '풍향', unit: '°', axis: '풍향', color: COLORS.wind },
};
export function fmtWx(kind, v) {
  if (v == null || Number.isNaN(v)) return '자료 없음';
  return kind === 'windDir' ? fmtWindDir(v) : fmtValue(v, WEATHER[kind].unit, 1);
}

/** 두 기간에 같은 세로 범위를 쓰도록(기압·풍속은 절대값이라 같은 범위로 비교) */
export function weatherDomain(ad, kind) {
  if (kind === 'windDir') return [0, 360];
  const ex = ['a', 'b'].map((k) => extremaIn(periodCd(ad, k).weather, ad.win[k][0], ad.win[k][1], kind)).filter(Boolean);
  if (!ex.length) return null;
  const lo = Math.min(...ex.map((e) => e.min.v)), hi = Math.max(...ex.map((e) => e.max.v));
  const pad = Math.max(1, (hi - lo) * 0.1);
  return [kind === 'windSpeed' ? 0 : lo - pad, hi + pad];
}

export function weatherSpec(ctx, ad, k, kind, { cursor = null, yDomain = null, title = true } = {}) {
  const cd = periodCd(ad, k);
  const view = ad.win[k];
  const K = WEATHER[kind];
  const w = cd.weather;
  const spec = {
    ...baseSpec(ctx, cd, view),
    header: title ? { title: `${K.label} — ${w?.station?.name || '기상 관측 지점'} · ${PERIOD_NAMES[k]}`, subtitle: kind === 'pressureSea' ? '해면기압: 관측소 기압을 해수면 높이로 환산한 값(태풍 중심기압과 다름)' : kind === 'windDir' ? '바람이 불어오는 방향' : '1시간 평균 풍속' } : null,
    y: { label: K.axis, domain: yDomain || weatherDomain(ad, kind) },
    cursor: cursor != null ? { t: cursor } : null,
    series: [], legend: [],
  };
  if (!w || !w.fields?.[kind]) { spec.message = '기상 자료 미제공'; return spec; }
  if (kind === 'windDir') {
    spec.y.ticks = [{ v: 0, label: '북' }, { v: 90, label: '동' }, { v: 180, label: '남' }, { v: 270, label: '서' }, { v: 360, label: '북' }];
    spec.series = [{ kind: 'dots', points: w.points, key: 'windDir', color: K.color, marker: 'circle', markerSize: 2.4 }];
  } else {
    spec.series = [{ kind: 'line', points: w.points, key: kind, maxGapMs: w.intervalMs * 1.5, color: K.color, width: 1.7, dots: true, dotMinSpacing: 7 }];
  }
  return spec;
}

/** 태풍 경로 지도(기간 A) */
export function typhoonMapLayout(ad, { width, measure, fontSize = 10 }) {
  const cd = ad.past;
  if (!cd?.typhoon) return null;
  return trackMapLayout({ map: koreaMapSync(), cd, view: ad.win.a, width, measure, fontSize });
}

/** 태풍 중심이 부산에 가장 가까웠던 분석 시각(기간 A) */
export function closestTyphoonPoint(ad) {
  const cd = ad.past;
  if (!cd?.typhoon?.track?.length) return null;
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const d = (p) => { const s = cd.station; const h = Math.sin(rad(p.lat - s.lat) / 2) ** 2 + Math.cos(rad(s.lat)) * Math.cos(rad(p.lat)) * Math.sin(rad(p.lon - s.lon) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  let best = null;
  for (const p of cd.typhoon.track) { const k = d(p); if (!best || k < best.km) best = { ...p, km: k }; }
  return best;
}

export { MARK_SHAPES };

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

/** 위아래로 쌓은 그래프들의 가로축을 맞추려고 같은 왼쪽 여백을 쓴다(세로축 숫자 폭이 달라도 같은 시각이 같은 자리에) */
export const alignedPad = (ctx) => Math.round((ctx.fontSize || 12) * 5.6);

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
    legend: o.noLegend ? [] : [{ kind: 'line', label: o.legendLabel || `${label} (${stepText} 간격 값을 이은 선)`, color, marker: step >= 60 ? 'circle' : null }, ...(o.legendExtra || [])],
    y: { label: o.yLabel || '조위 (cm)', domain: o.yDomain || null, tickStep: o.tickStep || null, zeroLine: !!o.zeroLine, zeroLabel: o.zeroLabel },
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
    // 문항 ②를 끈 경우 24시간 띠를 그리지 않는다
    bands: ad.setup?.questions?.q2 === false ? [] : [{ t0: c0, t1: c1, fill: COLORS.band, opacity: 0.18, stroke: '#b98900', strokeWidth: 1 }],
    legendExtra: ad.setup?.questions?.q2 === false ? [] : [{ kind: 'bar', label: `문항 ② 24시간 (${fmtRange(c0, c1, cd.tz, { withTz: false })})`, color: '#f6dc8a' }],
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
  spec.x = { ...spec.x, minTickSpacing: 30, centerDayLabels: true, label: `날짜 (${cd.tz.label}, 날짜 글자는 그날의 가운데)` };
  return spec;
}

// ───────────── 탐구 2 ─────────────
/**
 * 탐구 2에 그릴 값. 'same'(같은 축): 지역마다 기간 평균을 0으로 한 높이(예측 조위 − 기간 평균)를 세 지역 같은 세로축에 그린다.
 *   관측소마다 높이의 기준(0 cm)이 달라 원래 숫자를 한 축에 놓으면 높낮이 비교처럼 보이므로, 평균을 빼서 오르내림만 남긴다.
 * 'own'(개별 눈금): 원래 예측 조위를 지역마다 다른 세로축에 그린다.
 */
export function inq2Series(ad, mode = 'same') {
  const view = ad.win.inq2;
  return ad.stationList.map((s) => {
    const src = ad.st[s.id].predicted;
    if (mode !== 'same') return { s, series: src, mean: null };
    const vals = src.points.filter((p) => p.t >= view[0] && p.t <= view[1] && p.v != null).map((p) => p.v);
    const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    return { s, mean, series: { ...src, points: src.points.map((p) => ({ ...p, v: p.v == null ? null : Math.round((p.v - mean) * 100) / 100 })) } };
  });
}

export function inq2Specs(ctx, ad, mode = 'same', { cursor = null } = {}) {
  const view = ad.win.inq2;
  const list = inq2Series(ad, mode);
  let doms, step = null;
  if (mode === 'same') {
    const ext = list.map(({ series }) => extremaIn(series, view[0], view[1])).filter(Boolean);
    const H = Math.max(10, ...ext.map((e) => Math.max(Math.abs(e.max.v), Math.abs(e.min.v)))) * 1.1;
    step = niceStep(2 * H, 6);
    const top = Math.ceil(H / step) * step;
    doms = list.map(() => [-top, top]);
  } else doms = yDomains(list.map(({ series }) => ({ series, t0: view[0], t1: view[1] })), 'own');
  return list.map(({ s, series }, i) => tideSpec({ ...ctx, hideXTitle: i < list.length - 1 }, {
    cd: ad.st[s.id], kind: 'predicted', series, view, yDomain: doms[i], tickStep: step,
    title: `${s.name} (${s.sea}) 예측 조위`,
    subtitle: `${fmtRange(view[0], view[1], ad.tz)} · 세로축: ${mode === 'same' ? '세 지역 같은 축(지역마다 이 기간의 평균 높이를 0으로)' : '지역마다 따로(원래 예측 조위)'}${sampleTag(ad.st[s.id])}`,
    yLabel: mode === 'same' ? '평균과의 차이 (cm)' : '조위 (cm)',
    legendLabel: mode === 'same' ? '예측 조위 − 이 기간의 평균 (1시간 간격 값을 이은 선)' : null,
    zeroLine: mode === 'same', zeroLabel: '기간 평균',
    noLegend: i > 0, cursor,
  }));
}

/**
 * 탐구 2 확대 그래프: 한 지역만 세로축을 늘려 반복 모양을 자세히 본다(같은 축 그래프에서 오르내림이 작아 모양이 안 보일 때).
 * 값은 같은 축 그래프와 같이 '예측 조위 − 기간 평균'이고, 세로 눈금만 그 지역에 맞춘다.
 */
export function inq2ZoomSpec(ctx, ad, id, { cursor = null } = {}) {
  const view = ad.win.inq2;
  const list = inq2Series(ad, 'same');
  const d = list.find((x) => x.s.id === id) || list[list.length - 1];
  const e = extremaIn(d.series, view[0], view[1]);
  const H = e ? Math.max(1, Math.abs(e.max.v), Math.abs(e.min.v)) * 1.15 : 10;
  const step = niceStep(2 * H, 6);
  const top = Math.ceil(H / step) * step;
  return tideSpec(ctx, {
    cd: ad.st[d.s.id], kind: 'predicted', series: d.series, view, yDomain: [-top, top], tickStep: step,
    title: `${d.s.name} 확대 — 세로축만 늘린 그래프`,
    subtitle: `세로 눈금이 위의 같은 축 그래프와 다릅니다. 조차 비교는 위 그래프로, 반복 모양은 이 그래프로 보세요.${sampleTag(ad.st[d.s.id])}`,
    yLabel: '평균과의 차이 (cm)', legendLabel: '예측 조위 − 이 기간의 평균 (1시간 간격 값을 이은 선)',
    zeroLine: true, zeroLabel: '기간 평균', color: COLORS.pick2, cursor,
  });
}
export const inq2ZoomId = (ad, ui) => (ad.stationList.some((s) => s.id === ui?.inq2Zoom) ? ui.inq2Zoom : ad.stationList[ad.stationList.length - 1].id);

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

// ───────────── 탐구 3(특이한 변화, 내부 이름 inq4) ─────────────
export const PERIOD_NAMES = { a: '기간 A', b: '기간 B' };
export function periodTitle(ad, k, revealed) {
  const [t0, t1] = ad.win[k];
  const a = parts(t0, ad.tz), b = parts(t1 - 1, ad.tz);
  const d = `${a.year}년 ${a.month}월 ${a.day}일 ~ ${b.year !== a.year ? `${b.year}년 ` : ''}${b.month}월 ${b.day}일`;
  // 공개 뒤에도 날짜만 쓴다(기간의 성격은 학생이 자료로 해석)
  return `${PERIOD_NAMES[k]}: ${d}`;
}
/** 기간이 들어 있는 자료(과거 비교 기간 자료 또는 대표 관측소 1년 자료) */
export function cdForWindow(ad, w) {
  const inPast = (cd) => cd?.observed?.points.length && w[0] >= cd.observed.points[0].t && w[0] <= cd.observed.points.at(-1).t;
  return inPast(ad.past) ? ad.past : ad.st[ad.rep];
}
export const periodCd = (ad, k) => cdForWindow(ad, ad.win[k]);

/** 기간(앞뒤 하루 포함) 동안 부산에 가장 가까웠던 태풍 중심(기상청 태풍경로, 거리만) */
export function periodTyphoon(ad, k) {
  const [t0, t1] = ad.win[k];
  const st = ad.st[ad.rep].station;
  const R = 6371, r = (x) => (x * Math.PI) / 180;
  const dist = (p) => 2 * R * Math.asin(Math.sqrt(Math.sin(r(p.lat - st.lat) / 2) ** 2 + Math.cos(r(st.lat)) * Math.cos(r(p.lat)) * Math.sin(r(p.lon - st.lon) / 2) ** 2));
  let best = null;
  for (const tr of ad.typhoonTracks || []) for (const p of tr.points) {
    if (p.t < t0 - DAY || p.t > t1 + DAY) continue;
    const km = dist(p);
    if (!best || km < best.km) best = { name: tr.name, km, t: p.t };
  }
  return best;
}
export function periodTyphoonText(ad, k) {
  if (!ad.typhoonTracks?.length) return '태풍 경로 자료 미제공';
  const b = periodTyphoon(ad, k);
  return b ? `이 기간(앞뒤 하루 포함) 부산에서 가장 가까웠던 태풍 중심: ${b.name.replace(/^\d{4}년 /, '')}, 약 ${Math.round(b.km)} km (기상청 태풍경로)` : '이 기간(앞뒤 하루 포함)에 기록된 태풍이 없습니다(기상청 태풍경로).';
}

/** 문항 ⑨에서 기록한 시각의 값: kind = 'tide'|'pressureSea'|'windSpeed' */
export function q11Value(ad, rec, kind) {
  if (!rec) return null;
  const cd = periodCd(ad, rec.k);
  if (kind === 'tide') return valueAt(cd.observed, rec.t);
  const p = cd.weather ? pointAt(cd.weather.points, rec.t) : null;
  return p && p[kind] != null && !Number.isNaN(p[kind]) ? p[kind] : null;
}

/** 문항 ⑨에서 기록한 시각을 그 그래프에 표시(조위 최고 ▲, 기압 최저 ▼, 풍속 최대 ▲) */
export function q11Marks(ad, q11, k, kind) {
  const M = { tide: ['peak', '최고(내가 고름)', 'triangle', COLORS.pick, 'above'], pressureSea: ['pressure', '최저(내가 고름)', 'triangleDown', COLORS.pick2, 'below'], windSpeed: ['wind', '최대(내가 고름)', 'triangle', COLORS.pick, 'above'] }[kind];
  const rec = M && q11?.[M[0]];
  if (!rec || rec.k !== k) return [];
  return [{ t: rec.t, v: q11Value(ad, rec, kind), label: M[1], shape: M[2], color: M[3], labelPos: M[4], vline: true }];
}

export function inq4TideSpecs(ctx, ad, { revealed = false, cursor = {}, compact = false, q11 = null } = {}) {
  const ks = ['a', 'b'];
  const doms = yDomains(ks.map((k) => ({ series: periodCd(ad, k).observed, t0: ad.win[k][0], t1: ad.win[k][1] })), 'same');
  const step = sharedTickStep(doms, (ctx.height || 230) - 90);
  return ks.map((k, i) => tideSpec(ctx, {
    cd: periodCd(ad, k), kind: 'observed', view: ad.win[k], yDomain: doms[i], tickStep: step,
    title: compact ? '관측 조위' : `부산 관측 조위 — ${periodTitle(ad, k, revealed)}`,
    subtitle: compact ? `${sampleTag(periodCd(ad, k)).replace(/^ · /, '')}` : `세로 눈금 간격은 두 기간이 같음(각자 가운데)${sampleTag(periodCd(ad, k))}`,
    color: k === 'a' ? COLORS.past : COLORS.recent, cursor: cursor[k] ?? null, dotMinSpacing: 7,
    marks: revealed && q11 ? q11Marks(ad, q11, k, 'tide') : [],
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

export function weatherSpec(ctx, ad, k, kind, { cursor = null, yDomain = null, title = true, compact = false, q11 = null } = {}) {
  const cd = periodCd(ad, k);
  const view = ad.win[k];
  const K = WEATHER[kind];
  const w = cd.weather;
  const spec = {
    ...baseSpec(ctx, cd, view),
    header: compact ? { title: `${K.label} (${K.unit})`, subtitle: '' } : title ? { title: `${K.label} — ${w?.station?.name || '기상 관측 지점'} · ${PERIOD_NAMES[k]}`, subtitle: kind === 'pressureSea' ? '해면기압: 관측소 기압을 해수면 높이로 환산한 값(태풍 중심기압과 다름)' : kind === 'windDir' ? '바람이 불어오는 방향' : '1시간 평균 풍속' } : null,
    y: { label: K.axis, domain: yDomain || weatherDomain(ad, kind) },
    cursor: cursor != null ? { t: cursor } : null,
    series: [], legend: [],
    marks: q11 ? q11Marks(ad, q11, k, kind) : [],
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

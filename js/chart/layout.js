// 그래프 배치 엔진
// spec(그래프 설명) → 그리기 목록(display list)
// 같은 그리기 목록을 화면에서는 SVG로(svg.js), PDF에서는 벡터 도형·텍스트로(report/pdf.js) 그린다.
// 그래서 화면, 근거 미리보기, PDF 그래프가 같은 규칙으로 만들어진다.
//
// 원칙
//  - 관측점은 직선으로만 연결한다(곡선 보간 없음 → 원자료에 없는 최고·최저값을 만들지 않음).
//  - 결측(null)이나 관측 간격보다 큰 시간 공백에서는 선을 끊는다.
//  - 앞뒤가 끊긴 단독 자료점은 점으로 표시한다.

import { segments, lowerBound } from '../analysis/series.js';
import { HOUR, DAY, MINUTE, parts } from '../util/time.js';
import { fmtNum } from '../util/format.js';

export const THEME = {
  text: '#1d2733',
  muted: '#5b6675',
  axis: '#45505e',
  grid: '#e3e8ee',
  gridStrong: '#c5ced8',
  bg: '#ffffff',
  halo: '#ffffff',
};

const TIME_STEPS = [HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 3 * DAY, 5 * DAY, 7 * DAY, 14 * DAY];

function niceStep(range, target) {
  const raw = range / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * mag;
}

export function yTicksFor(domain, plotH, minSpacing = 34) {
  const [a, b] = domain;
  const make = (target) => {
    const step = niceStep(b - a, target);
    const ticks = [];
    const start = Math.ceil(a / step - 1e-9) * step;
    for (let v = start; v <= b + 1e-9; v += step) ticks.push(Math.round(v / step) * step);
    return { step, ticks };
  };
  // 눈금이 하나만 남으면(작은 그림·축 범위가 눈금 간격과 어긋날 때) 간격을 줄여 최소 2개를 보인다
  let target = Math.max(2, Math.floor(plotH / minSpacing));
  let { step, ticks: out } = make(target);
  for (let i = 0; i < 4 && out.length < 2; i++) ({ step, ticks: out } = make(target += 2));
  const digits = step < 1 ? Math.min(3, Math.ceil(-Math.log10(step))) : 0;
  return out.map((v) => ({ v, label: fmtNum(v, digits) }));
}

export function timeTicks(t0, t1, tz, plotW, minSpacing = 46) {
  const span = t1 - t0;
  let step = TIME_STEPS[TIME_STEPS.length - 1];
  for (const s of TIME_STEPS) {
    if ((span / s) * minSpacing <= plotW) { step = s; break; }
  }
  const off = (tz?.offsetMinutes || 0) * MINUTE;
  const out = [];
  const first = Math.ceil((t0 + off) / step) * step - off;
  for (let t = first; t <= t1 + 1; t += step) {
    const p = parts(t, tz);
    const midnight = p.hour === 0 && p.minute === 0;
    const dateLabel = `${p.month}/${p.day}`;
    if (step < DAY) {
      out.push({ t, label: `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`, sub: midnight || out.length === 0 ? dateLabel : '', strong: midnight });
    } else {
      out.push({ t, label: dateLabel, sub: '', strong: true });
    }
  }
  return { ticks: out, step };
}

// ── 선분 자르기 (Liang–Barsky) ──
function clipSegment(x0, y0, x1, y1, r) {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dy = y1 - y0;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - r.x, r.x + r.w - x0, y0 - r.y, r.y + r.h - y0];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null; continue; }
    const t = q[i] / p[i];
    if (p[i] < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy];
}

function clipPolyline(pts, r) {
  const lines = [];
  let cur = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const c = clipSegment(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], r);
    if (!c) { if (cur) { lines.push(cur); cur = null; } continue; }
    const [ax, ay, bx, by] = c;
    if (cur && Math.abs(cur[cur.length - 1][0] - ax) < 0.01 && Math.abs(cur[cur.length - 1][1] - ay) < 0.01) {
      cur.push([bx, by]);
    } else {
      if (cur) lines.push(cur);
      cur = [[ax, ay], [bx, by]];
    }
    const clippedEnd = Math.abs(bx - pts[i + 1][0]) > 0.01 || Math.abs(by - pts[i + 1][1]) > 0.01;
    if (clippedEnd) { lines.push(cur); cur = null; }
  }
  if (cur) lines.push(cur);
  return lines;
}

const r1 = (v) => Math.round(v * 10) / 10;

// ── 기호 모양 ──
export function shapeItems(shape, cx, cy, r, { fill, stroke, width = 1.2 }) {
  switch (shape) {
    case 'square':
      return [{ type: 'rect', x: cx - r * 0.9, y: cy - r * 0.9, w: r * 1.8, h: r * 1.8, fill, stroke, strokeWidth: width }];
    case 'triangle':
      return [{ type: 'polygon', pts: [[cx, cy - r * 1.1], [cx + r, cy + r * 0.75], [cx - r, cy + r * 0.75]], fill, stroke, strokeWidth: width }];
    case 'triangleDown':
      return [{ type: 'polygon', pts: [[cx, cy + r * 1.1], [cx + r, cy - r * 0.75], [cx - r, cy - r * 0.75]], fill, stroke, strokeWidth: width }];
    case 'diamond':
      return [{ type: 'polygon', pts: [[cx, cy - r * 1.2], [cx + r * 1.05, cy], [cx, cy + r * 1.2], [cx - r * 1.05, cy]], fill, stroke, strokeWidth: width }];
    case 'cross':
      return [
        { type: 'line', x1: cx - r, y1: cy - r, x2: cx + r, y2: cy + r, stroke: stroke || fill, width: width + 0.4 },
        { type: 'line', x1: cx - r, y1: cy + r, x2: cx + r, y2: cy - r, stroke: stroke || fill, width: width + 0.4 },
      ];
    default:
      return [{ type: 'circle', cx, cy, r, fill, stroke, strokeWidth: width }];
  }
}

export const MARK_SHAPES = ['circle', 'square', 'triangle', 'diamond', 'triangleDown', 'cross'];

/** 달 모양 아이콘: 삭(●), 상현(오른쪽 밝음), 망(○), 하현(왼쪽 밝음) — 북반구 기준 */
function moonIcon(phase, cx, cy, r, color) {
  const items = [];
  const n = 16;
  const half = (side) => {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = -Math.PI / 2 + (Math.PI * i) / n;
      pts.push([cx + side * r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return pts;
  };
  if (phase === 'new') items.push({ type: 'circle', cx, cy, r, fill: color, stroke: color, strokeWidth: 1 });
  else if (phase === 'full') items.push({ type: 'circle', cx, cy, r, fill: '#ffffff', stroke: color, strokeWidth: 1.2 });
  else {
    items.push({ type: 'circle', cx, cy, r, fill: color, stroke: color, strokeWidth: 1 });
    // 밝은 쪽(흰색) 반원: 상현=오른쪽, 하현=왼쪽
    items.push({ type: 'polygon', pts: half(phase === 'first' ? 1 : -1), fill: '#ffffff', stroke: 'none' });
    items.push({ type: 'circle', cx, cy, r, fill: 'none', stroke: color, strokeWidth: 1.2 });
  }
  return items;
}

/**
 * @param {object} spec
 * @returns {{items:Array, plot:{x,y,w,h}, tToX:Function, xToT:Function, vToY:Function, yToV:Function, yDomain:number[]}}
 */
export function layoutChart(spec) {
  const items = [];
  const fs = spec.fontSize || 12;
  const small = fs - 1.5;
  const measure = spec.measure;
  const W = spec.width, Hh = spec.height;
  const [t0, t1] = spec.x.domain;
  const tz = spec.x.tz;

  // ── y 범위 ──
  let yDomain = spec.y.domain ? [...spec.y.domain] : null;
  if (!yDomain) {
    let min = Infinity, max = -Infinity;
    for (const s of spec.series || []) {
      if (s.kind === 'bars') {
        for (const b of s.bars) if (b.v != null && b.t1 >= t0 && b.t0 <= t1) { min = Math.min(min, b.v); max = Math.max(max, b.v); }
        continue;
      }
      const key = s.key || 'v';
      const pts = s.points || [];
      for (let i = lowerBound(pts, t0); i < pts.length && pts[i].t <= t1; i++) {
        const v = pts[i][key];
        if (v == null || Number.isNaN(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    for (const m of spec.marks || []) if (m.v != null && m.t >= t0 && m.t <= t1) { min = Math.min(min, m.v); max = Math.max(max, m.v); }
    if (spec.y.includeZero) { min = Math.min(min, 0); max = Math.max(max, 0); }
    if (min === Infinity) { min = 0; max = 1; }
    if (max - min < (spec.y.minSpan || 10)) {
      const c = (max + min) / 2, h = (spec.y.minSpan || 10) / 2;
      min = c - h; max = c + h;
    }
    const pad = (max - min) * (spec.y.pad ?? 0.1);
    yDomain = [min - pad, max + pad];
    if (spec.y.floorZero && yDomain[0] < 0 && min >= 0) yDomain[0] = 0;
  }

  // ── 위쪽 여백: 제목, 범례, 세로선 라벨 ──
  let top = 6;
  if (spec.header?.title) {
    items.push({ type: 'text', x: 2, y: top + fs + 1, text: spec.header.title, size: fs + 1.5, bold: true, fill: THEME.text });
    top += fs + 6;
    if (spec.header.subtitle) {
      items.push({ type: 'text', x: 2, y: top + small, text: spec.header.subtitle, size: small, fill: THEME.muted });
      top += small + 5;
    }
    top += 2;
  }
  const legend = spec.legend || [];
  let legendRows = [];
  if (legend.length) {
    // 범례 줄바꿈 배치
    let row = [], rowW = 0;
    const maxW = W - 8;
    for (const L of legend) {
      const w = 26 + measure(L.label, small) + 14;
      if (rowW + w > maxW && row.length) { legendRows.push(row); row = []; rowW = 0; }
      row.push({ ...L, w }); rowW += w;
    }
    if (row.length) legendRows.push(row);
  }
  const legendTop = top;
  top += legendRows.length * (small + 7);
  const vlines = (spec.vlines || []).filter((v) => v.t >= t0 && v.t <= t1);
  const labelRows = vlines.some((v) => v.label || v.icon) ? Math.max(1, ...vlines.map((v) => (v.row || 0) + 1)) : 0;
  const vlabelTop = top;
  top += labelRows * (small + 6);
  top += 4;

  // ── 왼쪽 여백: y 눈금 라벨 + y축 제목 ──
  const approxPlotH = Hh - top - (spec.x.hideAxisTitle ? 30 : 44);
  const yTicks = spec.y.ticks ? [...spec.y.ticks] : yTicksFor(yDomain, approxPlotH);
  const yLabelW = Math.max(...yTicks.map((t) => measure(t.label, small)), measure('000', small));
  const padLeft = spec.padLeft ?? (yLabelW + 8 + (spec.y.label ? small + 8 : 0) + 2);
  const padRight = spec.padRight ?? 14;
  const showSub = true;
  const bottom = (small + 4) + (showSub ? small + 3 : 0) + (spec.x.hideAxisTitle ? 4 : small + 10);
  const plot = { x: padLeft, y: top, w: Math.max(40, W - padLeft - padRight), h: Math.max(30, Hh - top - bottom) };

  // 고정 눈금(예: 풍향 북·동·남·서)이 좁은 그래프에서 겹치면 하나 걸러 표시
  if (spec.y.ticks && yTicks.length > 2 && plot.h / (yTicks.length - 1) < small * 1.7) {
    const thin = yTicks.filter((_, i) => i % 2 === 0);
    yTicks.length = 0;
    yTicks.push(...thin);
  }
  const tToX = (t) => plot.x + ((t - t0) / (t1 - t0)) * plot.w;
  const xToT = (x) => t0 + ((x - plot.x) / plot.w) * (t1 - t0);
  const vToY = (v) => plot.y + plot.h - ((v - yDomain[0]) / (yDomain[1] - yDomain[0])) * plot.h;
  const yToV = (y) => yDomain[0] + ((plot.y + plot.h - y) / plot.h) * (yDomain[1] - yDomain[0]);

  // ── 배경, 띠 ──
  items.push({ type: 'rect', x: plot.x, y: plot.y, w: plot.w, h: plot.h, fill: THEME.bg, stroke: 'none' });
  for (const b of spec.bands || []) {
    const a = Math.max(t0, b.t0), c = Math.min(t1, b.t1);
    if (c <= a) continue;
    items.push({ type: 'rect', x: tToX(a), y: plot.y, w: tToX(c) - tToX(a), h: plot.h, fill: b.fill, opacity: b.opacity ?? 0.15, stroke: b.stroke || 'none', strokeWidth: b.strokeWidth || 1, dash: b.dash });
  }

  // ── 격자, 눈금 ──
  const { ticks: xt, step: xStep } = timeTicks(t0, t1, tz, plot.w, spec.x.minTickSpacing || 46);
  for (const t of yTicks) {
    const y = vToY(t.v);
    if (y < plot.y - 0.5 || y > plot.y + plot.h + 0.5) continue;
    items.push({ type: 'line', x1: plot.x, y1: y, x2: plot.x + plot.w, y2: y, stroke: THEME.grid, width: 0.8 });
    items.push({ type: 'text', x: plot.x - 6, y: y + small * 0.35, text: t.label, size: small, anchor: 'end', fill: THEME.muted });
  }
  for (const t of xt) {
    const x = tToX(t.t);
    if (x < plot.x - 0.5 || x > plot.x + plot.w + 0.5) continue;
    items.push({ type: 'line', x1: x, y1: plot.y, x2: x, y2: plot.y + plot.h, stroke: t.strong && xStep < DAY ? THEME.gridStrong : THEME.grid, width: t.strong && xStep < DAY ? 1 : 0.8 });
    items.push({ type: 'line', x1: x, y1: plot.y + plot.h, x2: x, y2: plot.y + plot.h + 4, stroke: THEME.axis, width: 1 });
    items.push({ type: 'text', x, y: plot.y + plot.h + 6 + small, text: t.label, size: small, anchor: 'middle', fill: THEME.muted });
    if (t.sub) items.push({ type: 'text', x, y: plot.y + plot.h + 9 + small * 2, text: t.sub, size: small, anchor: 'middle', fill: THEME.text, bold: true });
  }
  if (spec.y.zeroLine && yDomain[0] < 0 && yDomain[1] > 0) {
    const y = vToY(0);
    items.push({ type: 'line', x1: plot.x, y1: y, x2: plot.x + plot.w, y2: y, stroke: '#2b3440', width: 1.3 });
    items.push({ type: 'text', x: plot.x + plot.w - 3, y: y - 4, text: spec.y.zeroLabel || '0 기준선', size: small - 0.5, anchor: 'end', fill: '#2b3440' });
  }

  // ── 자료 ──
  const clipRect = { x: plot.x - 0.5, y: plot.y - 0.5, w: plot.w + 1, h: plot.h + 1 };
  for (const s of spec.series || []) {
    if (s.kind === 'bars') {
      const base = vToY(Math.max(yDomain[0], Math.min(yDomain[1], 0)));
      for (const b of s.bars) {
        if (b.t1 <= t0 || b.t0 >= t1) continue;
        const xa = tToX(Math.max(t0, b.t0)), xb = tToX(Math.min(t1, b.t1));
        const gap = Math.min(2.5, (xb - xa) * 0.18);
        const x = xa + gap, w = Math.max(1, xb - xa - gap * 2);
        if (b.v == null) {
          items.push({ type: 'text', x: x + w / 2, y: base - 4, text: '없음', size: small - 2, anchor: 'middle', fill: THEME.muted });
          continue;
        }
        const y = vToY(b.v);
        if (b.hollow) {
          items.push({ type: 'rect', x, y, w, h: base - y, fill: '#ffffff', stroke: '#6b7684', strokeWidth: 1.2, dash: [3, 2] });
        } else {
          items.push({ type: 'rect', x, y, w, h: base - y, fill: b.color || s.color, stroke: b.selected ? '#0b1f3a' : 'none', strokeWidth: b.selected ? 2 : 0 });
        }
        if (b.focus) items.push({ type: 'rect', x: x - 2, y: y - 2, w: w + 4, h: base - y + 2, fill: 'none', stroke: '#d9480f', strokeWidth: 2 });
        if (b.label) {
          const lw = measure(b.label, small) + 6;
          const ly = Math.max(plot.y + small + 2, y - 5);
          items.push({ type: 'rect', x: x + w / 2 - lw / 2, y: ly - small, w: lw, h: small + 3, fill: '#0b1f3a', stroke: 'none' });
          items.push({ type: 'text', x: x + w / 2, y: ly, text: b.label, size: small, anchor: 'middle', fill: '#ffffff', bold: true });
        } else if (b.hollow) {
          items.push({ type: 'text', x: x + w / 2, y: Math.max(plot.y + small, y - 4), text: '!', size: small, anchor: 'middle', fill: '#6b7684', bold: true });
        }
      }
      continue;
    }
    const key = s.key || 'v';
    const pts = s.points || [];
    // 보이는 범위 + 양쪽 1개
    const i0 = Math.max(0, lowerBound(pts, t0) - 1);
    let i1 = lowerBound(pts, t1);
    i1 = Math.min(pts.length, i1 + 1);
    const vis = pts.slice(i0, i1);
    if (s.kind === 'dots') {
      for (const p of vis) {
        const v = p[key];
        if (v == null || p.t < t0 || p.t > t1) continue;
        items.push(...shapeItems(s.marker || 'circle', tToX(p.t), vToY(v), s.markerSize || 2.6, { fill: s.color, stroke: s.color, width: 1 }));
      }
      continue;
    }
    const segs = segments(vis, s.maxGapMs ?? Infinity, key);
    const visibleCount = vis.filter((p) => p.t >= t0 && p.t <= t1).length;
    const dense = visibleCount > 0 ? plot.w / visibleCount : 0;
    for (const seg of segs) {
      const xy = seg.map((p) => [tToX(p.t), vToY(p[key])]);
      if (seg.length === 1) {
        const [x, y] = xy[0];
        if (x >= plot.x && x <= plot.x + plot.w) items.push({ type: 'circle', cx: x, cy: y, r: (s.width || 1.6) + 1.2, fill: s.color, stroke: s.color, strokeWidth: 1 });
        continue;
      }
      for (const line of clipPolyline(xy, clipRect)) {
        items.push({ type: 'polyline', pts: line.map(([x, y]) => [r1(x), r1(y)]), stroke: s.color, width: s.width || 1.6, dash: s.dash });
      }
    }
    // 실제 관측점 표시 (간격이 충분할 때만)
    if (s.dots && dense >= (s.dotMinSpacing || 5)) {
      for (const p of vis) {
        const v = p[key];
        if (v == null || p.t < t0 || p.t > t1) continue;
        items.push({ type: 'circle', cx: tToX(p.t), cy: vToY(v), r: s.dotR || 1.7, fill: s.dotFill || s.color, stroke: s.color, strokeWidth: 0.8 });
      }
    }
    // 품질 의심 자료 표시
    if (s.flagSuspect) {
      for (const p of vis) {
        if (p.q !== 'suspect' || p[key] == null || p.t < t0 || p.t > t1) continue;
        items.push(...shapeItems('diamond', tToX(p.t), vToY(p[key]), 4.2, { fill: '#ffffff', stroke: '#9a3412', width: 1.4 }));
      }
    }
  }

  // ── 세로선(주요 시각, 달의 위상) ──
  for (const v of vlines) {
    const x = tToX(v.t);
    items.push({ type: 'line', x1: x, y1: plot.y, x2: x, y2: plot.y + plot.h, stroke: v.color || '#6b7684', width: v.width || 1.2, dash: v.dash || [4, 3] });
    const ly = vlabelTop + (v.row || 0) * (small + 6) + small;
    let lx = x;
    const text = v.label || '';
    const tw = measure(text, small - 0.5) + (v.icon ? 13 : 0);
    let anchor = 'middle';
    if (lx - tw / 2 < 2) anchor = 'start';
    else if (lx + tw / 2 > W - 2) anchor = 'end';
    let startX = anchor === 'middle' ? lx - tw / 2 : anchor === 'start' ? Math.max(2, lx - 4) : Math.min(W - 2, lx + 4) - tw;
    if (v.icon) {
      items.push(...moonIcon(v.icon, startX + 5, ly - small * 0.35, 4.6, v.color || '#3b4652'));
      startX += 13;
    }
    if (text) items.push({ type: 'text', x: startX, y: ly, text, size: small - 0.5, anchor: 'start', fill: v.textColor || v.color || THEME.text, bold: !!v.bold });
    items.push({ type: 'line', x1: x, y1: ly + 3, x2: x, y2: plot.y, stroke: v.color || '#6b7684', width: 0.8, dash: [1, 2] });
  }

  // ── 커서 ──
  if (spec.cursor && spec.cursor.t >= t0 && spec.cursor.t <= t1) {
    const x = tToX(spec.cursor.t);
    items.push({ type: 'line', x1: x, y1: plot.y, x2: x, y2: plot.y + plot.h, stroke: '#0b1f3a', width: 1.4 });
  }

  // ── 선택 지점 ──
  for (const m of spec.marks || []) {
    if (m.t < t0 || m.t > t1) continue;
    const x = tToX(m.t);
    if (m.vline) items.push({ type: 'line', x1: x, y1: plot.y, x2: x, y2: plot.y + plot.h, stroke: m.color || '#d9480f', width: 1.1, dash: [2, 2] });
    if (m.v == null) {
      // 값이 없는 시각: 위쪽에 기호만
      const lw = measure(m.label, small) + 8;
      items.push({ type: 'rect', x: x - lw / 2, y: plot.y + 2, w: lw, h: small + 4, fill: m.color || '#d9480f', stroke: 'none' });
      items.push({ type: 'text', x, y: plot.y + small + 3, text: m.label, size: small, anchor: 'middle', fill: '#ffffff', bold: true });
      continue;
    }
    const y = vToY(m.v);
    if (y < plot.y - 1 || y > plot.y + plot.h + 1) continue;
    items.push(...shapeItems(m.shape || 'circle', x, y, m.r || 5, { fill: m.fill || m.color || '#d9480f', stroke: m.stroke || '#ffffff', width: 1.4 }));
    if (m.label) {
      const lw = measure(m.label, small) + 8;
      const lh = small + 4;
      const above = m.labelPos !== 'below' && y - 9 - lh > plot.y;
      const ly = above ? y - 9 - lh : Math.min(plot.y + plot.h - lh, y + 9);
      let lx = x - lw / 2;
      lx = Math.max(plot.x, Math.min(plot.x + plot.w - lw, lx));
      items.push({ type: 'rect', x: lx, y: ly, w: lw, h: lh, fill: m.labelFill || '#ffffff', stroke: m.color || '#d9480f', strokeWidth: 1.2 });
      items.push({ type: 'text', x: lx + lw / 2, y: ly + lh - 3.5, text: m.label, size: small, anchor: 'middle', fill: m.labelColor || m.color || '#d9480f', bold: true });
    }
  }

  // ── 축선, 축 제목 ──
  items.push({ type: 'line', x1: plot.x, y1: plot.y + plot.h, x2: plot.x + plot.w, y2: plot.y + plot.h, stroke: THEME.axis, width: 1 });
  items.push({ type: 'line', x1: plot.x, y1: plot.y, x2: plot.x, y2: plot.y + plot.h, stroke: THEME.axis, width: 1 });
  if (spec.y.label) {
    items.push({ type: 'text', x: small + 1, y: plot.y + plot.h / 2, text: spec.y.label, size: small, anchor: 'middle', rotate: -90, fill: THEME.text });
  }
  if (spec.x.label && !spec.x.hideAxisTitle) {
    items.push({ type: 'text', x: plot.x + plot.w / 2, y: Hh - 3, text: spec.x.label, size: small, anchor: 'middle', fill: THEME.text });
  }

  // ── 범례 ──
  legendRows.forEach((row, ri) => {
    let x = 4;
    const y = legendTop + ri * (small + 7) + small;
    for (const L of row) {
      const cy = y - small * 0.35;
      if (L.kind === 'bar' || L.kind === 'barHollow') {
        items.push({ type: 'rect', x, y: cy - 5, w: 18, h: 10, fill: L.kind === 'barHollow' ? '#ffffff' : L.color, stroke: L.kind === 'barHollow' ? '#6b7684' : 'none', strokeWidth: 1.1, dash: L.kind === 'barHollow' ? [3, 2] : null });
      } else if (L.kind === 'marker') {
        items.push(...shapeItems(L.marker || 'circle', x + 9, cy, 4, { fill: L.fill || L.color, stroke: L.stroke || L.color, width: 1.3 }));
      } else if (L.kind === 'vline') {
        items.push({ type: 'line', x1: x + 9, y1: cy - 6, x2: x + 9, y2: cy + 6, stroke: L.color, width: 1.2, dash: L.dash });
      } else if (L.kind === 'moon') {
        items.push(...moonIcon(L.icon || 'full', x + 9, cy, 4.6, L.color || '#3b4652'));
      } else {
        items.push({ type: 'line', x1: x, y1: cy, x2: x + 22, y2: cy, stroke: L.color, width: L.width || 1.8, dash: L.dash });
        if (L.marker) items.push(...shapeItems(L.marker, x + 11, cy, 2.6, { fill: L.color, stroke: L.color, width: 1 }));
      }
      items.push({ type: 'text', x: x + 26, y, text: L.label, size: small, fill: THEME.text });
      x += L.w;
    }
  });

  if (spec.message) {
    const mw = measure(spec.message, fs) + 24;
    items.push({ type: 'rect', x: plot.x + plot.w / 2 - mw / 2, y: plot.y + plot.h / 2 - fs - 4, w: mw, h: fs * 2 + 4, fill: '#f4f6f8', stroke: '#c5ced8', strokeWidth: 1 });
    items.push({ type: 'text', x: plot.x + plot.w / 2, y: plot.y + plot.h / 2 + fs * 0.35, text: spec.message, size: fs, anchor: 'middle', fill: THEME.muted, bold: true });
  }

  return { items, plot, tToX, xToT, vToY, yToV, yDomain, width: W, height: Hh };
}

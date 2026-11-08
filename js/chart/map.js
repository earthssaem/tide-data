// 우리나라 지도(해안선) — 관측소 위치와 태풍 경로 표시
// 해안선: Natural Earth(단순화). 위치 안내용이며 거리 계산에는 쓰지 않는다.
// 결과는 그래프와 같은 '그리기 목록' 형식이라 화면(SVG)과 PDF(벡터)에 같이 쓴다.

import { fmtDateTime } from '../util/time.js';

let MAP = null;
let loading = null;
export const MAP_URL = 'data/map/korea-land.json';

/** 지도 자료 미리 읽기(실패하면 지도 없이 진행) */
export function loadKoreaMap() {
  if (MAP) return Promise.resolve(MAP);
  if (!loading) {
    loading = (async () => {
      try {
        const res = await fetch(MAP_URL);
        MAP = res.ok ? await res.json() : null;
      } catch { MAP = null; }
      return MAP;
    })();
  }
  return loading;
}
export const koreaMapSync = () => MAP;
export function setKoreaMap(m) { MAP = m; }

const DEFAULT_BOX = { minX: 123.6, maxX: 131.4, minY: 32.6, maxY: 38.9 };

export function projection(box, width) {
  const kx = Math.cos((36 * Math.PI) / 180);
  const sc = width / ((box.maxX - box.minX) * kx);
  const height = Math.round((box.maxY - box.minY) * sc);
  return { X: (lon) => (lon - box.minX) * kx * sc, Y: (lat) => (box.maxY - lat) * sc, height };
}

/** 선분을 사각형 안으로 자르기(Liang–Barsky). 밖이면 null */
function clipSeg(x0, y0, x1, y1, w, h) {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dy = y1 - y0;
  const p = [-dx, dx, -dy, dy];
  const q = [x0, w - x0, y0, h - y0];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null; continue; }
    const r = q[i] / p[i];
    if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [[x0 + t0 * dx, y0 + t0 * dy], [x0 + t1 * dx, y0 + t1 * dy]];
}

/**
 * 태풍 경로 지도 그리기 목록
 * @param {{map, cd, view:[number,number], width:number, measure:Function, fontSize:number}} o
 */
export function trackMapLayout({ map, cd, view, width, measure, fontSize = 10 }) {
  const box = map?.bbox || DEFAULT_BOX;
  const titleH = fontSize + 10;
  const subH = fontSize;
  const top = titleH + subH + 6;
  const { X, Y, height: mapH } = projection(box, width);
  const items = [];
  const small = fontSize - 1.5;
  items.push({ type: 'text', x: 2, y: fontSize + 2, text: `태풍 경로와 관측소 위치 — ${cd.typhoon.name}`, size: fontSize + 1.5, bold: true, fill: '#1d2733' });
  items.push({ type: 'text', x: 2, y: titleH + subH - 1, text: `${cd.typhoon.trackKind || '태풍 중심 위치'} · 굵은 선: 그래프 표시 범위 무렵의 경로 · 지도 밖 경로는 생략`, size: small, fill: '#5b6675' });
  const oy = top;
  items.push({ type: 'rect', x: 0, y: oy, w: width, h: mapH, fill: '#eaf3f7', stroke: '#c5ced8', strokeWidth: 0.8 });
  for (const r of map?.rings || []) {
    items.push({ type: 'polygon', pts: r.map(([lo, la]) => [X(lo), Y(la) + oy]), fill: '#f6f4ee', stroke: '#9aa5b1', strokeWidth: 0.6 });
  }
  // 경로(지도 범위로 자름)
  const tr = cd.typhoon.track;
  const segs = [];
  for (let i = 1; i < tr.length; i++) {
    const a = tr[i - 1], b = tr[i];
    const c = clipSeg(X(a.lon), Y(a.lat), X(b.lon), Y(b.lat), width, mapH);
    if (!c) continue;
    const inView = a.t >= view[0] - 3 * 3600e3 && b.t <= view[1] + 3 * 3600e3;
    segs.push({ pts: c.map(([x, y]) => [x, y + oy]), inView });
  }
  for (const s of segs) items.push({ type: 'polyline', pts: s.pts, stroke: '#b42318', width: s.inView ? 2.6 : 1.2, dash: s.inView ? null : [4, 3] });
  // 경로 점과 시각(겹치지 않게 일부만 표시)
  let lastLabelY = -1e9;
  const visible = tr.filter((p) => { const x = X(p.lon), y = Y(p.lat); return x >= 0 && x <= width && y >= 0 && y <= mapH; });
  for (const p of visible) {
    const x = X(p.lon), y = Y(p.lat) + oy;
    items.push({ type: 'circle', cx: x, cy: y, r: 2.4, fill: '#b42318', stroke: '#ffffff', strokeWidth: 0.8 });
    if (Math.abs(y - lastLabelY) >= small + 4) {
      const label = fmtDateTime(p.t, cd.tz, { year: false });
      const right = x < width * 0.6;
      items.push({ type: 'text', x: right ? x + 5 : x - 5, y: y + small * 0.35, text: label, size: small - 0.5, fill: '#7a1f12', anchor: right ? 'start' : 'end' });
      lastLabelY = y;
    }
  }
  // 조위 관측소와 기상 관측 지점
  const st = cd.station;
  const sx = X(st.lon), sy = Y(st.lat) + oy;
  items.push({ type: 'rect', x: sx - 5, y: sy - 5, w: 10, h: 10, fill: '#1f3a68', stroke: '#ffffff', strokeWidth: 1.2 });
  const stLabel = `${st.name} 조위관측소`;
  const lw = measure(stLabel, small);
  const left = sx - 8 - lw > 0;
  items.push({ type: 'text', x: left ? sx - 9 : sx + 9, y: sy + small + 6, text: stLabel, size: small, bold: true, fill: '#1f3a68', anchor: left ? 'end' : 'start' });
  const ws = cd.weather?.station;
  if (ws?.lat != null && cd.weatherDistanceKm != null && cd.weatherDistanceKm >= 0.1) {
    items.push({ type: 'circle', cx: X(ws.lon), cy: Y(ws.lat) + oy, r: 3.2, fill: '#0f8b8d', stroke: '#ffffff', strokeWidth: 1 });
  }
  const legendY = oy + mapH + small + 6;
  items.push({ type: 'rect', x: 2, y: legendY - small + 1, w: 9, h: 9, fill: '#1f3a68' });
  items.push({ type: 'text', x: 15, y: legendY, text: '조위관측소', size: small, fill: '#1d2733' });
  const x2 = 15 + measure('조위관측소', small) + 14;
  items.push({ type: 'circle', cx: x2 + 4, cy: legendY - small / 2 + 1, r: 3, fill: '#b42318' });
  items.push({ type: 'text', x: x2 + 11, y: legendY, text: '태풍 중심 위치(시각은 KST)', size: small, fill: '#1d2733' });
  items.push({ type: 'text', x: width - 2, y: legendY, text: '해안선: Natural Earth(단순화)', size: small - 1, fill: '#5b6675', anchor: 'end' });
  return { items, width, height: legendY + 6 };
}

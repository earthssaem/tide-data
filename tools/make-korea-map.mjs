#!/usr/bin/env node
// 관측소 선택용 한반도 주변 해안선 만들기(개발할 때 한 번 실행)
//   node tools/make-korea-map.mjs <world-atlas/land-10m.json 경로>
// (TopoJSON은 직접 해석한다 — 외부 코드를 실행하지 않음)
// 원자료: Natural Earth 1:10m 육지(공공 도메인), world-atlas 패키지(ISC)로 배포된 TopoJSON
// 결과: data/map/korea-land.json — [경도, 위도] 다각형 고리 목록(범위로 자르고 단순화)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [landPath] = process.argv.slice(2);
if (!landPath) { console.error('사용: node tools/make-korea-map.mjs <land-10m.json>'); process.exit(1); }
const topo = JSON.parse(readFileSync(landPath, 'utf8'));

// TopoJSON 해석: 양자화된 호(arc)를 차분 복원 → 다각형 고리
const { scale: [sx, sy], translate: [tx, ty] } = topo.transform;
const arcs = topo.arcs.map((arc) => {
  let x = 0, y = 0;
  return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; });
});
function ringFromArcs(ids) {
  const out = [];
  for (const id of ids) {
    const a = id >= 0 ? arcs[id] : arcs[~id].slice().reverse();
    out.push(...(out.length ? a.slice(1) : a));
  }
  return out;
}
const geo = { features: topo.objects.land.geometries.map((g) => ({
  geometry: g.type === 'Polygon'
    ? { type: 'Polygon', coordinates: g.arcs.map(ringFromArcs) }
    : { type: 'MultiPolygon', coordinates: g.arcs.map((poly) => poly.map(ringFromArcs)) },
})) };

const BOX = { minX: 123.6, maxX: 131.4, minY: 32.6, maxY: 38.9 };

// 사각형으로 다각형 자르기(Sutherland–Hodgman)
function clipRing(ring) {
  const edges = [
    (p) => p[0] >= BOX.minX, (p) => p[0] <= BOX.maxX, (p) => p[1] >= BOX.minY, (p) => p[1] <= BOX.maxY,
  ];
  const cut = [
    (a, b) => { const t = (BOX.minX - a[0]) / (b[0] - a[0]); return [BOX.minX, a[1] + t * (b[1] - a[1])]; },
    (a, b) => { const t = (BOX.maxX - a[0]) / (b[0] - a[0]); return [BOX.maxX, a[1] + t * (b[1] - a[1])]; },
    (a, b) => { const t = (BOX.minY - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), BOX.minY]; },
    (a, b) => { const t = (BOX.maxY - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), BOX.maxY]; },
  ];
  let out = ring;
  for (let e = 0; e < 4; e++) {
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length];
      const ci = edges[e](cur), pi = edges[e](prev);
      if (ci) { if (!pi) out.push(cut[e](prev, cur)); out.push(cur); } else if (pi) out.push(cut[e](prev, cur));
    }
    if (!out.length) return [];
  }
  return out;
}
function simplify(ring, tol = 0.012) {
  const out = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (!q || Math.abs(p[0] - q[0]) > tol || Math.abs(p[1] - q[1]) > tol) out.push([Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000]);
  }
  return out;
}

const rings = [];
for (const f of geo.features) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) {
    const r = simplify(clipRing(poly[0]));
    if (r.length >= 4) rings.push(r);
  }
}
mkdirSync(join(ROOT, 'data', 'map'), { recursive: true });
writeFileSync(join(ROOT, 'data', 'map', 'korea-land.json'), JSON.stringify({
  source: 'Natural Earth 1:10m land (public domain), via world-atlas@2 land-10m.json (ISC)',
  bbox: BOX, note: '관측소 위치 안내용 단순화 해안선(측량·항해용 아님)', rings,
}));
console.log(`고리 ${rings.length}개, 점 ${rings.reduce((a, r) => a + r.length, 0)}개`);

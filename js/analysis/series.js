// 시계열 기본 연산 — 보간이나 임의 연결을 하지 않는다.

/** 정렬된 points에서 t 이상인 첫 인덱스 */
export function lowerBound(points, t) {
  let lo = 0, hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t < t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** 정확히 같은 시각의 자료 (없으면 null) */
export function pointAt(points, t) {
  const i = lowerBound(points, t);
  return i < points.length && points[i].t === t ? points[i] : null;
}

export function isValid(p, key = 'v') {
  return p != null && p[key] != null && !Number.isNaN(p[key]);
}

/**
 * 끊김 없는 구간으로 나눈다.
 * 값이 null이거나, 인접 자료의 시각 간격이 maxGapMs보다 크면 선을 끊는다.
 */
export function segments(points, maxGapMs, key = 'v') {
  const segs = [];
  let cur = [];
  let prevT = null;
  for (const p of points) {
    const ok = isValid(p, key);
    if (!ok) {
      if (cur.length) segs.push(cur);
      cur = []; prevT = null;
      continue;
    }
    if (prevT != null && p.t - prevT > maxGapMs) {
      if (cur.length) segs.push(cur);
      cur = [];
    }
    cur.push(p);
    prevT = p.t;
  }
  if (cur.length) segs.push(cur);
  return segs;
}

/** [t0, t1] 구간의 자료 (양 끝 포함) */
export function inRange(points, t0, t1) {
  const i0 = lowerBound(points, t0);
  const out = [];
  for (let i = i0; i < points.length && points[i].t <= t1; i++) out.push(points[i]);
  return out;
}

/** 구간 내 유효값의 최솟값·최댓값 */
export function extent(points, t0, t1, key = 'v') {
  let min = Infinity, max = -Infinity;
  for (const p of inRange(points, t0, t1)) {
    if (!isValid(p, key)) continue;
    if (p[key] < min) min = p[key];
    if (p[key] > max) max = p[key];
  }
  return min === Infinity ? null : [min, max];
}

/** 시각 t에 가장 가까운 유효 자료 (선택 지점은 반드시 실제 자료여야 함) */
export function nearestValid(points, t, { key = 'v', maxDistMs = Infinity, t0 = -Infinity, t1 = Infinity } = {}) {
  const i = lowerBound(points, t);
  let best = null, bestD = Infinity;
  for (let j = i; j < points.length; j++) {
    const d = points[j].t - t;
    if (d > bestD) break;
    if (points[j].t > t1) break;
    if (isValid(points[j], key) && points[j].t >= t0) { if (d < bestD) { best = points[j]; bestD = d; } break; }
  }
  for (let j = i - 1; j >= 0; j--) {
    const d = t - points[j].t;
    if (d >= bestD) break;
    if (points[j].t < t0) break;
    if (isValid(points[j], key) && points[j].t <= t1) { best = points[j]; bestD = d; break; }
  }
  return best && bestD <= maxDistMs ? best : null;
}

/** 다음/이전 유효 자료 (키보드 이동용) */
export function stepValid(points, t, dir, key = 'v') {
  let i = lowerBound(points, t);
  if (dir > 0) {
    if (i < points.length && points[i].t === t) i++;
    for (; i < points.length; i++) if (isValid(points[i], key)) return points[i];
  } else {
    for (i = i - 1; i >= 0; i--) if (isValid(points[i], key)) return points[i];
  }
  return null;
}

/** 두 지점 사이의 시간 차이(ms)와 높이 차이(b − a) */
export function pairDiff(a, b) {
  if (!a || !b) return null;
  return {
    dtMs: b.t - a.t,
    dv: a.v == null || b.v == null ? null : round(b.v - a.v),
  };
}

function round(v) { return Math.round(v * 1e6) / 1e6; }

export function dataDomain(points) {
  if (!points.length) return null;
  return [points[0].t, points[points.length - 1].t];
}

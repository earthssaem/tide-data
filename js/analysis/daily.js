// 일별 해수면 변동 폭
// 정의: 해당 날짜(사례 시간대 00:00 이상 ~ 다음날 00:00 미만)의 관측 최고값 − 관측 최저값
// 인접한 만조·간조 한 쌍의 조차와는 다른 값이다.
// 자료가 빠진 날(불완전한 날)은 complete=false로 표시하고, 완전한 날과 같은 조건으로 비교하지 않는다.

import { DAY, dayKey, startOfDay } from '../util/time.js';
import { lowerBound, isValid } from './series.js';

/**
 * @param {Array<{t,v,q}>} points 정렬된 관측 조위
 * @param {{offsetMinutes}} tz
 * @param {number} intervalMs 관측 간격
 * @param {number} t0 구간 시작(포함)
 * @param {number} t1 구간 끝(미포함)
 */
export function dailyRanges(points, tz, intervalMs, t0, t1) {
  const out = [];
  const expected = Math.round(DAY / intervalMs);
  for (let ds = startOfDay(t0, tz); ds < t1; ds += DAY) {
    const de = ds + DAY;
    let max = null, min = null, valid = 0, suspect = 0, present = 0;
    for (let i = lowerBound(points, ds); i < points.length && points[i].t < de; i++) {
      const p = points[i];
      present++;
      if (!isValid(p)) continue;
      valid++;
      if (p.q === 'suspect') suspect++;
      if (!max || p.v > max.v) max = { t: p.t, v: p.v, q: p.q };
      if (!min || p.v < min.v) min = { t: p.t, v: p.v, q: p.q };
    }
    const complete = valid === expected;
    out.push({
      day: dayKey(ds, tz),
      start: ds,
      end: de,
      expected,
      valid,
      present,
      missing: expected - valid,
      suspect,
      complete,
      max,
      min,
      range: max && min ? Math.round((max.v - min.v) * 1e6) / 1e6 : null,
    });
  }
  return out;
}

export function dayByKey(days, key) {
  return days.find((d) => d.day === key) || null;
}

// 조위 잔차 = 같은 시각의 관측 조위 − 예측 조위
// 같은 관측소·같은 높이 기준면·같은 단위인지 먼저 확인하고,
// 시각이 정확히 일치하는 자료끼리만 비교한다(가까운 값 연결·보간 없음).

import { pointAt, isValid } from './series.js';

export function checkComparable(obs, pred) {
  const problems = [];
  if (!obs) problems.push('관측 조위 자료가 없습니다.');
  if (!pred) problems.push('예측 조위 자료가 제공되지 않았습니다.');
  if (problems.length) return { ok: false, problems };
  if (obs.stationId !== pred.stationId) {
    problems.push(`관측소가 다릅니다 (관측: ${obs.stationId}, 예측: ${pred.stationId}).`);
  }
  if (obs.datumConfirmed === false || pred.datumConfirmed === false) {
    problems.push('높이 기준면이 확인되지 않아 관측값과 예측값이 같은 기준면인지 알 수 없습니다. 기준면을 공식 자료로 확인하기 전에는 잔차를 계산하지 않습니다.');
  } else if (obs.datum !== pred.datum) {
    problems.push(`높이 기준면이 다릅니다 (관측: ${obs.datumLabel}, 예측: ${pred.datumLabel}). 기준면을 맞추는 변환을 전처리에서 먼저 수행해야 합니다.`);
  }
  if (obs.unit !== pred.unit) {
    problems.push(`단위가 다릅니다 (관측: ${obs.unit}, 예측: ${pred.unit}).`);
  }
  return { ok: problems.length === 0, problems };
}

/**
 * @returns {{ok, problems, points:[{t,v,obs,pred}], matched, obsOnly, predOnly}}
 *   points의 v는 두 값이 모두 있을 때만 숫자, 아니면 null
 */
export function computeResidual(obs, pred) {
  const check = checkComparable(obs, pred);
  if (!check.ok) return { ...check, points: [], matched: 0, obsOnly: 0, predOnly: 0 };
  const points = [];
  let matched = 0, obsOnly = 0;
  const times = new Set();
  for (const o of obs.points) {
    times.add(o.t);
    const p = pointAt(pred.points, o.t);
    const ov = isValid(o) ? o.v : null;
    const pv = isValid(p) ? p.v : null;
    if (!p) obsOnly++;
    const v = ov != null && pv != null ? Math.round((ov - pv) * 1e6) / 1e6 : null;
    if (v != null) matched++;
    points.push({ t: o.t, v, obs: ov, pred: pv, q: o.q });
  }
  const predOnly = pred.points.filter((p) => !times.has(p.t)).length;
  return { ok: true, problems: [], points, matched, obsOnly, predOnly };
}

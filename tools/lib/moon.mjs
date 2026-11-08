// 달의 위상 시각 계산 (Meeus, Astronomical Algorithms 2판, 49장)
// 주요 보정항만 사용(행성 보정항 생략) — 오차 약 1~2분. 2022-09-10 망, 2024-04-08 삭 등 알려진 시각과 비교해 확인함.
// 결과는 계산값이며 공식 발표 자료(한국천문연구원 월력요항)를 대신하지 않는다.

export function moonPhaseJDE(k) {
  const rad = Math.PI / 180;
  const T = k / 1236.85;
  let jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T * T - 0.00000015 * T ** 3 + 0.00000000073 * T ** 4;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  const M = (2.5534 + 29.1053567 * k - 0.0000014 * T * T - 0.00000011 * T ** 3) * rad;
  const Mp = (201.5643 + 385.81693528 * k + 0.0107582 * T * T + 0.00001238 * T ** 3 - 0.000000058 * T ** 4) * rad;
  const F = (160.7108 + 390.67050284 * k - 0.0016118 * T * T - 0.00000227 * T ** 3 + 0.000000011 * T ** 4) * rad;
  const Om = (124.7746 - 1.56375588 * k + 0.0020672 * T * T + 0.00000215 * T ** 3) * rad;
  const frac = ((k % 1) + 1) % 1;
  const s = Math.sin, c = Math.cos;
  let corr;
  if (frac < 0.01 || frac > 0.99) {
    corr = -0.4072 * s(Mp) + 0.17241 * E * s(M) + 0.01608 * s(2 * Mp) + 0.01039 * s(2 * F) + 0.00739 * E * s(Mp - M)
      - 0.00514 * E * s(Mp + M) + 0.00208 * E * E * s(2 * M) - 0.00111 * s(Mp - 2 * F) - 0.00057 * s(Mp + 2 * F)
      + 0.00056 * E * s(2 * Mp + M) - 0.00042 * s(3 * Mp) + 0.00042 * E * s(M + 2 * F) + 0.00038 * E * s(M - 2 * F)
      - 0.00024 * E * s(2 * Mp - M) - 0.00017 * s(Om);
  } else if (Math.abs(frac - 0.5) < 0.01) {
    corr = -0.40614 * s(Mp) + 0.17302 * E * s(M) + 0.01614 * s(2 * Mp) + 0.01043 * s(2 * F) + 0.00734 * E * s(Mp - M)
      - 0.00515 * E * s(Mp + M) + 0.00209 * E * E * s(2 * M) - 0.00111 * s(Mp - 2 * F) - 0.00057 * s(Mp + 2 * F)
      + 0.00056 * E * s(2 * Mp + M) - 0.00042 * s(3 * Mp) + 0.00042 * E * s(M + 2 * F) + 0.00038 * E * s(M - 2 * F)
      - 0.00024 * E * s(2 * Mp - M) - 0.00017 * s(Om);
  } else {
    corr = -0.62801 * s(Mp) + 0.17172 * E * s(M) - 0.01183 * E * s(Mp + M) + 0.00862 * s(2 * Mp) + 0.00804 * s(2 * F)
      + 0.00454 * E * s(Mp - M) + 0.00204 * E * E * s(2 * M) - 0.0018 * s(Mp - 2 * F) - 0.0007 * s(Mp + 2 * F)
      - 0.0004 * s(3 * Mp) - 0.00034 * E * s(2 * Mp - M) + 0.00032 * E * s(M + 2 * F) + 0.00032 * E * s(M - 2 * F)
      - 0.00028 * E * E * s(Mp + 2 * M) + 0.00027 * E * s(2 * Mp + M) - 0.00017 * s(Om);
    const W = 0.00306 - 0.00038 * E * c(M) + 0.00026 * c(Mp) - 0.00002 * c(Mp - M) + 0.00002 * c(Mp + M) + 0.00002 * c(2 * F);
    corr += Math.abs(frac - 0.25) < 0.01 ? W : -W;
  }
  return jde + corr;
}

function deltaTSeconds(year) {
  // Espenak & Meeus 다항식 근사
  if (year < 2050) { const t = year - 2000; return 62.92 + 0.32217 * t + 0.005589 * t * t; }
  const u = (year - 1820) / 100;
  return -20 + 32 * u * u - 0.5628 * (2150 - year);
}

export function moonPhasesBetween(t0, t1) {
  const out = [];
  const y0 = new Date(t0).getUTCFullYear() + new Date(t0).getUTCMonth() / 12;
  let k = Math.floor((y0 - 2000) * 12.3685) - 2;
  const names = ['new', 'first', 'full', 'last'];
  for (let i = 0; i < 200; i++) {
    for (let q = 0; q < 4; q++) {
      const kk = k + q / 4;
      const jde = moonPhaseJDE(kk);
      const tTT = (jde - 2440587.5) * 86400e3;
      const year = new Date(tTT).getUTCFullYear();
      const t = tTT - deltaTSeconds(year) * 1000;
      if (t >= t0 && t < t1) out.push({ t, phase: names[q] });
      if (t >= t1) return out;
    }
    k += 1;
  }
  return out;
}


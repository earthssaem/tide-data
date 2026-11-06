// 근거(현재 분석 상태의 고정 사본) 만들기와 표 구성
// 근거는 추가한 시점의 분석 상태와 측정값을 깊은 복사로 보관한다.
// 이후 그래프를 움직여도 근거는 바뀌지 않는다(학생이 '교체'나 '삭제'를 눌러야만 바뀜).

import { pairDiff } from '../analysis/series.js';
import { obsPointAt, predAt, residualAt, weatherAt, inq2Days, inq2DetailView, BOTTOM_KINDS } from '../chart/specs.js';
import { fmtDateTime, fmtDuration, hoursDecimal, fmtRange, fmtDateKo, DAY } from '../util/time.js';
import { fmtValue, fmtSignedValue, fmtWindDir, fmtNum } from '../util/format.js';

const clone = (o) => JSON.parse(JSON.stringify(o));

function datasetsFor(cd, inquiry, state) {
  const out = [{ label: `관측 조위 (${cd.observed.label})`, identifier: cd.observed.meta.identifier || cd.dataVersion }];
  if (inquiry === 2 && state.showMoon && cd.moon) out.push({ label: '달의 위상', identifier: cd.moon.meta.identifier || '' });
  if (inquiry === 3) {
    if (cd.predicted) out.push({ label: '천문조 예측 조위', identifier: cd.predicted.meta.identifier || '' });
    if (cd.residual?.ok) out.push({ label: '조위 잔차(관측 − 예측)', identifier: '앱에서 같은 시각끼리 계산' });
    if (cd.weather) out.push({ label: `기상: ${BOTTOM_KINDS[state.bottom || 'pressure'].label} 그래프 표시`, identifier: cd.weather.meta.identifier || '' });
  }
  return out;
}

/** 비교할 두 기호: 학생이 고른 쌍이 유효하면 그 쌍, 아니면 처음과 마지막 */
export function effectivePair(pair, items) {
  if (items.length < 2) return null;
  const labels = items.map((x) => x.label);
  if (Array.isArray(pair) && pair.length === 2 && labels.includes(pair[0]) && labels.includes(pair[1])) return pair;
  return [labels[0], labels[labels.length - 1]];
}

export function inq1Values(cd, a) {
  const points = (a.points || []).map((p) => {
    const op = obsPointAt(cd, p.t);
    return { label: p.label, t: p.t, v: op?.v ?? null, q: op?.q ?? 'missing' };
  });
  const diffs = [];
  for (let i = 1; i < points.length; i++) {
    const d = pairDiff(points[i - 1], points[i]);
    diffs.push({ from: points[i - 1].label, to: points[i].label, ...d });
  }
  const pair = effectivePair(a.pair, points);
  if (pair) {
    const A = points.find((p) => p.label === pair[0]);
    const B = points.find((p) => p.label === pair[1]);
    const consecutive = diffs.some((d) => d.from === pair[0] && d.to === pair[1]);
    if (A && B && A !== B && !consecutive) diffs.push({ from: A.label, to: B.label, ...pairDiff(A, B), custom: true });
  }
  return { kind: 'inq1', points, diffs };
}

export function inq2Values(cd, a) {
  const days = inq2Days(cd);
  const sel = (a.selectedDays || []).map((s) => {
    const d = days.find((x) => x.day === s.day);
    return {
      label: s.label, day: s.day, start: d?.start ?? null,
      range: d?.range ?? null, max: d?.max ?? null, min: d?.min ?? null,
      complete: d?.complete ?? false, valid: d?.valid ?? 0, expected: d?.expected ?? 0,
    };
  });
  const intervals = [];
  for (let i = 1; i < sel.length; i++) {
    if (sel[i - 1].start != null && sel[i].start != null) {
      intervals.push({ from: sel[i - 1].label, to: sel[i].label, days: Math.round((sel[i].start - sel[i - 1].start) / DAY) });
    }
  }
  const pair = effectivePair(a.pair, sel);
  if (pair) {
    const A = sel.find((s) => s.label === pair[0]);
    const B = sel.find((s) => s.label === pair[1]);
    const consecutive = intervals.some((d) => d.from === pair[0] && d.to === pair[1]);
    if (A && B && A !== B && !consecutive && A.start != null && B.start != null) {
      intervals.push({ from: A.label, to: B.label, days: Math.round((B.start - A.start) / DAY), custom: true });
    }
  }
  const moon = a.showMoon && cd.moon ? cd.moon.phases.filter((p) => p.t >= cd.ranges.inq2[0] - 3 * DAY && p.t <= cd.ranges.inq2[1] + 3 * DAY).map((p) => ({ t: p.t, label: p.label, lunar: p.lunar })) : null;
  return { kind: 'inq2', days: sel, intervals, focusDay: a.focusDay, moonShown: !!a.showMoon, moon };
}

export function inq3Values(cd, a) {
  const marks = (a.marks || []).map((m) => {
    const op = obsPointAt(cd, m.t);
    const w = weatherAt(cd, m.t);
    return {
      label: m.label, t: m.t,
      obs: op?.v ?? null, obsQ: op?.q ?? null,
      pred: predAt(cd, m.t), res: residualAt(cd, m.t),
      pressure: w?.pressure ?? null, windSpeed: w?.windSpeed ?? null, windDir: w?.windDir ?? null,
    };
  });
  return {
    kind: 'inq3', marks, bottom: a.bottom || 'pressure',
    residualOk: !!cd.residual?.ok,
    weatherStation: cd.weather?.station?.name || null,
    weatherDistanceKm: cd.weatherDistanceKm,
  };
}

export function currentValues(cd, inquiry, a) {
  if (inquiry === 1) return inq1Values(cd, a);
  if (inquiry === 2) return inq2Values(cd, a);
  return inq3Values(cd, a);
}

/** 현재 화면 상태로 근거 내용을 만든다(id·번호 제외) */
export function snapshotEvidence(cd, inquiry, analysisState) {
  const st = clone(analysisState);
  if (inquiry === 1) st.view = st.view || cd.ranges.inq1;
  if (inquiry === 2) st.detailView = st.detailView || inq2DetailView(cd, st);
  if (inquiry === 3) st.view = st.view || cd.ranges.inq3;
  const values = currentValues(cd, inquiry, st);
  const period = inquiry === 2 ? [...cd.ranges.inq2] : [...st.view];
  return {
    inquiry,
    caseId: cd.id,
    dataVersion: cd.dataVersion,
    station: cd.station.name,
    datasets: datasetsFor(cd, inquiry, st),
    period,
    state: st,
    values,
    summary: summarize(cd, values),
  };
}

export function summarize(cd, v) {
  if (v.kind === 'inq1') {
    if (!v.points.length) return '선택 지점 없음';
    return `지점 ${v.points.map((p) => p.label).join('·')} ${v.points.length}개` + (v.diffs.length ? ` · 차이 ${v.diffs.length}건` : '');
  }
  if (v.kind === 'inq2') {
    if (!v.days.length) return '선택 날짜 없음';
    return `날짜 ${v.days.map((d) => d.label).join('·')} ${v.days.length}개${v.moonShown ? ' · 달의 위상 표시' : ''}`;
  }
  if (!v.marks.length) return '선택 시각 없음';
  return `시각 ${v.marks.map((m) => m.label).join('·')} ${v.marks.length}개 · 아래 그래프: ${BOTTOM_KINDS[v.bottom].label}`;
}

const qualityText = (q) => ({ ok: '정상', suspect: '의심', bad: '오류', missing: '결측' })[q] || '—';

/**
 * 근거의 측정값 표 — 미리보기와 PDF가 같은 표를 사용한다.
 * @returns {{meta: Array<[string,string]>, tables: Array<{title, head, rows, note?}>}}
 */
export function evidenceTables(cd, ev) {
  const tz = cd.tz;
  const v = ev.values;
  const meta = [
    ['관측소', ev.station],
    ['자료 종류', ev.datasets.map((d) => d.label).join(', ')],
    ['자료 식별자', [ev.dataVersion, ...ev.datasets.map((d) => d.identifier).filter(Boolean)].filter((x, i, a) => a.indexOf(x) === i).join(', ')],
  ];
  const tables = [];
  if (v.kind === 'inq1') {
    meta.push(['표시 범위', fmtRange(ev.state.view[0], ev.state.view[1], tz)]);
    tables.push({
      title: '선택 지점 (1시간 간격 관측값)',
      head: ['기호', '시각', '조위', '품질'],
      rows: v.points.map((p) => [p.label, fmtDateTime(p.t, tz), fmtValue(p.v, 'cm'), qualityText(p.q)]),
      empty: '선택한 지점이 없습니다.',
    });
    if (v.diffs.length) {
      tables.push({
        title: '지점 사이의 차이 (뒤 지점 − 앞 지점)',
        head: ['구간', '시간 차이', '높이 차이'],
        rows: v.diffs.map((d) => [`${d.from} → ${d.to}`, `${fmtDuration(d.dtMs)} (${hoursDecimal(d.dtMs)}시간)`, fmtSignedValue(d.dv, 'cm')]),
      });
    }
  } else if (v.kind === 'inq2') {
    meta.push(['분석 기간', fmtRange(cd.ranges.inq2[0], cd.ranges.inq2[1], tz)]);
    meta.push(['확대 그래프 범위', fmtRange(ev.state.detailView[0], ev.state.detailView[1], tz)]);
    meta.push(['달의 위상 표시', v.moonShown ? '켬' : '끔']);
    tables.push({
      title: '선택 날짜의 일별 해수면 변동 폭 (그날 관측 최고값 − 관측 최저값)',
      head: ['기호', '날짜', '변동 폭', '관측 최고값(시각)', '관측 최저값(시각)', '자료 상태'],
      rows: v.days.map((d) => [
        d.label,
        d.start != null ? fmtDateKo(d.start, tz) : d.day,
        d.range == null ? '자료 없음' : `${fmtNum(d.range)} cm`,
        d.max ? `${fmtNum(d.max.v)} cm (${fmtDateTime(d.max.t, tz, { year: false }).slice(6)})` : '—',
        d.min ? `${fmtNum(d.min.v)} cm (${fmtDateTime(d.min.t, tz, { year: false }).slice(6)})` : '—',
        d.complete ? `완전 (${d.valid}/${d.expected})` : `불완전 (${d.valid}/${d.expected}, 비교 주의)`,
      ]),
      empty: '선택한 날짜가 없습니다.',
      note: '1시간 간격 관측값 중의 최고·최저값이며, 연속 관측의 실제 최고·최저값과 다를 수 있습니다.',
    });
    if (v.intervals.length) {
      tables.push({
        title: '선택 날짜 사이의 간격',
        head: ['구간', '날짜 간격'],
        rows: v.intervals.map((d) => [`${d.from} → ${d.to}`, `${d.days}일`]),
      });
    }
    if (v.moon && v.moon.length) {
      tables.push({
        title: '달의 위상 (자료 기준 시각)',
        head: ['위상', '시각', '음력'],
        rows: v.moon.map((m) => [m.label, fmtDateTime(m.t, tz), m.lunar || '자료 미제공']),
      });
    }
  } else {
    meta.push(['표시 범위', fmtRange(ev.state.view[0], ev.state.view[1], tz)]);
    if (v.weatherStation) meta.push(['기상 관측 지점', `${v.weatherStation}${v.weatherDistanceKm != null ? ` (조위 관측소에서 약 ${v.weatherDistanceKm.toFixed(0)} km)` : ''}`]);
    tables.push({
      title: '선택 시각의 값 (잔차 = 같은 시각의 관측 − 예측)',
      head: ['기호', '시각', '관측 조위', '예측 조위', '잔차', '기압', '풍속', '풍향(불어오는 방향)'],
      rows: v.marks.map((m) => [
        m.label, fmtDateTime(m.t, tz),
        fmtValue(m.obs, 'cm'), fmtValue(m.pred, 'cm'),
        v.residualOk ? fmtSignedValue(m.res, 'cm') : '계산 불가',
        fmtValue(m.pressure, 'hPa', 1), fmtValue(m.windSpeed, 'm/s', 1), fmtWindDir(m.windDir),
      ]),
      empty: '선택한 시각이 없습니다.',
    });
  }
  return { meta, tables };
}

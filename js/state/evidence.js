// 근거(현재 분석 상태의 고정 사본) 만들기와 표 구성
// 근거는 추가한 시점의 분석 상태와 측정값을 깊은 복사로 보관한다.
// 이후 그래프를 움직여도 근거는 바뀌지 않는다(학생이 '교체'나 '삭제'를 눌러야만 바뀜).
// 탐구 1: 며칠간의 조위(지점) · 탐구 2: 한 달·일별 변동 폭 · 탐구 3: 집중 관찰 구간 · 탐구 5: 조위·기상·태풍

import { pairDiff } from '../analysis/series.js';
import { haversineKm, fmtLatLon } from '../analysis/geo.js';
import {
  obsPointAt, predAt, residualAt, weatherAt, inq2Days, inq2DetailView, dayStats, WEATHER_KINDS, weatherKinds, inq3Panels, weatherLabel, fmtWeather, compareCaseData,
} from '../chart/specs.js';
import { stationCaseData } from '../data/loader.js';
import { fmtDateTime, fmtDuration, hoursDecimal, fmtRange, fmtDateKo, fmtTime, DAY } from '../util/time.js';
import { fmtValue, fmtSignedValue, fmtNum } from '../util/format.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
export const KIND_LABEL = { high: '만조', low: '간조', spring: '대조', neap: '소조' };

function datasetsFor(cd, inquiry, state) {
  const out = [{ label: `관측 조위 (${cd.observed.label}, ${cd.station.name})`, identifier: cd.observed.meta.identifier || cd.dataVersion }];
  const cdB = (inquiry === 1 || inquiry === 2) ? compareCaseData(cd, state) : null;
  if (cdB) out.push({ label: `비교: 관측 조위 (${cdB.station.name}, ${state.compare.yMode === 'same' ? '같은 눈금' : '개별 눈금'})`, identifier: cdB.observed.meta.identifier || '' });
  if (inquiry === 2 && state.showMoon && cd.moon) out.push({ label: '달의 위상', identifier: cd.moon.meta.identifier || '' });
  if (inquiry === 5) {
    if (cd.predicted) out.push({ label: '천문조 예측 조위', identifier: cd.predicted.meta.identifier || '' });
    if (cd.residual?.ok) out.push({ label: '조위 잔차(관측 − 예측)', identifier: '앱에서 같은 시각끼리 계산' });
    if (cd.weather) out.push({ label: `기상(${cd.weather.station?.name || '기상 관측 지점'}): ${inq3Panels(cd, state).map((k) => weatherLabel(cd, k)).join('·') || '그래프 없음'}`, identifier: cd.weather.meta.identifier || '' });
    if (cd.typhoon) out.push({ label: `태풍 경로(${cd.typhoon.name}, ${cd.typhoon.trackKind || '중심 위치'})`, identifier: cd.typhoon.meta.identifier || '' });
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

function pointDiffs(points, pairSel) {
  const diffs = [];
  for (let i = 1; i < points.length; i++) diffs.push({ from: points[i - 1].label, to: points[i].label, ...pairDiff(points[i - 1], points[i]) });
  const pair = effectivePair(pairSel, points);
  if (pair) {
    const A = points.find((p) => p.label === pair[0]);
    const B = points.find((p) => p.label === pair[1]);
    const consecutive = diffs.some((d) => d.from === pair[0] && d.to === pair[1]);
    if (A && B && A !== B && !consecutive) diffs.push({ from: A.label, to: B.label, ...pairDiff(A, B), custom: true });
  }
  return diffs;
}

/** 학생이 같은 종류(만조끼리, 간조끼리)로 표시한 지점 사이의 차이 — 시각 순서 */
function kindDiffs(points, kinds) {
  const out = [];
  for (const k of kinds) {
    const list = points.filter((p) => p.kind === k).sort((a, b) => a.t - b.t);
    for (let i = 1; i < list.length; i++) out.push({ kind: k, from: list[i - 1].label, to: list[i].label, ...pairDiff(list[i - 1], list[i]) });
  }
  return out;
}

export function inq1Values(cd, a) {
  const points = (a.points || []).map((p) => {
    const op = obsPointAt(cd, p.t);
    return { label: p.label, t: p.t, kind: p.kind || '', v: op?.v ?? null, q: op?.q ?? 'missing' };
  });
  return { kind: 'inq1', points, diffs: pointDiffs(points, a.pair), kindDiffs: kindDiffs(points, ['high', 'low']) };
}

export function inq2Values(cd, a) {
  const days = inq2Days(cd);
  const sel = (a.selectedDays || []).map((s) => {
    const d = days.find((x) => x.day === s.day);
    return {
      label: s.label, day: s.day, kind: s.kind || '', start: d?.start ?? null,
      range: d?.range ?? null, max: d?.max ?? null, min: d?.min ?? null,
      complete: d?.complete ?? false, valid: d?.valid ?? 0, expected: d?.expected ?? 0,
    };
  });
  const gap = (A, B) => Math.round((B.start - A.start) / DAY);
  const intervals = [];
  for (let i = 1; i < sel.length; i++) {
    if (sel[i - 1].start != null && sel[i].start != null) intervals.push({ from: sel[i - 1].label, to: sel[i].label, days: gap(sel[i - 1], sel[i]) });
  }
  const pair = effectivePair(a.pair, sel);
  if (pair) {
    const A = sel.find((s) => s.label === pair[0]);
    const B = sel.find((s) => s.label === pair[1]);
    const consecutive = intervals.some((d) => d.from === pair[0] && d.to === pair[1]);
    if (A && B && A !== B && !consecutive && A.start != null && B.start != null) intervals.push({ from: A.label, to: B.label, days: gap(A, B), custom: true });
  }
  const kindIntervals = [];
  for (const k of ['spring', 'neap']) {
    const list = sel.filter((s) => s.kind === k && s.start != null).sort((x, y) => x.start - y.start);
    for (let i = 1; i < list.length; i++) kindIntervals.push({ kind: k, from: list[i - 1].label, to: list[i].label, days: gap(list[i - 1], list[i]) });
  }
  const moon = a.showMoon && cd.moon ? cd.moon.phases.filter((p) => p.t >= cd.ranges.inq2[0] - 3 * DAY && p.t <= cd.ranges.inq2[1] + 3 * DAY).map((p) => ({ t: p.t, label: p.label, lunar: p.lunar })) : null;
  return { kind: 'inq2', days: sel, intervals, kindIntervals, focusDay: a.focusDay, moonShown: !!(a.showMoon && cd.moon), moon };
}

/** 탐구 3(집중 관찰 구간): 선택 지점과 표시 범위의 날짜별 통계 */
export function inq3Values(cd, a) {
  const view = a.view || cd.ranges.inq3;
  const points = (a.points || []).map((p) => {
    const op = obsPointAt(cd, p.t);
    return { label: p.label, t: p.t, v: op?.v ?? null, q: op?.q ?? 'missing' };
  });
  const days = dayStats(cd, view[0], view[1]).map((d) => ({
    day: d.day, start: d.start, max: d.max, min: d.min, range: d.range, mean: d.mean, complete: d.complete, valid: d.valid, expected: d.expected,
  }));
  return { kind: 'inq3', points, diffs: pointDiffs(points, a.pair), days, focus: [...cd.ranges.inq3] };
}

/** 탐구 5: 선택 시각의 조위·기상 값, 태풍 경로 */
export function inq5Values(cd, a) {
  const kinds = weatherKinds(cd);
  const view = a.view || cd.ranges.inq3;
  const marks = (a.marks || []).map((m) => {
    const op = obsPointAt(cd, m.t);
    const w = weatherAt(cd, m.t);
    const weather = Object.fromEntries(kinds.map((k) => [k, w?.[k] ?? null]));
    return { label: m.label, t: m.t, obs: op?.v ?? null, obsQ: op?.q ?? null, pred: predAt(cd, m.t), res: residualAt(cd, m.t), weather };
  });
  let typhoon = null;
  if (cd.typhoon) {
    const tr = cd.typhoon.track.map((p) => ({ t: p.t, lat: p.lat, lon: p.lon, pressure: p.pressure ?? null, maxWind: p.maxWind ?? null, distKm: haversineKm(cd.station.lat, cd.station.lon, p.lat, p.lon) }));
    const nearest = tr.reduce((b, p) => (p.distKm != null && (!b || p.distKm < b.distKm) ? p : b), null);
    typhoon = {
      name: cd.typhoon.name, year: cd.typhoon.year, kind: cd.typhoon.trackKind || '', nearest,
      // 표시 범위 안의 위치 중 관측소에 가장 가까운 시각 앞뒤 몇 개만(표가 너무 길어지지 않게)
      inView: (() => {
        const v = tr.filter((p) => p.t >= view[0] && p.t <= view[1]);
        const near = v.reduce((b, p, i) => (p.distKm != null && (b < 0 || p.distKm < v[b].distKm) ? i : b), -1);
        return near < 0 ? v.slice(0, 8) : v.slice(Math.max(0, near - 4), near + 5);
      })(),
      keyTimes: cd.keyTimes.map((k) => ({ t: k.t, label: k.label })),
    };
  }
  return {
    kind: 'inq5', marks,
    panels: inq3Panels(cd, a),
    weatherKinds: kinds.map((k) => ({ key: k, label: weatherLabel(cd, k), unit: WEATHER_KINDS[k].unit })),
    residualOk: !!cd.residual?.ok,
    predictedProvided: !!cd.predicted,
    weatherStation: cd.weather?.station?.name || null,
    weatherDistanceKm: cd.weatherDistanceKm,
    typhoon,
  };
}

export function currentValues(cd, inquiry, a) {
  if (inquiry === 1) return inq1Values(cd, a);
  if (inquiry === 2) return inq2Values(cd, a);
  if (inquiry === 3) return inq3Values(cd, a);
  return inq5Values(cd, a);
}

/** 현재 화면 상태로 근거 내용을 만든다(id·번호 제외) */
export function snapshotEvidence(cd, inquiry, analysisState) {
  const st = clone(analysisState);
  if (inquiry === 1) st.view = st.view || cd.ranges.inq1;
  if (inquiry === 2) st.detailView = st.detailView || inq2DetailView(cd, st);
  if (inquiry === 3 || inquiry === 5) st.view = st.view || cd.ranges.inq3;
  const values = currentValues(cd, inquiry, st);
  const period = inquiry === 2 ? [...cd.ranges.inq2] : [...st.view];
  return {
    inquiry,
    caseId: cd.id,
    dataVersion: cd.dataVersion,
    station: cd.station.name,
    stationId: cd.station.id || null,
    stationSea: cd.stationEntry?.sea || '',
    datasets: datasetsFor(cd, inquiry, st),
    period,
    state: st,
    values,
    summary: summarize(cd, values),
  };
}

export function summarize(cd, v) {
  if (v.kind === 'inq1' || v.kind === 'inq3') {
    if (!v.points.length) return v.kind === 'inq3' ? '집중 관찰 구간 · 선택 지점 없음' : '선택 지점 없음';
    return `${v.kind === 'inq3' ? '집중 관찰 구간 · ' : ''}지점 ${v.points.map((p) => p.label).join('·')} ${v.points.length}개` + (v.diffs.length ? ` · 차이 ${v.diffs.length}건` : '');
  }
  if (v.kind === 'inq2') {
    if (!v.days.length) return '선택 날짜 없음';
    return `날짜 ${v.days.map((d) => d.label).join('·')} ${v.days.length}개${v.moonShown ? ' · 달의 위상 표시' : ''}`;
  }
  if (!v.marks.length) return '선택 시각 없음';
  const wx = (v.weatherKinds || []).filter((k) => (v.panels || []).includes(k.key)).map((k) => k.label);
  return `시각 ${v.marks.map((m) => m.label).join('·')} ${v.marks.length}개${wx.length ? ` · 기상 그래프: ${wx.join('·')}` : ''}`;
}

const qualityText = (q) => ({ ok: '정상', suspect: '의심', bad: '오류', missing: '결측' })[q] || '—';
const dayCell = (d, tz) => (d.start != null ? fmtDateKo(d.start, tz) : d.day);
const maxMin = (x, tz) => (x ? `${fmtNum(x.v)} cm (${fmtTime(x.t, tz)})` : '—');
const statusCell = (d) => (d.complete ? `완전 (${d.valid}/${d.expected})` : `불완전 (${d.valid}/${d.expected}, 비교 주의)`);

/**
 * 근거의 측정값 표 — 미리보기와 PDF가 같은 표를 사용한다.
 * @returns {{meta: Array<[string,string]>, tables: Array<{title, head, rows, note?}>}}
 */
export function evidenceTables(cd0, ev) {
  const cd = stationCaseData(cd0, ev.stationId) || cd0;
  const tz = cd.tz;
  const v = ev.values;
  const meta = [
    ['관측소', `${ev.station}${ev.stationId ? ` (${ev.stationId}${ev.stationSea ? `, ${ev.stationSea}` : ''})` : ''}`],
    ...(ev.state?.compare?.stationId && (ev.inquiry === 1 || ev.inquiry === 2) ? [['비교 관측소', `${stationCaseData(cd0, ev.state.compare.stationId)?.station.name || ev.state.compare.stationId} (${ev.state.compare.stationId}) · 세로축 ${ev.state.compare.yMode === 'same' ? (ev.inquiry === 1 ? '같은 눈금 크기(관측소별 기준)' : '같은 눈금') : '개별 눈금'}`]] : []),
    ['자료 종류', ev.datasets.map((d) => d.label).join(', ')],
    ['자료 식별자', [ev.dataVersion, ...ev.datasets.map((d) => d.identifier).filter(Boolean)].filter((x, i, a) => a.indexOf(x) === i).join(', ')],
  ];
  const tables = [];
  const pointsTable = (title) => ({
    title,
    head: v.kind === 'inq1' ? ['기호', '시각', '조위', '학생 판단', '품질'] : ['기호', '시각', '조위', '품질'],
    rows: v.points.map((p) => (v.kind === 'inq1'
      ? [p.label, fmtDateTime(p.t, tz), fmtValue(p.v, 'cm'), KIND_LABEL[p.kind] || '—', qualityText(p.q)]
      : [p.label, fmtDateTime(p.t, tz), fmtValue(p.v, 'cm'), qualityText(p.q)])),
    empty: '선택한 지점이 없습니다.',
  });
  const diffTable = () => (v.diffs.length ? {
    title: '지점 사이의 차이 (뒤 지점 − 앞 지점)',
    head: ['구간', '시간 차이', '높이 차이'],
    rows: v.diffs.map((d) => [`${d.from} → ${d.to}`, `${fmtDuration(d.dtMs)} (${hoursDecimal(d.dtMs)}시간)`, fmtSignedValue(d.dv, 'cm')]),
  } : null);
  if (v.kind === 'inq1') {
    meta.push(['표시 범위', fmtRange(ev.state.view[0], ev.state.view[1], tz)]);
    tables.push(pointsTable('선택 지점 (1시간 간격 관측값)'));
    const dt = diffTable();
    if (dt) tables.push(dt);
    if (v.kindDiffs?.length) {
      tables.push({
        title: '학생이 같은 종류로 표시한 지점끼리의 차이 (시각 순서)',
        head: ['종류', '구간', '시간 차이', '높이 차이'],
        rows: v.kindDiffs.map((d) => [KIND_LABEL[d.kind], `${d.from} → ${d.to}`, `${fmtDuration(d.dtMs)} (${hoursDecimal(d.dtMs)}시간)`, fmtSignedValue(d.dv, 'cm')]),
        note: '만조·간조 표시는 학생의 판단이며, 앱이 정답을 정하지 않습니다.',
      });
    }
  } else if (v.kind === 'inq2') {
    meta.push(['분석 기간', fmtRange(cd.ranges.inq2[0], cd.ranges.inq2[1], tz)]);
    meta.push(['확대 그래프 범위', fmtRange(ev.state.detailView[0], ev.state.detailView[1], tz)]);
    meta.push(['달의 위상 표시', v.moonShown ? '켬' : '끔(공개 전 또는 숨김)']);
    tables.push({
      title: '선택 날짜의 일별 해수면 변동 폭 (그날 관측 최고값 − 관측 최저값)',
      head: ['기호', '날짜', '학생 판단', '변동 폭', '관측 최고값(시각)', '관측 최저값(시각)', '자료 상태'],
      rows: v.days.map((d) => [d.label, dayCell(d, tz), KIND_LABEL[d.kind] || '—', d.range == null ? '자료 없음' : `${fmtNum(d.range)} cm`, maxMin(d.max, tz), maxMin(d.min, tz), statusCell(d)]),
      empty: '선택한 날짜가 없습니다.',
      note: '1시간 간격 관측값 중의 최고·최저값이며, 연속 관측의 실제 최고·최저값과 다를 수 있습니다. 인접한 만조·간조 한 쌍의 조차와는 다른 값입니다. 대조·소조 표시는 학생의 판단입니다.',
    });
    if (v.intervals.length) {
      tables.push({ title: '선택 날짜 사이의 간격', head: ['구간', '날짜 간격'], rows: v.intervals.map((d) => [`${d.from} → ${d.to}`, `${d.days}일`]) });
    }
    if (v.kindIntervals?.length) {
      tables.push({ title: '학생이 같은 종류로 표시한 날짜끼리의 간격', head: ['종류', '구간', '날짜 간격'], rows: v.kindIntervals.map((d) => [KIND_LABEL[d.kind], `${d.from} → ${d.to}`, `${d.days}일`]) });
    }
    if (v.moon && v.moon.length) {
      tables.push({ title: '달의 위상 (자료 기준 시각)', head: ['위상', '시각', '음력'], rows: v.moon.map((m) => [m.label, fmtDateTime(m.t, tz), m.lunar || '자료 미제공']) });
    }
  } else if (v.kind === 'inq3') {
    meta.push(['집중 관찰 구간(교사 설정)', fmtRange(v.focus[0], v.focus[1], tz)]);
    meta.push(['표시 범위', fmtRange(ev.state.view[0], ev.state.view[1], tz)]);
    tables.push(pointsTable('선택 지점 (1시간 간격 관측값)'));
    const dt = diffTable();
    if (dt) tables.push(dt);
    tables.push({
      title: '날짜별 관측 최고값·최저값·평균과 변동 폭 (표시 범위에 걸친 날짜)',
      head: ['날짜', '관측 최고값(시각)', '관측 최저값(시각)', '관측값 평균', '변동 폭(최고 − 최저)', '자료 상태'],
      rows: v.days.map((d) => [dayCell(d, tz), maxMin(d.max, tz), maxMin(d.min, tz), d.mean == null ? '—' : `${fmtNum(d.mean, 1)} cm`, d.range == null ? '자료 없음' : `${fmtNum(d.range)} cm`, statusCell(d)]),
      empty: '표시 범위에 자료가 없습니다.',
      note: '관측값 평균은 그날 1시간 간격 관측값의 산술 평균입니다(자료가 빠진 날은 다른 날과 같은 조건으로 비교하지 마세요).',
    });
  } else {
    meta.push(['표시 범위', fmtRange(ev.state.view[0], ev.state.view[1], tz)]);
    if (v.weatherStation) meta.push(['기상 관측 지점', `${v.weatherStation}${v.weatherDistanceKm != null ? (v.weatherDistanceKm < 0.1 ? ' (조위 관측소와 같은 지점)' : ` (조위 관측소에서 약 ${v.weatherDistanceKm.toFixed(1)} km)`) : ''}`]);
    const wk = v.weatherKinds || [];
    tables.push({
      title: v.residualOk ? '선택 시각의 값 (잔차 = 같은 시각의 관측 − 예측)' : '선택 시각의 값',
      head: ['기호', '시각', '관측 조위', ...(v.predictedProvided ? ['예측 조위', '잔차'] : []), ...(wk.length ? wk.map((k) => (k.key === 'windDir' ? `${k.label}(불어오는 방향)` : k.label)) : ['기상'])],
      rows: v.marks.map((m) => [
        m.label, fmtDateTime(m.t, tz), fmtValue(m.obs, 'cm'),
        ...(v.predictedProvided ? [fmtValue(m.pred, 'cm'), v.residualOk ? fmtSignedValue(m.res, 'cm') : '계산 불가'] : []),
        ...(wk.length ? wk.map((k) => fmtWeather(k.key in WEATHER_KINDS ? k.key : 'pressure', m.weather?.[k.key] ?? null)) : ['자료 미제공']),
      ]),
      empty: '선택한 시각이 없습니다.',
      note: v.predictedProvided ? '' : '이 사례에는 예측 조위 자료가 없어 관측과 예측의 차이(잔차)를 계산하지 않았습니다.',
    });
    if (v.typhoon) {
      const ty = v.typhoon;
      meta.push(['태풍 정보', `${ty.name} (${ty.year}년) · ${ty.kind || '중심 위치'}${ty.nearest ? ` · 관측소에서 가장 가까운 분석 위치: ${fmtDateTime(ty.nearest.t, tz)} 약 ${ty.nearest.distKm.toFixed(0)} km` : ''}`]);
      if (ty.inView.length) {
        tables.push({
          title: '표시 범위 무렵의 태풍 중심 위치 (태풍 중심기압은 관측소의 기압이 아님)',
          head: ['시각', '중심 위치', '태풍 중심기압', '관측소까지 거리'],
          rows: ty.inView.map((p) => [fmtDateTime(p.t, tz), fmtLatLon(p.lat, p.lon), p.pressure != null ? `${fmtNum(p.pressure)} hPa` : '자료 없음', p.distKm != null ? `${p.distKm.toFixed(0)} km` : '—']),
        });
      }
    }
  }
  return { meta, tables: tables.filter(Boolean) };
}

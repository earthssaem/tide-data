// 보고서 구성 — 미리보기(HTML)와 PDF가 같은 구성을 사용한다(화면 답안과 PDF 내용 일치).
// 학생이 쓰지 않은 답안은 비워 두고 '작성하지 않음'으로만 표시한다(임의로 채우지 않음).
// 순서: 학생·관측소 → 탐구 1 → 탐구 2 → 위치 관계 그림·글 → 위상 확인 후 답변 → 탐구 3 → 탐구 4(초기 추측)
//       → 탐구 5(추가 자료와 수정된 설명) → 종합 결론 → 자료 출처와 분석의 한계
// 아직 공개하지 않은 자료(달의 위상, 기상·태풍)는 보고서에도 나오지 않는다. 교사용 메모는 넣지 않는다.

import { INQUIRIES, CONCLUSION, REVEALS, activeQuestions } from '../content/questions.js';
import { unavailableText, lockedBy, revealedAnswer } from '../screens/common.js';
import { fmtRange, fmtDateTime } from '../util/time.js';
import { stationCaseData } from '../data/loader.js';
import { weatherKinds, weatherLabel } from '../chart/specs.js';

const localTz = () => ({ offsetMinutes: -new Date().getTimezoneOffset(), label: '' });

export function studentLine(st) {
  return `${st.grade || '□'}학년 ${st.klass || '□'}반 ${st.number || '□'}번 ${st.name || '(이름 없음)'}`;
}

export function caseInfoRows(cd, state = { reveals: {} }) {
  const r = cd.ranges;
  const rv = state.reveals || {};
  const rows = [
    ['관측소', `${cd.station.name}${cd.station.id ? ` (${cd.station.id}${cd.stationEntry?.sea ? `, ${cd.stationEntry.sea}` : ''})` : ''}`],
    ['분석 기간(탐구 2)', fmtRange(r.inq2[0], r.inq2[1], cd.tz)],
    ['기본 관찰 구간(탐구 1)', fmtRange(r.inq1[0], r.inq1[1], cd.tz)],
    ['집중 관찰 구간(탐구 3)', fmtRange(r.inq3[0], r.inq3[1], cd.tz)],
  ];
  if (rv.weather && cd.typhoon) rows.push(['태풍 정보(탐구 5)', `${cd.typhoon.name} (${cd.typhoon.year}년)`]);
  rows.push(['높이 기준면', cd.observed.datumLabel]);
  rows.push(['관측 간격', `${cd.observed.intervalMs / 3600e3}시간`]);
  rows.push(['시간대', cd.tz.name || cd.tz.label]);
  rows.push(['달의 위상 자료 확인', rv.moon ? fmtDateTime(rv.moon.at, localTz()) : '확인하지 않음']);
  rows.push(['추가 자료 확인', rv.weather ? fmtDateTime(rv.weather.at, localTz()) : '확인하지 않음']);
  rows.push(['자료 버전', cd.dataVersion]);
  return rows;
}

/** 관측소 하나의 자료 출처(관측·예측, 공개한 경우 기상) */
export function stationSourceRows(cd, { prefix = '', weather = true } = {}) {
  const out = [];
  const ds = (label, s, extra = []) => {
    if (!s) { out.push({ role: `${prefix}${label}`, lines: ['자료 미제공'] }); return; }
    out.push({ role: `${prefix}${label}`, lines: [
      s.meta?.provider && `제공: ${s.meta.provider}`, s.meta?.title && `자료명: ${s.meta.title}`, s.meta?.identifier && `식별자: ${s.meta.identifier}`,
      ...extra,
    ].filter(Boolean) });
  };
  ds('관측 조위', cd.observed, [
    `관측 간격 ${cd.observed.intervalMs / 3600e3}시간, 단위 cm, 기준면 ${cd.observed.datumLabel}`,
    cd.observed.conversions.length ? `전처리 변환: ${cd.observed.conversions.join(', ')}` : '',
  ].filter(Boolean));
  ds('천문조 예측 조위', cd.predicted, cd.predicted ? [
    `관측 간격 ${cd.predicted.intervalMs / 3600e3}시간, 기준면 ${cd.predicted.datumLabel}`,
    cd.predicted.conversions.length ? `전처리 변환: ${cd.predicted.conversions.join(', ')}` : '',
    cd.residual?.ok ? '' : `잔차 계산 불가: ${cd.residual?.problems?.join(' ')}`,
  ].filter(Boolean) : []);
  if (weather) {
    ds('기상 자료', cd.weather, cd.weather ? [
      `관측 지점: ${cd.weather.station?.name || '—'}${cd.weatherDistanceKm != null ? (cd.weatherDistanceKm < 0.1 ? ' (조위 관측소와 같은 지점)' : ` (조위 관측소에서 약 ${cd.weatherDistanceKm.toFixed(1)} km${cd.weather.station?.elevation_m != null ? `, 해발 ${cd.weather.station.elevation_m} m` : ''})`) : ''}`,
      `항목: ${weatherKinds(cd).map((k) => weatherLabel(cd, k)).join(', ')} · 관측 간격 ${cd.weather.intervalMs / 3600e3}시간 · 풍향은 바람이 불어오는 방향`,
    ] : []);
  }
  return out;
}

/** 보고서 자료 출처: 현재 관측소와 근거·비교에 쓰인 관측소 모두(공개한 자료만) */
export function reportSources(cd, state) {
  const rv = state.reveals || {};
  const out = [];
  const d = cd.config.description || {};
  out.push({ role: '자료 설명', lines: [
    d.title && `자료명: ${d.title}`, d.period && `기간: ${d.period}`,
    `시간대: ${cd.tz.name || cd.tz.label}`, d.interval && `관측 간격: ${d.interval}`, d.datumLabel && `높이 기준면: ${d.datumLabel}`,
    d.identifier && `식별자: ${d.identifier}`,
  ].filter(Boolean) });
  const ids = [cd.station.id];
  for (const ev of state.evidences || []) {
    if (ev.stationId && !ids.includes(ev.stationId)) ids.push(ev.stationId);
    const c = ev.state?.compare?.stationId;
    if (c && (ev.inquiry === 1 || ev.inquiry === 2) && !ids.includes(c)) ids.push(c);
  }
  for (const id of ids) {
    const sc = id ? stationCaseData(cd, id) : cd;
    if (!sc) { out.push({ role: `관측소 ${id}`, lines: ['이 앱에서 자료를 찾을 수 없음(근거의 표 값은 기록 당시 값)'] }); continue; }
    out.push(...stationSourceRows(sc, { prefix: ids.length > 1 || cd.multi ? `${sc.station.name}${id ? `(${id})` : ''} · ` : '', weather: !!rv.weather }));
  }
  if (rv.moon && cd.moon) out.push({ role: '달의 위상', lines: [cd.moon.meta.provider && `제공: ${cd.moon.meta.provider}`, cd.moon.meta.note, cd.moon.meta.identifier && `식별자: ${cd.moon.meta.identifier}`].filter(Boolean) });
  if (rv.weather && cd.typhoon) out.push({ role: '태풍 정보', lines: [cd.typhoon.meta?.provider && `제공: ${cd.typhoon.meta.provider}`, cd.typhoon.meta?.identifier && `식별자: ${cd.typhoon.meta.identifier}`, cd.typhoon.trackKind && `경로 종류: ${cd.typhoon.trackKind}`, cd.typhoon.note].filter(Boolean) });
  if (ids.length > 1) out.push({ role: '관측소 비교 시 주의', lines: ['관측소마다 조위의 높이 기준면이 다를 수 있고 확인되지 않았으므로, 관측소끼리 조위 숫자로 해수면 높낮이를 비교하지 않았다.'] });
  return out;
}

/** 자료 처리 기준과 분석의 한계 */
export function limitationNotes(cd, state) {
  const rv = state.reveals || {};
  const out = [
    '일별 해수면 변동 폭 = 해당 날짜(00:00~24:00)의 관측 최고값 − 관측 최저값. 인접한 만조·간조 한 쌍의 조차와는 다른 값이다.',
    '관측값 평균(탐구 3) = 그날 1시간 간격 관측값의 산술 평균. 자료가 빠진 날은 다른 날과 같은 조건으로 비교하지 않았다.',
    '결측·오류값은 0으로 바꾸지 않고 빈 값으로 두었으며, 그래프에서는 선을 끊어 표시했다. 자료가 빠진 날의 일별 통계는 불완전으로 표시했다.',
    '관측점은 직선으로 연결했다. 1시간 간격 자료에서 얻은 최고·최저값은 연속 관측의 실제 최고·최저값과 다를 수 있다.',
    '만조·간조, 대조·소조 표시는 학생이 자료를 보고 판단한 것이며, 앱이 정답을 정하지 않았다.',
    `높이 기준면: ${cd.observed.datumLabel}. ${cd.observed.datumConfirmed === false ? '기준면이 확인되지 않아 관측소끼리 조위 숫자로 해수면 높낮이를 비교하지 않았다.' : ''}`,
  ];
  if (/미확인/.test(cd.tz.name || '')) out.push(`시간대: ${cd.tz.name}`);
  if (cd.residual?.ok) out.push('조위 잔차 = 같은 시각의 관측 조위 − 예측 조위. 같은 관측소·같은 기준면·같은 시각의 자료만 비교하며, 가까운 시각의 값을 연결하거나 보간하지 않았다.');
  else out.push(`예측 조위로 관측과 예측의 차이(잔차)를 계산하지 않았다(${cd.residual?.problems?.[0] || '예측 조위 자료 없음'}). 따라서 특정 요인 때문에 높아진 정확한 높이는 이 자료만으로 구하지 않았다.`);
  if (rv.weather && cd.weather && cd.weatherDistanceKm != null && cd.weatherDistanceKm >= 0.1) out.push(`기상 자료는 조위관측소에서 약 ${cd.weatherDistanceKm.toFixed(1)} km 떨어진 ${cd.weather.station?.name || '기상 관측 지점'}의 값이며, 두 위치의 기압·바람이 같다고 단정할 수 없다. 해면기압과 현지기압은 한 그래프에 섞지 않았다.`);
  if (rv.weather && cd.typhoon) out.push('태풍 경로는 일정 간격의 중심 위치 자료이며, 실제 최근접 시각은 기록된 시각 사이에 있을 수 있다. 태풍 중심기압은 관측소의 기압으로 쓰지 않았다.');
  if (rv.moon && cd.moon?.meta?.note) out.push(`달의 위상: ${cd.moon.meta.note}`);
  return out;
}

/**
 * @returns 보고서 구성 객체
 */
export function buildReport(cd, state) {
  const evById = new Map(state.evidences.map((e) => [e.id, e]));
  const missing = { answers: [], noLink: [], noEvidence: [], reveals: [], student: false };
  const st = state.student;
  if (!st.grade || !st.klass || !st.number || !st.name) missing.student = true;
  const rv = state.reveals || {};

  const blocksByInq = new Map();
  const unlinkedByInq = new Map();
  for (const inq of INQUIRIES) {
    const placed = new Set();
    const qs = activeQuestions(inq, cd.setup);
    const blocks = qs.map((q, i) => {
      const linked = (state.links[q.id] || []).filter((id) => evById.has(id)).map((id) => evById.get(id));
      const figures = linked.filter((e) => e.inquiry === inq.no && !placed.has(e.id));
      figures.forEach((e) => placed.add(e.id));
      const lock = lockedBy(state, q);
      const waiting = q.afterReveal && !rv[q.afterReveal];
      const answer = lock ? revealedAnswer(state, q.lockAfter, q.id) : (state.answers[q.id] || '');
      const label = `탐구 ${inq.no} 문항 ${i + 1}`;
      if (!answer.trim()) missing.answers.push({ step: inq.step, qid: q.id, label });
      if (inq.evidence && !linked.length) missing.noLink.push({ step: inq.step, qid: q.id, label });
      const b = {
        id: q.id, no: i + 1, text: q.text, answer, empty: !answer.trim(),
        unavailable: waiting ? '' : unavailableText(cd, q),
        linkedNums: linked.map((e) => (e.stationId && e.stationId !== cd.station.id ? `${e.num}(${e.station})` : e.num)),
        figures,
        waitNote: waiting ? `${REVEALS[q.afterReveal].label}를 확인하지 않아 작성하지 않음` : '',
        lockedNote: lock ? `${REVEALS[q.lockAfter].label} 공개 전에 작성한 답(공개 ${fmtDateTime(lock.at, localTz())})` : '',
      };
      if (q.drawing) b.drawing = lock ? (lock.drawing || null) : (state.drawings?.[q.id] || null);
      if (q.compareWith) {
        b.sideBySide = {
          leftTitle: '탐구 4 문항 1 · 추가 자료 확인 전의 초기 추측',
          left: revealedAnswer(state, 'weather', q.compareWith),
          rightTitle: '추가 자료를 확인한 뒤 유지·수정한 설명',
        };
      }
      return b;
    });
    blocksByInq.set(inq.no, blocks);
    const evs = state.evidences.filter((e) => e.inquiry === inq.no);
    if (inq.evidence && !evs.length) missing.noEvidence.push({ step: inq.step, label: `탐구 ${inq.no}` });
    unlinkedByInq.set(inq.no, evs.filter((e) => !placed.has(e.id)));
  }
  if (!rv.moon && cd.availability.moonPhases) missing.reveals.push({ step: 'inq2', label: '탐구 2 [달의 위상 자료 확인]을 아직 누르지 않음' });
  if (!rv.weather) missing.reveals.push({ step: 'inq4', label: '탐구 4 [추가 자료 확인]을 아직 누르지 않음' });

  const pick = (no, ids) => blocksByInq.get(no).filter((b) => ids.includes(b.id));
  const D = (no) => INQUIRIES[no - 1];
  const moonPhaseRows = rv.moon && cd.moon
    ? cd.moon.phases.filter((p) => p.t >= cd.ranges.inq2[0] - 3 * 864e5 && p.t <= cd.ranges.inq2[1] + 3 * 864e5).map((p) => [p.label, fmtDateTime(p.t, cd.tz), p.lunar || '자료 미제공'])
    : null;
  const parts = [
    { key: 'inq1', inquiry: 1, main: true, title: `탐구 1. ${D(1).title}`, sub: `탐구 목표: ${D(1).goal}`, blocks: blocksByInq.get(1) },
    { key: 'inq2', inquiry: 2, main: true, title: `탐구 2. ${D(2).title}`, sub: `탐구 목표: ${D(2).goal}`, blocks: pick(2, ['a2q1', 'a2q2', 'a2q3']) },
    { key: 'inq2-pos', inquiry: 2, title: '달·태양·지구 위치 관계 그림 또는 글', sub: rv.moon ? `달의 위상 자료를 확인하기 전에 작성한 설명입니다(확인 ${fmtDateTime(rv.moon.at, localTz())}).` : '아직 달의 위상 자료를 확인하지 않았습니다.', blocks: pick(2, ['a2q4']) },
    { key: 'inq2-moon', inquiry: 2, title: '달의 위상 확인 후 답변', sub: rv.moon ? '실제 달의 위상 자료를 확인한 뒤 앞의 판단과 비교한 답변입니다.' : '달의 위상 자료를 확인하지 않아 이 부분은 작성되지 않았습니다.', blocks: pick(2, ['a2q5']), table: moonPhaseRows ? { title: '확인한 달의 위상 (자료 기준 시각)', head: ['위상', '시각', '음력'], rows: moonPhaseRows } : null },
    { key: 'inq3', inquiry: 3, main: true, title: `탐구 3. ${D(3).title}의 특징`, sub: `집중 관찰 구간: ${fmtRange(cd.ranges.inq3[0], cd.ranges.inq3[1], cd.tz)}`, blocks: blocksByInq.get(3) },
    { key: 'inq4', inquiry: 4, title: '탐구 4. 추가 자료 확인 전의 초기 추측', sub: rv.weather ? `추가 자료를 확인하기 전(${fmtDateTime(rv.weather.at, localTz())})에 보관한 답입니다.` : '아직 추가 자료를 확인하지 않았습니다(현재 작성 중인 답).', blocks: blocksByInq.get(4) },
    { key: 'inq5', inquiry: 5, main: true, title: '탐구 5. 추가 자료와 수정된 설명', sub: rv.weather ? `탐구 목표: ${D(5).goal}` : '추가 자료를 확인하지 않아 이 탐구는 진행되지 않았습니다.', blocks: rv.weather ? blocksByInq.get(5) : [] },
  ].filter((p) => p.blocks.length || p.main || p.table);
  for (const p of parts) {
    p.unlinked = p.main && D(p.inquiry).evidence ? unlinkedByInq.get(p.inquiry) : [];
    p.noEvidence = p.main && D(p.inquiry).evidence && !(p.inquiry === 5 && !rv.weather)
      && !parts.some((x) => x.inquiry === p.inquiry && x.blocks.some((b) => b.figures.length)) && !p.unlinked.length;
  }

  const conclusion = {
    title: CONCLUSION.title,
    blocks: CONCLUSION.questions.map((q, i) => {
      const linked = (state.links[q.id] || []).filter((id) => evById.has(id)).map((id) => evById.get(id));
      const answer = state.answers[q.id] || '';
      if (!answer.trim()) missing.answers.push({ step: 'conclusion', qid: q.id, label: `종합 결론 ${i + 1}` });
      return { id: q.id, no: i + 1, text: q.text, answer, empty: !answer.trim(), linkedNums: linked.map((e) => e.num), figures: [] };
    }),
  };

  const dataVersionMismatch = state.evidences.filter((e) => e.dataVersion !== cd.dataVersion).map((e) => e.num);

  return {
    appName: '조석 데이터 탐구실',
    title: '조석 데이터 탐구 보고서',
    student: { ...st },
    studentLine: studentLine(st),
    createdAt: Date.now(),
    createdText: fmtDateTime(Date.now(), localTz()),
    isSample: cd.isSample,
    sampleNotice: cd.sampleNotice,
    caseTitle: `조석 데이터 탐구 — ${cd.station.name}`,
    caseInfo: caseInfoRows(cd, state),
    parts,
    conclusion,
    sources: reportSources(cd, state),
    processing: limitationNotes(cd, state),
    missing,
    dataVersionMismatch,
  };
}

export function pdfFilename(st) {
  const raw = `조석탐구_${st.grade || ''}학년${st.klass || ''}반${st.number || ''}번_${st.name || '이름없음'}.pdf`;
  return raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, '');
}

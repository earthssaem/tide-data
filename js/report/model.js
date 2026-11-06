// 보고서 구성 — 미리보기(HTML)와 PDF가 같은 구성을 사용한다(화면 답안과 PDF 내용 일치).
// 학생이 쓰지 않은 답안은 비워 두고 '작성하지 않음'으로만 표시한다(임의로 채우지 않음).

import { INQUIRIES, CONCLUSION } from '../content/questions.js';
import { unavailableText } from '../screens/common.js';
import { fmtRange, fmtDateTime } from '../util/time.js';

const localTz = () => ({ offsetMinutes: -new Date().getTimezoneOffset(), label: '' });

export function studentLine(st) {
  return `${st.grade || '□'}학년 ${st.klass || '□'}반 ${st.number || '□'}번 ${st.name || '(이름 없음)'}`;
}

export function caseInfoRows(cd) {
  const r = cd.ranges;
  const rows = [
    ['관측소', `${cd.station.name}${cd.station.note ? ` (${cd.station.note})` : ''}`],
    ['탐구 1 구간', fmtRange(r.inq1[0], r.inq1[1], cd.tz)],
    ['탐구 2 기간', fmtRange(r.inq2[0], r.inq2[1], cd.tz)],
    ['탐구 3 구간', fmtRange(r.inq3[0], r.inq3[1], cd.tz)],
  ];
  if (cd.typhoon) rows.push(['태풍 사례', `${cd.typhoon.name} (${cd.typhoon.year}년)`]);
  rows.push(['높이 기준면', cd.observed.datumLabel]);
  rows.push(['관측 간격', `${cd.observed.intervalMs / 3600e3}시간`]);
  rows.push(['시간대', cd.tz.name || cd.tz.label]);
  rows.push(['자료 버전', cd.dataVersion]);
  return rows;
}

export function sourceRows(cd) {
  const out = [];
  const d = cd.config.description || {};
  out.push({ role: '자료 설명', lines: [
    d.provider && `제공: ${d.provider}`, d.title && `자료명: ${d.title}`, d.period && `기간: ${d.period}`,
    `시간대: ${cd.tz.name || cd.tz.label}`, d.interval && `관측 간격: ${d.interval}`, d.datumLabel && `높이 기준면: ${d.datumLabel}`,
    d.identifier && `식별자: ${d.identifier}`,
  ].filter(Boolean) });
  const ds = (label, s, extra = []) => {
    if (!s) { out.push({ role: label, lines: ['자료 미제공'] }); return; }
    out.push({ role: label, lines: [
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
  ds('기상 자료', cd.weather, cd.weather ? [
    `관측 지점: ${cd.weather.station?.name || '—'}${cd.weatherDistanceKm != null ? ` (조위 관측소에서 약 ${cd.weatherDistanceKm.toFixed(1)} km)` : ''}`,
    `관측 간격 ${cd.weather.intervalMs / 3600e3}시간, 기압 hPa, 풍속 m/s, 풍향 도(바람이 불어오는 방향)`,
  ] : []);
  ds('달의 위상', cd.moon);
  if (cd.typhoon) ds('태풍 정보', { meta: cd.typhoon.meta }, [cd.typhoon.note].filter(Boolean));
  return out;
}

export const PROCESSING_NOTES = [
  '일별 해수면 변동 폭 = 해당 날짜(00:00~24:00)의 관측 최고값 − 관측 최저값. 인접한 만조·간조 한 쌍의 조차와는 다른 값이다.',
  '조위 잔차 = 같은 시각의 관측 조위 − 예측 조위. 같은 관측소·같은 기준면·같은 시각의 자료만 비교하며, 가까운 시각의 값을 연결하거나 보간하지 않았다.',
  '결측·오류값은 0으로 바꾸지 않고 빈 값으로 두었으며, 그래프에서는 선을 끊어 표시했다. 자료가 빠진 날의 일별 통계는 불완전으로 표시했다.',
  '관측점은 직선으로 연결했다. 1시간 간격 자료에서 얻은 최고·최저값은 연속 관측의 실제 최고·최저값과 다를 수 있다.',
];

/**
 * @returns 보고서 구성 객체
 */
export function buildReport(cd, state) {
  const evById = new Map(state.evidences.map((e) => [e.id, e]));
  const ans = (id) => state.answers[id] || '';
  const missing = { answers: [], noLink: [], noEvidence: [], student: false };
  const st = state.student;
  if (!st.grade || !st.klass || !st.number || !st.name) missing.student = true;

  const sections = INQUIRIES.map((inq) => {
    const placed = new Set();
    const blocks = inq.questions.map((q, i) => {
      const linkedIds = (state.links[q.id] || []).filter((id) => evById.has(id));
      const linked = linkedIds.map((id) => evById.get(id));
      const figures = linked.filter((e) => e.inquiry === inq.no && !placed.has(e.id));
      figures.forEach((e) => placed.add(e.id));
      const answer = ans(q.id);
      const label = `탐구 ${inq.no} 문항 ${i + 1}`;
      if (!answer.trim()) missing.answers.push({ step: inq.step, qid: q.id, label });
      if (!linked.length) missing.noLink.push({ step: inq.step, qid: q.id, label });
      return {
        id: q.id, no: i + 1, text: q.text, answer, empty: !answer.trim(),
        unavailable: unavailableText(cd, q),
        linkedNums: linked.map((e) => e.num),
        figures,
      };
    });
    const evs = state.evidences.filter((e) => e.inquiry === inq.no);
    if (!evs.length) missing.noEvidence.push({ step: inq.step, label: `탐구 ${inq.no}` });
    const unlinked = evs.filter((e) => !placed.has(e.id));
    return { no: inq.no, step: inq.step, title: `탐구 ${inq.no}. ${inq.title}`, goal: inq.goal, blocks, unlinked };
  });

  const conclusion = {
    title: CONCLUSION.title,
    blocks: CONCLUSION.questions.map((q, i) => {
      const linked = (state.links[q.id] || []).filter((id) => evById.has(id)).map((id) => evById.get(id));
      const answer = ans(q.id);
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
    caseTitle: cd.config.title || '',
    caseInfo: caseInfoRows(cd),
    sections,
    conclusion,
    sources: sourceRows(cd),
    processing: PROCESSING_NOTES,
    missing,
    dataVersionMismatch,
  };
}

export function pdfFilename(st) {
  const raw = `조석탐구_${st.grade || ''}학년${st.klass || ''}반${st.number || ''}번_${st.name || '이름없음'}.pdf`;
  return raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, '');
}

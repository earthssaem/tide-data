// 보고서 구성 — 미리보기(HTML)와 PDF가 같은 구성을 사용한다(화면 답과 PDF 내용 일치).
// 학생이 쓰지 않은 답은 비워 두고 '작성하지 않음'으로만 표시한다(임의로 채우지 않음).
// 학생이 그래프에서 고른 지점·날짜·구간은 그 문항의 그래프에 그대로 그려 넣는다(같은 그래프를 쓰는 문항은 그림 하나를 함께 씀).
// 아직 공개하지 않은 자료(달의 위상, 기상·태풍)는 보고서에도 나오지 않는다. 교사용 메모는 넣지 않는다.

import { INQUIRIES, CONCLUSION, REVEALS, CIRCLED, PREDICTED_TEXT, OBSERVED_TEXT, DATUM_CAUTION, isEnabled, qLabel } from '../content/questions.js';
import { answerOf } from '../screens/common.js';
import { fmtRange, fmtDateTime, fmtDateKo, DAY, HOUR } from '../util/time.js';
import { fmtNum } from '../util/format.js';
import { layoutChart } from '../chart/layout.js';
import {
  inq1MainSpec, inq1DailySpec, inq2Specs, stationsMapLayout, inq3Specs, inq3DailySpec, inq4TideSpecs, weatherSpec,
  typhoonMapLayout, closestTyphoonPoint, monthDays, extremaIn, periodTitle, periodCd, PERIOD_NAMES,
} from '../chart/assess.js';

const localTz = () => ({ offsetMinutes: -new Date().getTimezoneOffset(), label: '' });
const cm = (v) => (v == null ? '자료 없음' : `${fmtNum(v, 1)} cm`);

export function studentLine(st) {
  return `${st.grade || '□'}학년 ${st.klass || '□'}반 ${st.number || '□'}번 ${st.name || '(이름 없음)'}`;
}

/** 문항별 답 요약(글 줄 목록). 빈 답이면 [] */
export function answerLines(ad, state, q) {
  const tz = ad.tz;
  const a = answerOf(state, q);
  switch (q.id) {
    case 'q1': {
      const L = [];
      if (a.high) L.push(`만조로 고른 지점: ${fmtDateTime(a.high.t, tz)} · ${cm(a.high.v)}`);
      if (a.low) L.push(`간조로 고른 지점: ${fmtDateTime(a.low.t, tz)} · ${cm(a.low.v)}`);
      if (String(a.range || '').trim()) L.push(`조차: ${a.range} cm`);
      return L;
    }
    case 'q2': {
      if (![a.high, a.low, a.period].some((x) => String(x || '').trim())) return [];
      return [`만조 ${a.high || '□'}회 / 간조 ${a.low || '□'}회 / 만조에서 다음 만조까지 약 ${a.period || '□'}시간`];
    }
    case 'q3': {
      const days = monthDays(ad.st[ad.rep], ad.win.month);
      const t = (k) => { const d = days.find((x) => x.day === k); return d ? `${fmtDateKo(d.start, tz)} (변동 폭 ${cm(d.range)})` : k; };
      return [a.spring && `대조로 고른 날: ${t(a.spring)}`, a.neap && `소조로 고른 날: ${t(a.neap)}`].filter(Boolean);
    }
    case 'q4': return [];
    case 'q5': {
      if (!a.some(Boolean)) return [];
      const n = (id) => ad.stationList.find((s) => s.id === id)?.name || '□';
      return [`${n(a[0])} > ${n(a[1])} > ${n(a[2])}`];
    }
    case 'q6': return ad.stationList.map((s) => { const v = a[s.id]; return v && (v.type || v.reason?.trim()) ? `${s.name}: ${v.type || '□'}${v.reason?.trim() ? ` — ${v.reason.trim()}` : ''}` : null; }).filter(Boolean);
    case 'q7': {
      const L = [];
      if (a.t0 != null) {
        const cd = ad.st[ad.rep];
        const p = extremaIn(cd.predicted, a.t0, a.t1), o = extremaIn(cd.observed, a.t0, a.t1);
        L.push(`고른 구간: ${fmtRange(a.t0, a.t1, tz)} (${Math.round((a.t1 - a.t0) / HOUR)}시간) · 변동 폭 예측 ${cm(p?.range)}, 관측 ${cm(o?.range)}`);
      }
      if (a.text?.trim()) L.push(a.text.trim());
      return L;
    }
    default: return typeof a === 'string' && a.trim() ? [a.trim()] : [];
  }
}

const fig = (id, caption, panels) => ({ type: 'figure', id, caption, panels });
// panels: [{height, spec:(ctx)=>spec} | {map:(width, measure, fontSize)=>layout, maxWidth}]

/** 그림의 각 패널을 배치(폭·글자 크기는 화면/PDF가 정함) */
export function layoutFigure(f, { width, measure, fontSize = 9.5 }) {
  return f.panels.map((p) => {
    if (p.map) return p.map(Math.min(width, p.maxWidth || width), measure, fontSize);
    return layoutChart(p.spec({ width, height: p.height, measure, fontSize }));
  }).filter(Boolean);
}

export function buildReport(ad, state) {
  const tz = ad.tz;
  const rv = state.reveals || {};
  const st = state.student;
  const missing = [];
  const on = (q) => isEnabled(q, ad.setup);
  const qa = (q, step) => {
    const lock = q.lockAfter && rv[q.lockAfter];
    const waiting = q.afterReveal && !rv[q.afterReveal];
    const lines = waiting ? [] : answerLines(ad, state, q);
    const empty = !lines.length && q.id !== 'q4';
    if (empty) missing.push({ step, qid: q.id, label: `${qLabel(q)}` });
    return {
      type: 'qa', id: q.id, label: qLabel(q), text: q.text, lines, empty,
      waitNote: waiting ? `[${REVEALS[q.afterReveal].label}]을 하지 않아 작성하지 않음` : '',
      lockedNote: lock ? `[${REVEALS[q.lockAfter].label}] 전에 작성한 답(${fmtDateTime(lock.at, localTz())})` : '',
    };
  };
  const [Q1, Q2, Q3, Q4] = INQUIRIES[0].questions;
  const [Q5, Q6] = INQUIRIES[1].questions;
  const [Q7, Q8] = INQUIRIES[2].questions;
  const [Q9, Q10, Q11] = INQUIRIES[3].questions;
  const view = (s) => ({ ...s.answers, q3: answerOf(s, Q3) || s.answers.q3 });

  // ── 탐구 1 ──
  const s1 = { key: 'inq1', title: `탐구 1. ${INQUIRIES[0].title}`, sub: `부산 예측 조위 — ${PREDICTED_TEXT}`, items: [] };
  if (on(Q1) || on(Q2)) {
    s1.items.push(fig('f1', `그림 1. 부산 예측 조위 3일 (${fmtRange(ad.win.inq1[0], ad.win.inq1[1], tz)}) — ${[on(Q1) && '①에서 고른 지점', on(Q2) && '②의 24시간(색칠)'].filter(Boolean).join(', ')}`, [{ height: 250, spec: (ctx) => inq1MainSpec(ctx, ad, view(state), { title: false }) }]));
    if (on(Q1)) s1.items.push(qa(Q1, 'inq1'));
    if (on(Q2)) s1.items.push(qa(Q2, 'inq1'));
  }
  if (on(Q3)) {
    s1.items.push(fig('f2', `그림 2. 부산 예측 조위 한 달 일별 변동 폭 (${ad.setup.month}) — ③에서 고른 날${rv.moon ? ', 달의 위상' : ''}`, [{ height: 220, spec: (ctx) => inq1DailySpec(ctx, ad, view(state), { showMoon: !!rv.moon, title: false }) }]));
    s1.items.push(qa(Q3, 'inq1'));
  }
  if (on(Q4)) {
    const a = answerOf(state, Q4) || {};
    const q = qa(Q4, 'inq1');
    if (!a.spring && !a.neap) missing.push({ step: 'inq1', qid: 'q4', label: qLabel(Q4) });
    s1.items.push({ ...q, type: 'drawings', items: [{ title: '대조일 때', drawing: a.spring || null }, { title: '소조일 때', drawing: a.neap || null }] });
  }
  if (rv.moon && ad.moon) {
    const ph = ad.moon.phases.filter((p) => p.t >= ad.win.month[0] - DAY && p.t < ad.win.month[1] + DAY);
    s1.items.push({ type: 'table', title: `확인한 달의 위상(계산값, ${tz.label}) — 확인 ${fmtDateTime(rv.moon.at, localTz())}`, head: ['위상', '시각'], rows: ph.map((p) => [p.label, fmtDateTime(p.t, tz)]) });
  } else if (on(Q3) || on(Q4)) s1.items.push({ type: 'note', text: '[달의 위상 확인]을 하지 않았습니다.' });
  if (!rv.moon && (on(Q3) || on(Q4))) missing.push({ step: 'inq1', label: '[달의 위상 확인]을 아직 누르지 않음', reveal: true });

  // ── 탐구 2 ──
  const s2 = { key: 'inq2', title: `탐구 2. ${INQUIRIES[1].title}`, sub: `인천·부산·묵호 예측 조위 · ${fmtRange(ad.win.inq2[0], ad.win.inq2[1], tz)} · ${DATUM_CAUTION}`, items: [] };
  if (on(Q5) || on(Q6)) {
    const mode = state.ui?.inq2Scale === 'own' ? 'own' : 'same';
    s2.items.push(fig('f3', `그림 3. 세 지역의 예측 조위(같은 시간 축, 세로 눈금: ${mode === 'same' ? '같은 눈금 크기' : '개별 눈금'})와 관측소 위치`, [
      ...ad.stationList.map((s, i) => ({ height: i === ad.stationList.length - 1 ? 165 : 150, spec: (ctx) => inq2Specs(ctx, ad, mode)[i] })),
      { map: (w, measure, fs) => stationsMapLayout({ stations: ad.stationList, width: w, measure, fontSize: fs, title: '관측소 위치' }), maxWidth: 240 },
    ]));
    if (on(Q5)) s2.items.push(qa(Q5, 'inq2'));
    if (on(Q6)) s2.items.push(qa(Q6, 'inq2'));
  }

  // ── 탐구 3 ──
  const s3 = { key: 'inq3', title: `탐구 3. ${INQUIRIES[2].title}`, sub: `부산 ${ad.setup.month} · 예측 조위: ${PREDICTED_TEXT} 관측 조위: ${OBSERVED_TEXT} 높이의 기준이 확인되지 않아 변동 폭만 비교함`, items: [] };
  if (on(Q7) || on(Q8)) {
    s3.items.push(fig('f4', `그림 4. 부산 예측 조위와 관측 조위(세로 눈금 간격 같음)${state.answers.q7?.t0 != null ? ' — ⑦에서 고른 구간' : ''}`, [
      { height: 180, spec: (ctx) => inq3Specs(ctx, ad, state.answers)[0] },
      { height: 195, spec: (ctx) => inq3Specs(ctx, ad, state.answers)[1] },
      { height: 185, spec: (ctx) => inq3DailySpec(ctx, ad, state.answers) },
    ]));
    if (on(Q7)) s3.items.push(qa(Q7, 'inq3'));
    if (on(Q8)) s3.items.push(qa(Q8, 'inq3'));
  }

  // ── 탐구 4 ──
  const s4 = { key: 'inq4', title: `탐구 4. ${INQUIRIES[3].title}`, sub: '부산 관측 조위 — 두 기간 비교(세로 눈금 간격 같음)', items: [] };
  s4.items.push(fig('f5', `그림 5. 부산 관측 조위 — ${periodTitle(ad, 'a', !!rv.weather)} / ${periodTitle(ad, 'b', !!rv.weather)}`, [0, 1].map((i) => ({ height: 185, spec: (ctx) => inq4TideSpecs(ctx, ad, { revealed: !!rv.weather })[i] }))));
  if (on(Q9)) s4.items.push(qa(Q9, 'inq4'));
  if (on(Q10)) s4.items.push(qa(Q10, 'inq4'));
  if (rv.weather) {
    s4.items.push({ type: 'note', text: `[추가 자료 확인] ${fmtDateTime(rv.weather.at, localTz())} — 아래는 그 뒤에 본 자료와 답입니다.` });
    for (const k of ['a', 'b']) {
      s4.items.push(fig(`f6${k}`, `그림 6${k === 'a' ? '가' : '나'}. ${periodTitle(ad, k, true)} — ${periodCd(ad, k).weather?.station?.name || '기상 관측 지점'} 해면기압·풍속·풍향(조위 그래프와 같은 시간 축)`, [
        { height: 140, spec: (ctx) => weatherSpec(ctx, ad, k, 'pressureSea', { title: false }) },
        { height: 125, spec: (ctx) => weatherSpec(ctx, ad, k, 'windSpeed', { title: false }) },
        { height: 125, spec: (ctx) => weatherSpec(ctx, ad, k, 'windDir', { title: false }) },
      ]));
    }
    if (ad.past?.typhoon) {
      const c = closestTyphoonPoint(ad);
      s4.items.push(fig('f7', `그림 7. ${ad.past.typhoon.meta?.title || ad.past.typhoon.name} — 기상청 실황 분석 위치(${PERIOD_NAMES.a})${c && ad.timeBasis?.confirmed ? ` · 부산 최근접 분석 위치 ${fmtDateTime(c.t, tz)}, 약 ${Math.round(c.km)} km` : ''}`, [{ map: (w, measure, fs) => typhoonMapLayout(ad, { width: w, measure, fontSize: fs }), maxWidth: 360 }]));
    }
    if (ad.recentTyphoonCheck?.text) s4.items.push({ type: 'note', text: `${PERIOD_NAMES.b} 태풍: ${ad.recentTyphoonCheck.text}` });
    s4.items.push({ type: 'note', text: '태풍 중심기압은 부산에서 잰 기압이 아니며, 시각이 가깝다는 것만으로 원인을 확정할 수 없습니다.' });
    if (on(Q11)) {
      const q = qa(Q11, 'inq4');
      s4.items.push({ ...q, type: 'side', leftTitle: `${CIRCLED[10]} 추가 자료 확인 전의 추측`, left: (answerOf(state, Q10) || '').trim(), rightTitle: `${CIRCLED[11]} 기상·태풍 자료를 근거로 한 설명`, right: q.lines.join('\n') });
    }
  } else {
    s4.items.push({ type: 'note', text: '[추가 자료 확인]을 하지 않아 추가 자료와 문항 ⑪은 보고서에 없습니다.' });
    missing.push({ step: 'inq4', label: '[추가 자료 확인]을 아직 누르지 않음', reveal: true });
    if (on(Q11)) missing.push({ step: 'inq4', qid: 'q11', label: qLabel(Q11) });
  }

  // ── 종합 ──
  const s5 = { key: 'conclusion', title: CONCLUSION.title, sub: CONCLUSION.goal, items: CONCLUSION.questions.filter(on).map((q) => qa(q, 'conclusion')) };

  const sections = [s1, s2, s3, s4, s5].filter((s) => s.items.length);
  return {
    appName: '조석 데이터 탐구실',
    title: '조석 데이터 탐구 보고서',
    student: { ...st },
    studentLine: studentLine(st),
    createdAt: Date.now(),
    createdText: fmtDateTime(Date.now(), localTz()),
    isSample: ad.isSample,
    sampleNotice: ad.sampleNotice,
    caseTitle: ad.title,
    info: infoRows(ad, state),
    sections,
    sources: sourceRows(ad, state),
    processing: limitationNotes(ad, state),
    missing,
  };
}

export function infoRows(ad, state) {
  const tz = ad.tz;
  const W = ad.win;
  const rv = state.reveals || {};
  return [
    ['학생', studentLine(state.student)],
    ['관측소', ad.stationList.map((s) => `${s.name}(${s.id}, ${s.sea})`).join(', ') + ' · 대표 관측소 부산'],
    ['탐구 1 (부산 예측)', `3일 ${fmtRange(W.inq1[0], W.inq1[1], tz)} · 한 달 ${ad.setup.month}`],
    ['탐구 2 (세 지역 예측)', fmtRange(W.inq2[0], W.inq2[1], tz)],
    ['탐구 3 (부산 예측·관측)', ad.setup.month],
    ['탐구 4 (부산 관측)', `${PERIOD_NAMES.a} ${fmtRange(W.a[0], W.a[1], tz)} / ${PERIOD_NAMES.b} ${fmtRange(W.b[0], W.b[1], tz)}`],
    ['시간대', `${tz.name || tz.label}${ad.timeBasis?.confirmed ? ' — 공식 자료와 대조해 확인' : ' — 확인되지 않음'}`],
    ['달의 위상 확인', rv.moon ? fmtDateTime(rv.moon.at, localTz()) : '하지 않음'],
    ['추가 자료 확인', rv.weather ? fmtDateTime(rv.weather.at, localTz()) : '하지 않음'],
    ['자료 버전', ad.dataVersion],
  ];
}

function dsLines(s, extra = []) {
  if (!s) return ['자료 미제공'];
  return [s.meta?.provider && `제공: ${s.meta.provider}`, s.meta?.title && `자료명: ${s.meta.title}`, s.meta?.identifier && `식별자: ${s.meta.identifier}`, ...extra].filter(Boolean);
}

export function sourceRows(ad, state) {
  const rv = state.reveals || {};
  const rep = ad.st[ad.rep];
  const out = [
    { role: '예측 조위(인천·부산·묵호)', lines: dsLines(rep.predicted, ['1시간 간격, 단위 cm. 값은 국립해양조사원 조석표의 매시 예측 조고와 같음(조석표 기준면 기준)']) },
    { role: '관측 조위(부산)', lines: dsLines(rep.observed, ['1시간 간격, 단위 cm. 높이 기준면은 자료 문서에 없음(미확인)']) },
  ];
  if (rv.weather) {
    out.push({ role: '기상(부산 ASOS)', lines: dsLines(rep.weather, [`관측 지점: ${rep.weather?.station?.name || '—'}${rep.weather?.station?.note ? ` (${rep.weather.station.note})` : ''}`, '해면기압·풍속·풍향(바람이 불어오는 방향), 1시간 간격']) });
    if (ad.past?.typhoon) out.push({ role: '태풍 정보', lines: dsLines(ad.past.typhoon, [ad.past.typhoon.trackKind && `경로 종류: ${ad.past.typhoon.trackKind}`, ad.past.typhoon.note].filter(Boolean)) });
  }
  if (rv.moon && ad.moon) out.push({ role: '달의 위상', lines: [ad.moon.meta.provider && `제공: ${ad.moon.meta.provider}`, ad.moon.meta.identifier && `식별자: ${ad.moon.meta.identifier}`].filter(Boolean) });
  out.push({ role: '시간대 확인', lines: [ad.timeBasis?.note || '', ad.timeBasis?.evidence ? `근거: ${ad.timeBasis.evidence}` : ''].filter(Boolean) });
  return out;
}

export function limitationNotes(ad, state) {
  const rv = state.reveals || {};
  const out = [
    '일별 변동 폭 = 그날(00:00~24:00) 1시간 간격 값의 최고값 − 최저값. 이웃한 만조·간조 한 쌍의 조차와는 다른 값이다.',
    '1시간 간격 자료를 직선으로 이었다. 실제 만조·간조 시각과 높이는 1시간 간격 값과 조금 다를 수 있다.',
    '만조·간조, 대조·소조, 조석 형태는 학생이 자료를 보고 판단한 것이며, 앱이 정답을 정하지 않았다.',
    '관측 조위의 높이 기준면이 확인되지 않아 관측소끼리, 예측과 관측끼리 높이를 겹치거나 빼지 않았다(변동 폭만 비교).',
    '결측·오류값은 0으로 바꾸지 않고 빈 값으로 두었다.',
  ];
  if (rv.weather) out.push('기상 자료는 조위관측소에서 떨어진 기상청 ASOS 지점의 값이며, 두 위치의 기압·바람이 같다고 단정할 수 없다. 해면기압만 사용했다(현지기압과 섞지 않음). 태풍 중심기압은 관측소 기압으로 쓰지 않았다.');
  return out;
}

export function pdfFilename(st) {
  const raw = `조석탐구_${st.grade || ''}학년${st.klass || ''}반${st.number || ''}번_${st.name || '이름없음'}.pdf`;
  return raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, '');
}

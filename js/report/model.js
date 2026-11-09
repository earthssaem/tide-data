// 보고서 구성 — 미리보기(HTML)와 PDF가 같은 구성을 사용한다(화면 답과 PDF 내용 일치).
// 학생이 쓰지 않은 답은 비워 두고 '작성하지 않음'으로만 표시한다(임의로 채우지 않음).
// 학생이 그래프에서 고른 지점·날짜·구간은 그 문항의 그래프에 그대로 그려 넣는다(같은 그래프를 쓰는 문항은 그림 하나를 함께 씀).
// 아직 공개하지 않은 자료(기상·태풍)는 보고서에도 나오지 않는다. 교사용 메모는 넣지 않는다.

import { INQUIRIES, CONCLUSION, REVEALS, CIRCLED, THINK2, PREDICTED_TEXT, OBSERVED_TEXT, DATUM_CAUTION, isEnabled, qLabel } from '../content/questions.js';
import { answerOf } from '../screens/common.js';
import { howLabel } from '../state/attempts.js';
import { fmtDurationKo } from '../assessment/session-log.js';
import { fmtRange, fmtDateTime, fmtDateKo, DAY, HOUR } from '../util/time.js';
import { fmtNum } from '../util/format.js';
import { layoutChart } from '../chart/layout.js';
import {
  inq1MainSpec, inq1MonthSpec, inq2Specs, stationsMapLayout, inq4TideSpecs, weatherSpec,
  typhoonMapLayout, extremaIn, q11PrevLines, periodTitle, periodCd, PERIOD_NAMES, periodTyphoonText,
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
      const t = (k) => { const [y, mo, d] = k.split('-').map(Number); return `${y}년 ${mo}월 ${d}일(${'일월화수목금토'[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]})`; };
      return [a.spring && `대조로 고른 날: ${t(a.spring)}`, a.neap && `소조로 고른 날: ${t(a.neap)}`].filter(Boolean);
    }
    case 'q4': return String(a?.reason || '').trim() ? [`조차가 크고 작은 이유: ${a.reason.trim()}`] : [];
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
    case 'q11': {
      const L = typeof a === 'string' && a.trim() ? [a.trim()] : [];
      const old = q11PrevLines(ad, state.answers.q11prev);
      if (old.length) L.push('(문항이 바뀌기 전에 쓴 답)', ...old);
      return L;
    }
    default: return typeof a === 'string' && a.trim() ? [a.trim()] : [];
  }
}

const fig = (id, caption, panels) => ({ type: 'figure', id, caption, panels });
// panels: [{height, spec:(ctx)=>spec} | {map:(width, measure, fontSize)=>layout, maxWidth}]

/** 그림의 각 패널을 배치(폭·글자 크기는 화면/PDF가 정함) */
export function layoutFigure(f, { width, measure, fontSize = 9.5 }) {
  // 그래프가 여러 개 쌓인 그림은 왼쪽 여백을 같게 해 가로축(시각)을 맞춘다
  const padLeft = f.panels.filter((p) => p.spec).length > 1 ? Math.round(fontSize * 5.6) : undefined;
  return f.panels.map((p) => {
    if (p.map) return p.map(Math.min(width, p.maxWidth || width), measure, fontSize);
    return layoutChart(p.spec({ width, height: p.height, measure, fontSize, padLeft }));
  }).filter(Boolean);
}

export function buildReport(ad, state, { attempts = null, others = [], departures = null } = {}) {
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
    if (q.id === 'q4' && !lines.length) missing.push({ step, qid: 'q4', label: `${qLabel(q)} 이유` });
    if (empty) missing.push({ step, qid: q.id, label: `${qLabel(q)}` });
    return {
      type: 'qa', id: q.id, label: qLabel(q), text: q.text, lines, empty,
      waitNote: waiting ? `[${REVEALS[q.afterReveal].label}]을 하지 않아 작성하지 않음` : '',
      lockedNote: lock ? `[${REVEALS[q.lockAfter].label}] 전에 작성한 답(${fmtDateTime(lock.at, localTz())})` : '',
    };
  };
  const [Q1, Q2, Q3, Q4] = INQUIRIES[0].questions;
  const [Q5, Q6] = INQUIRIES[1].questions;
  const D4 = INQUIRIES.find((d) => d.step === 'inq4');
  const [Q9, Q10, Q11] = D4.questions;
  const view = (s) => ({ ...s.answers, q3: answerOf(s, Q3) || s.answers.q3 });

  // ── 탐구 1 ──
  const s1 = { key: 'inq1', title: `탐구 1. ${INQUIRIES[0].title}`, sub: `부산 예측 조위 — ${PREDICTED_TEXT}`, items: [] };
  if (on(Q1) || on(Q2)) {
    s1.items.push(fig('f1', `그림 1. 부산 예측 조위 3일 (${fmtRange(ad.win.inq1[0], ad.win.inq1[1], tz)}) — ${[on(Q1) && '①에서 고른 지점', on(Q2) && '②의 24시간(색칠)'].filter(Boolean).join(', ')}`, [{ height: 250, spec: (ctx) => inq1MainSpec(ctx, ad, view(state), { title: false }) }]));
    if (on(Q1)) s1.items.push(qa(Q1, 'inq1'));
    if (on(Q2)) s1.items.push(qa(Q2, 'inq1'));
  }
  if (on(Q3)) {
    s1.items.push(fig('f2', `그림 2. 부산 예측 조위 한 달 (${ad.setup.month}) — ③에서 고른 날`, [{ height: 230, spec: (ctx) => inq1MonthSpec(ctx, ad, view(state), { title: false }) }]));
    s1.items.push(qa(Q3, 'inq1'));
  }
  if (on(Q4)) {
    const a = answerOf(state, Q4) || {};
    const q = qa(Q4, 'inq1');
    if (!a.spring && !a.neap) missing.push({ step: 'inq1', qid: 'q4', label: `${qLabel(Q4)} 배치` });
    s1.items.push({ ...q, type: 'drawings', items: [{ title: '대조일 때', orbit: a.spring || null }, { title: '소조일 때', orbit: a.neap || null }] });
    const oo = a.oldOrbits || state.answers.q4?.oldOrbits;
    if (oo && (oo.spring || oo.neap)) s1.items.push({ type: 'drawings', id: 'q4-old-orbit', label: `${qLabel(Q4)} (이전 배치판에 놓은 배치)`, text: '배치판 방식이 바뀌기 전에 놓은 배치입니다.', lines: [], items: [{ title: '대조일 때', freeOrbit: oo.spring || null }, { title: '소조일 때', freeOrbit: oo.neap || null }] });
    const od = a.oldDrawings || state.answers.q4?.oldDrawings;
    if (od && (od.spring || od.neap)) s1.items.push({ type: 'drawings', id: 'q4-old', label: `${qLabel(Q4)} (이전 그림판에 그린 그림)`, text: '배치판으로 바뀌기 전에 그린 그림입니다.', lines: [], items: [{ title: '대조일 때', drawing: od.spring || null }, { title: '소조일 때', drawing: od.neap || null }] });
  }

  // ── 탐구 2 ──
  const s2 = { key: 'inq2', title: `탐구 2. ${INQUIRIES[1].title}`, sub: `인천·부산·묵호 예측 조위 · ${fmtRange(ad.win.inq2[0], ad.win.inq2[1], tz)} · ${DATUM_CAUTION}`, items: [] };
  if (on(Q5) || on(Q6)) {
    const mode = state.ui?.inq2Scale === 'own' ? 'own' : 'same';
    s2.items.push(fig('f3', `그림 3. 세 지역의 예측 조위(같은 시간 축, 세로축: ${mode === 'same' ? '세 지역 같은 축(지역마다 기간 평균을 0으로)' : '지역별 확대(지역마다 눈금이 다름)'})와 관측소 위치`, [
      ...ad.stationList.map((s, i) => ({ height: i === ad.stationList.length - 1 ? 165 : 150, spec: (ctx) => inq2Specs(ctx, ad, mode)[i] })),
      { map: (w, measure, fs) => stationsMapLayout({ stations: ad.stationList, width: w, measure, fontSize: fs, title: '관측소 위치' }), maxWidth: 240 },
    ]));
    if (on(Q5)) s2.items.push(qa(Q5, 'inq2'));
    if (on(Q6)) s2.items.push(qa(Q6, 'inq2'));
  }
  // 잠깐 생각하기(선택·평가 제외): 쓴 경우에만, 설명 전문은 넣지 않음
  const th = String(state.answers.think2 || '').trim();
  if (th) s2.items.push({ type: 'qa', id: 'think2', label: THINK2.reportLabel, text: THINK2.question, lines: [th], empty: false, lockedNote: '', waitNote: '' });

  // ── 탐구 3(특이한 변화) ──
  const s4 = { key: 'inq4', title: `탐구 ${D4.no}. ${D4.title}`, sub: '부산 관측 조위 — 두 기간 비교(세로 눈금 간격 같음)', items: [] };
  s4.items.push(fig('f5', `그림 5. 부산 관측 조위 — ${periodTitle(ad, 'a', !!rv.weather)} / ${periodTitle(ad, 'b', !!rv.weather)}`, [0, 1].map((i) => ({ height: 185, spec: (ctx) => inq4TideSpecs(ctx, ad, { revealed: !!rv.weather })[i] }))));
  if (on(Q9)) s4.items.push(qa(Q9, 'inq4'));
  if (on(Q10)) s4.items.push(qa(Q10, 'inq4'));
  if (rv.weather) {
    s4.items.push({ type: 'note', text: `[추가 자료 확인] ${fmtDateTime(rv.weather.at, localTz())} — 아래는 그 뒤에 본 자료와 답입니다.` });
    for (const k of ['a', 'b']) {
      s4.items.push(fig(`f6${k}`, `그림 6${k === 'a' ? '가' : '나'}. ${periodTitle(ad, k, true)} — 관측 조위와 ${periodCd(ad, k).weather?.station?.name || '기상 관측 지점'} 해면기압·풍속(같은 시간 축, 가로축 맞춤)`, [
        { height: 150, spec: (ctx) => inq4TideSpecs(ctx, ad, { revealed: true, compact: true })[k === 'a' ? 0 : 1] },
        { height: 140, spec: (ctx) => weatherSpec(ctx, ad, k, 'pressureSea', { title: false }) },
        { height: 125, spec: (ctx) => weatherSpec(ctx, ad, k, 'windSpeed', { title: false }) },
      ]));
    }
    if (ad.past?.typhoon) {
      s4.items.push(fig('f7', `그림 7. ${ad.past.typhoon.meta?.title || ad.past.typhoon.name} — 기상청 실황 분석 위치(${PERIOD_NAMES.a}, 점 옆 숫자는 시각)`, [{ map: (w, measure, fs) => typhoonMapLayout(ad, { width: w, measure, fontSize: fs }), maxWidth: 360 }]));
    }
    s4.items.push({ type: 'note', text: `${PERIOD_NAMES.b} 태풍: ${periodTyphoonText(ad, 'b')}` });
    if (on(Q11)) {
      const q = qa(Q11, 'inq4');
      s4.items.push({ ...q, type: 'side', leftTitle: `${CIRCLED[Q10.no]} 추가 자료 확인 전의 추측`, left: (answerOf(state, Q10) || '').trim(), rightTitle: `${CIRCLED[Q11.no]} 추가 자료를 근거로 한 설명`, right: q.lines.join('\n') });
    }
  } else {
    s4.items.push({ type: 'note', text: `[추가 자료 확인]을 하지 않아 추가 자료와 문항 ${CIRCLED[Q11.no]}은 보고서에 없습니다.` });
    missing.push({ step: 'inq4', label: '[추가 자료 확인]을 아직 누르지 않음', reveal: true });
    if (on(Q11)) missing.push({ step: 'inq4', qid: 'q11', label: qLabel(Q11) });
  }

  // ── 종합 ──
  const s5 = { key: 'conclusion', title: CONCLUSION.title, sub: CONCLUSION.goal, items: CONCLUSION.questions.filter(on).map((q) => qa(q, 'conclusion')) };

  // ── 응시 기록(이 컴퓨터·브라우저) ──
  const s6 = { key: 'attempts', title: '응시 기록', sub: '이 컴퓨터에서 이 학생이 시작·불러오기·자료 확인을 한 기록입니다.', items: [] };
  const ev = attempts?.events || [];
  if (ev.length) {
    s6.items.push({ type: 'table', title: `기록 ${ev.length}건(시작 ${ev.filter((e) => e.how === 'new').length}회)`, head: ['시각', '내용'],
      rows: ev.map((e) => [fmtDateTime(e.at, localTz()), `${howLabel(e.how)}${e.fileUpdatedAt ? ` (백업 작성 ${fmtDateTime(e.fileUpdatedAt, localTz())})` : ''}${e.priorReveals?.length ? ` — 이전 공개 기록 적용: ${e.priorReveals.map((k) => REVEALS[k].label).join('·')}` : ''}`]) });
    if (ev.filter((e) => e.how === 'new').length > 1) s6.items.push({ type: 'note', text: '같은 컴퓨터에서 이 학생이 2번 이상 새로 시작했습니다. 이미 공개한 단계의 답은 처음 공개할 때의 답으로 고정되어 있습니다.' });
  } else s6.items.push({ type: 'note', text: '이 컴퓨터에 남은 응시 기록이 없습니다.' });
  // 같은 시간대(앞뒤 12시간)에 이 컴퓨터에서 다른 학생 정보로 남은 기록 — 다른 이름으로 자료를 먼저 확인했는지 교사가 볼 수 있게(이름은 첫 글자만)
  const oth = (others || []).flatMap((o) => o.events.map((e) => [fmtDateTime(e.at, localTz()), o.who, howLabel(e.how)])).sort((x, y) => (x[0] < y[0] ? -1 : 1));
  if (oth.length) {
    s6.items.push({ type: 'table', title: `같은 시간대(앞뒤 12시간)에 이 컴퓨터에서 다른 학생 정보로 남은 기록 ${oth.length}건(${others.length}명)`, head: ['시각', '학생 정보', '내용'], rows: oth.slice(0, 40) });
    if (oth.length > 40) s6.items.push({ type: 'note', text: `다른 학생 정보 기록 ${oth.length - 40}건은 생략했습니다.` });
  }

  // ── 화면 이탈 기록(평가 모드) — 이 PDF를 만든 시각까지 ──
  const s7 = { key: 'departures', title: '화면 이탈 기록', sub: '평가 중 전체화면 해제·다른 탭이나 창으로 이동·화면을 2초 이상 벗어난 기록입니다(이 보고서를 만든 시각까지).', items: [] };
  if (departures) {
    const t = (ms) => (ms == null ? '—' : fmtDateTime(ms, localTz()));
    const dur = (ms) => (ms == null ? '—' : fmtDurationKo(ms));
    const cur = departures.current;
    if (cur) {
      const total = cur.departures.reduce((a, d) => a + (d.durationMs || 0), 0);
      s7.items.push({ type: 'table', title: '이번 평가', head: ['항목', '내용'], rows: [
        ['세션', cur.id], ['평가 시작', t(cur.startedAt)], ['보고서 작성', t(departures.at)],
        ['화면 이탈', `${cur.departures.length}회${cur.departures.length ? ` · 합계 ${dur(total)}` : ''}`],
      ] });
      if (cur.departures.length) s7.items.push({ type: 'table', title: `이번 평가의 화면 이탈 ${cur.departures.length}회`, head: ['번호', '유형', '이탈', '복귀', '지속 시간'],
        rows: cur.departures.map((d) => [String(d.no), d.typeLabel, `${t(d.startedAt)}${d.startEstimated ? ' (추정)' : ''}`, d.returnedAt == null ? '복귀 전' : t(d.returnedAt), dur(d.durationMs)]) });
    } else s7.items.push({ type: 'note', text: '진행 중인 평가가 없을 때 만든 보고서입니다(평가 모드의 화면 이탈 기록 없음).' });
    if (departures.others?.length) {
      s7.items.push({ type: 'table', title: `같은 시간대(앞뒤 12시간)에 이 컴퓨터에서 진행한 다른 평가 ${departures.others.length}건`, head: ['세션', '시작', '종료(마지막 확인)', '화면 이탈'],
        rows: departures.others.map((s) => [s.id, t(s.startedAt), s.status === 'ended' ? t(s.endedAt) : `${t(s.lastSeenAt)} (종료 기록 없음)`, `${s.departures.length}회`]) });
    }
  }

  const sections = [s1, s2, s4, s5, s6, s7].filter((s) => s.items.length);
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
    ['탐구 3 (부산 관측)', `${PERIOD_NAMES.a} ${fmtRange(W.a[0], W.a[1], tz)} / ${PERIOD_NAMES.b} ${fmtRange(W.b[0], W.b[1], tz)}`],
    ['시간대', `${tz.name || tz.label}${ad.timeBasis?.confirmed ? ' — 공식 자료와 대조해 확인' : ' — 확인되지 않음'}`],
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
    out.push({ role: '기상(부산 ASOS)', lines: dsLines(rep.weather, [...(ad.weatherSite?.text ? [ad.weatherSite.text] : []), `관측 지점: ${rep.weather?.station?.name || '—'}${rep.weather?.station?.note ? ` (${rep.weather.station.note})` : ''}`, '해면기압·풍속, 1시간 간격']) });
    if (ad.past?.typhoon) out.push({ role: '태풍 정보', lines: dsLines(ad.past.typhoon, [ad.past.typhoon.trackKind && `경로 종류: ${ad.past.typhoon.trackKind}`, ad.past.typhoon.note].filter(Boolean)) });
  }
  const tb = ad.timeBasis || {};
  const tbNote = rv.weather ? tb.note : tb.confirmed ? '조위(예측·관측)는 국립해양조사원 조석표(시각 9hE)·바다누리 관측값과 대조해 KST로 확인' : tb.note;
  out.push({ role: '시간대 확인', lines: [tbNote || ''].filter(Boolean) }); // 근거 파일 경로(저장소 안)는 학생 보고서에 넣지 않음(README·교사용)
  return out;
}

export function limitationNotes(ad, state) {
  const rv = state.reveals || {};
  const out = [
    `일정한 간격(${ad.st[ad.rep].predicted10 ? '탐구 1의 3일 그래프는 10분, 나머지는 ' : ''}1시간)의 자료를 직선으로 이었다. 실제 만조·간조 시각과 높이는 자료 값과 조금 다를 수 있다.`,
    '만조·간조, 대조·소조, 조석 형태는 학생이 자료를 보고 판단한 것이며, 앱이 정답을 정하지 않았다.',
    '관측소마다 높이의 기준(0 cm)이 달라 관측소끼리 조위 숫자로 해수면 높낮이를 비교하지 않았다(탐구 2는 지역마다 기간 평균을 0으로 맞춰 오르내림만 비교).',
    '결측·오류값은 0으로 바꾸지 않고 빈 값으로 두었다.',
  ];
  if (rv.weather) out.push('기상 자료는 조위관측소에서 약 1 km 떨어진 기상청 ASOS 지점의 값이다(2022년 9월은 조위관측소 기상 자료가 제공되지 않음). 기압은 조위관측소 자체 기압과 거의 같았으나 바람은 장소에 따라 다를 수 있다. 해면기압만 사용했다(현지기압과 섞지 않음). 태풍 중심기압은 관측소 기압으로 쓰지 않았다.');
  return out;
}

export function pdfFilename(st) {
  const raw = `조석탐구_${st.grade || ''}학년${st.klass || ''}반${st.number || ''}번_${st.name || '이름없음'}.pdf`;
  return raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, '');
}

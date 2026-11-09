// 평가 세션과 화면 이탈 기록 — 순수 함수(브라우저 API 없음, 단위 검증 가능)
//
// 집계 원칙
//  - 하나의 이탈 '사건'이 열려 있는 동안 생기는 이벤트(blur, visibilitychange, fullscreenchange 등)는
//    같은 사건의 신호(signal)로만 추가하고, 이탈 횟수는 늘리지 않는다.
//  - 사건은 [전체화면으로 복귀]에 성공해 평가가 재개될 때 닫힌다.
//  - 사건 유형은 함께 들어온 신호 가운데 우선순위가 가장 높은 것으로 정한다.
//  - 브라우저 이벤트만으로 이탈 원인(다른 프로그램 사용 등)을 단정하지 않는다. 유형 이름은 '관찰된 신호'를 뜻한다.

export const LOG_FORMAT = 'tide-lab-assessment-log';
export const LOG_VERSION = 1;

export const DEPARTURE_TYPES = {
  'page-leave': { label: '페이지 이탈 신호(새로고침·닫기·이동 등)', priority: 5 },
  'fullscreen-exit': { label: '전체화면 해제', priority: 4 },
  hidden: { label: '화면 숨김(탭 전환·창 최소화 등)', priority: 3 },
  reconnect: { label: '재접속(이전 종료 신호가 기록되지 않음)', priority: 2 },
  'focus-loss': { label: '창 포커스 상실(2초 이상)', priority: 1 },
};

export const SIGNAL_LABELS = {
  blur: '창 포커스 상실(blur)',
  focus: '창 포커스 복귀(focus)',
  hidden: '화면 숨김(visibilitychange: hidden)',
  visible: '화면 표시(visibilitychange: visible)',
  'fullscreen-exit': '전체화면 해제(fullscreenchange)',
  'page-leave': '페이지 이탈(pagehide)',
  reload: '페이지 다시 불러옴',
  reconnect: '재접속(종료 신호 없음)',
  'focus-loss-threshold': '포커스 상실 2초 경과',
  'resume-failed': '전체화면 복귀 실패·취소',
  resume: '전체화면 복귀 성공·평가 재개',
};

export function emptyLog() {
  return { format: LOG_FORMAT, version: LOG_VERSION, activeId: null, sessions: [] };
}

export function makeSessionId(now, rand = Math.random) {
  const d = new Date(now);
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  return `asmt-${stamp}-${Math.floor(rand() * 36 ** 4).toString(36).padStart(4, '0')}`;
}

export function newSession({ id, startedAt, caseId = null, userAgent = '' }) {
  return {
    id, caseId, startedAt, endedAt: null, status: 'running', endReason: null,
    lastSeenAt: startedAt, userAgent, departures: [], appDialogNotes: [],
  };
}

export function openIncident(session) {
  const last = session.departures[session.departures.length - 1];
  return last && last.returnedAt == null ? last : null;
}

/**
 * 이탈 신호 반영. 열린 사건이 있으면 신호만 추가, 없으면 새 사건(이탈 1회)을 만든다.
 * @returns {{created:boolean, incident:object}}
 */
export function recordDeparture(session, { type, at, detail = '', estimated = false, extraSignals = [] }) {
  if (!DEPARTURE_TYPES[type]) throw new Error(`알 수 없는 이탈 유형: ${type}`);
  const signals = [...extraSignals, { type, at, detail }];
  let inc = openIncident(session);
  let created = false;
  if (!inc) {
    const startedAt = Math.min(...signals.map((s) => s.at));
    inc = {
      no: session.departures.length + 1,
      type,
      typeLabel: DEPARTURE_TYPES[type].label,
      startedAt,
      startEstimated: !!estimated,
      returnedAt: null,
      durationMs: null,
      signals: [],
    };
    session.departures.push(inc);
    created = true;
  } else if (DEPARTURE_TYPES[type].priority > DEPARTURE_TYPES[inc.type].priority) {
    inc.type = type;
    inc.typeLabel = DEPARTURE_TYPES[type].label;
  }
  for (const s of signals) inc.signals.push({ type: s.type, label: SIGNAL_LABELS[s.type] || s.type, at: s.at, detail: s.detail || '' });
  session.status = 'paused';
  return { created, incident: inc };
}

/** 열린 사건에 참고 신호만 추가(이탈 횟수 변화 없음) */
export function addSignal(session, { type, at, detail = '' }) {
  const inc = openIncident(session);
  if (!inc) return false;
  inc.signals.push({ type, label: SIGNAL_LABELS[type] || type, at, detail });
  return true;
}

/** 전체화면 복귀 성공 → 사건 닫기, 평가 재개 */
export function closeIncident(session, at) {
  const inc = openIncident(session);
  if (inc) {
    inc.signals.push({ type: 'resume', label: SIGNAL_LABELS.resume, at, detail: '' });
    inc.returnedAt = at;
    inc.durationMs = Math.max(0, at - inc.startedAt);
  }
  session.status = 'running';
  return inc;
}

/** 정상 종료(이탈로 집계하지 않음) */
export function endSession(session, at, reason = '학생이 [평가 종료]를 눌러 정상 종료') {
  const inc = openIncident(session);
  if (inc) {
    inc.signals.push({ type: 'ended-while-paused', label: '중지 상태에서 평가 종료', at, detail: '' });
    inc.returnedAt = null;
  }
  session.status = 'ended';
  session.endedAt = at;
  session.endReason = reason;
  return session;
}

export function departureCount(session) {
  return session ? session.departures.length : 0;
}

/** 로그 정리: 형식 확인, 세션 수 제한 */
export function sanitizeLog(obj, maxSessions = 30) {
  if (!obj || typeof obj !== 'object' || obj.format !== LOG_FORMAT || !Array.isArray(obj.sessions)) return emptyLog();
  const log = { format: LOG_FORMAT, version: LOG_VERSION, activeId: typeof obj.activeId === 'string' ? obj.activeId : null, sessions: obj.sessions.filter((s) => s && typeof s.id === 'string' && Array.isArray(s.departures)) };
  if (log.sessions.length > maxSessions) {
    const keep = log.sessions.slice(-maxSessions);
    if (log.activeId && !keep.some((s) => s.id === log.activeId)) keep.unshift(log.sessions.find((s) => s.id === log.activeId));
    log.sessions = keep.filter(Boolean);
  }
  if (log.activeId && !log.sessions.some((s) => s.id === log.activeId && s.status !== 'ended')) log.activeId = null;
  return log;
}

// ── 내보내기 ──
export function localIso(ms) {
  if (ms == null) return null;
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const p2 = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}${sign}${p2(off / 60)}:${p2(off % 60)}`;
}

export function fmtDurationKo(ms) {
  if (ms == null) return null;
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return [h ? `${h}시간` : '', m ? `${m}분` : '', `${r}초`].filter(Boolean).join(' ');
}

/**
 * 보고서(PDF)에 넣을 평가 세션: 지금 진행 중인 세션(자세히)과, 앞뒤 windowMs 안에 이 컴퓨터에 남은 다른 세션(요약).
 * 다른 세션도 넣는 까닭: [평가 종료] 뒤 새 평가를 시작해 이탈 횟수를 0으로 되돌린 경우도 교사가 볼 수 있게.
 */
export function reportSessions(log, { now = Date.now(), windowMs = 12 * 3600e3 } = {}) {
  const sessions = log?.sessions || [];
  const current = sessions.find((s) => s.id === log.activeId && s.status !== 'ended') || null;
  const others = sessions.filter((s) => s !== current && (s.lastSeenAt ?? s.startedAt) >= now - windowMs && s.startedAt <= now + windowMs);
  return { current, others, at: now };
}

export const EXPORT_NOTICE = [
  '이 기록은 브라우저 이벤트(fullscreenchange, visibilitychange, blur/focus, pagehide)로 수집한 참고 자료입니다.',
  '브라우저 이벤트만으로 이탈 원인이나 다른 프로그램 사용 여부를 알 수 없습니다. 유형은 관찰된 신호를 뜻합니다.',
  '브라우저 종료·비정상 종료·전원 차단 등에서는 일부 이벤트가 기록되지 않을 수 있습니다.',
  '기록은 학생 컴퓨터의 브라우저(localStorage)에 저장되므로 수정될 수 있으며 무결성이 보장되지 않습니다.',
  '이 기록만으로 부정행위를 판정하거나 감점하지 마십시오.',
];

export function exportLog(log, { student = null, now = Date.now(), app = '조석 데이터 탐구실' } = {}) {
  return {
    format: LOG_FORMAT,
    version: LOG_VERSION,
    app,
    exportedAt: localIso(now),
    notice: EXPORT_NOTICE,
    student,
    currentSessionId: log.activeId || (log.sessions[log.sessions.length - 1]?.id ?? null),
    sessions: log.sessions.map((s) => ({
      sessionId: s.id,
      caseId: s.caseId,
      status: s.status,
      startedAt: localIso(s.startedAt),
      endedAt: localIso(s.endedAt),
      endReason: s.endReason,
      lastSeenAt: localIso(s.lastSeenAt),
      departureCount: s.departures.length,
      totalDepartureMs: s.departures.reduce((a, d) => a + (d.durationMs || 0), 0),
      departures: s.departures.map((d) => ({
        no: d.no,
        type: d.type,
        typeLabel: d.typeLabel,
        startedAt: localIso(d.startedAt),
        startEstimated: d.startEstimated,
        returnedAt: localIso(d.returnedAt),
        durationMs: d.durationMs,
        duration: fmtDurationKo(d.durationMs),
        signals: d.signals.map((g) => ({ type: g.type, label: g.label, at: localIso(g.at), detail: g.detail })),
      })),
      appDialogNotes: (s.appDialogNotes || []).map((n) => ({ kind: n.kind, from: localIso(n.from), to: localIso(n.to) })),
      userAgent: s.userAgent,
    })),
  };
}

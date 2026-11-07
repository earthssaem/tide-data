// 화면 이탈 기록 규칙 단위 검증
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyLog, newSession, recordDeparture, addSignal, closeIncident, endSession, openIncident,
  departureCount, sanitizeLog, exportLog, makeSessionId,
} from '../../js/assessment/session-log.js';

const T = 1_800_000_000_000;

test('한 행동의 여러 신호(blur → hidden → 전체화면 해제)는 이탈 1회', () => {
  const s = newSession({ id: 'a', startedAt: T });
  const r1 = recordDeparture(s, { type: 'hidden', at: T + 1000, extraSignals: [{ type: 'blur', at: T + 990 }] });
  const r2 = recordDeparture(s, { type: 'fullscreen-exit', at: T + 1010 });
  addSignal(s, { type: 'focus', at: T + 5000 });
  assert.equal(r1.created, true);
  assert.equal(r2.created, false);
  assert.equal(departureCount(s), 1);
  const inc = s.departures[0];
  assert.equal(inc.startedAt, T + 990, '시작 시각은 가장 먼저 들어온 신호');
  assert.equal(inc.type, 'fullscreen-exit', '우선순위가 높은 유형으로 정리');
  assert.equal(inc.signals.length, 4);
  assert.equal(s.status, 'paused');
});

test('복귀하면 사건이 닫히고 지속 시간 계산, 다음 이탈은 새로 집계', () => {
  const s = newSession({ id: 'a', startedAt: T });
  recordDeparture(s, { type: 'fullscreen-exit', at: T + 1000 });
  closeIncident(s, T + 13_500);
  assert.equal(s.departures[0].returnedAt, T + 13_500);
  assert.equal(s.departures[0].durationMs, 12_500);
  assert.equal(s.status, 'running');
  assert.equal(openIncident(s), null);
  recordDeparture(s, { type: 'focus-loss', at: T + 20_000 });
  assert.equal(departureCount(s), 2);
  assert.equal(s.departures[1].no, 2);
});

test('중지 중 복귀 실패는 신호로만 남고 횟수는 그대로', () => {
  const s = newSession({ id: 'a', startedAt: T });
  recordDeparture(s, { type: 'fullscreen-exit', at: T + 1 });
  addSignal(s, { type: 'resume-failed', at: T + 2, detail: '사용자 취소' });
  recordDeparture(s, { type: 'page-leave', at: T + 3 });
  addSignal(s, { type: 'reload', at: T + 4 });
  assert.equal(departureCount(s), 1);
  assert.equal(s.departures[0].type, 'page-leave');
  assert.equal(s.status, 'paused');
});

test('열린 사건이 없으면 참고 신호는 기록되지 않음', () => {
  const s = newSession({ id: 'a', startedAt: T });
  assert.equal(addSignal(s, { type: 'focus', at: T }), false);
  assert.equal(departureCount(s), 0);
});

test('정상 종료는 이탈로 집계하지 않음', () => {
  const s = newSession({ id: 'a', startedAt: T });
  endSession(s, T + 60_000);
  assert.equal(departureCount(s), 0);
  assert.equal(s.status, 'ended');
  assert.equal(s.endedAt, T + 60_000);
});

test('재접속(종료 신호 없음)은 추정 시작 시각으로 기록', () => {
  const s = newSession({ id: 'a', startedAt: T });
  s.lastSeenAt = T + 30_000;
  recordDeparture(s, { type: 'reconnect', at: s.lastSeenAt, estimated: true });
  assert.equal(s.departures[0].startEstimated, true);
  assert.equal(s.departures[0].startedAt, T + 30_000);
});

test('잘못된 저장 형식은 빈 기록으로, 세션 수 제한 시 진행 중 세션 유지', () => {
  assert.deepEqual(sanitizeLog({ format: 'x' }), emptyLog());
  const log = emptyLog();
  for (let i = 0; i < 5; i++) log.sessions.push({ ...newSession({ id: `s${i}`, startedAt: T + i }), status: i === 0 ? 'running' : 'ended' });
  log.activeId = 's0';
  const c = sanitizeLog(JSON.parse(JSON.stringify(log)), 3);
  assert.equal(c.sessions.length, 4);
  assert.ok(c.sessions.some((s) => s.id === 's0'));
  assert.equal(c.activeId, 's0');
});

test('내보내기: 세션 ID, 시작·종료, 이탈 횟수, 개별 사건, 안내문 포함', () => {
  const log = emptyLog();
  const s = newSession({ id: makeSessionId(T), startedAt: T });
  recordDeparture(s, { type: 'hidden', at: T + 1000 });
  closeIncident(s, T + 4000);
  endSession(s, T + 9000);
  log.sessions.push(s);
  const out = exportLog(log, { student: { name: '김학생' }, now: T + 10_000 });
  assert.match(out.sessions[0].sessionId, /^asmt-\d{8}-\d{6}-[0-9a-z]{4}$/);
  assert.ok(out.sessions[0].startedAt && out.sessions[0].endedAt);
  assert.equal(out.sessions[0].departureCount, 1);
  assert.equal(out.sessions[0].departures[0].durationMs, 3000);
  assert.equal(out.sessions[0].departures[0].duration, '3초');
  assert.ok(out.notice.some((n) => n.includes('부정행위')));
  assert.equal(out.student.name, '김학생');
});

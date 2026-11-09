// 응시 기록(재응시 공정성)
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.window = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } };
const A = await import('../../js/state/attempts.js');
const { emptyState } = await import('../../js/state/persistence.js');

test('학생 구분: 공백·기호·대소문자 차이 무시, 이름·번호 없으면 기록 안 함', () => {
  const a = A.studentKey('c', { grade: '2', klass: '3', number: '7', name: '홍 길동' });
  assert.equal(a, A.studentKey('c', { grade: '2', klass: '3', number: '7', name: '홍길동.' }));
  assert.notEqual(a, A.studentKey('c', { grade: '2', klass: '3', number: '8', name: '홍길동' }));
  assert.equal(A.studentKey('c', { grade: '2', klass: '3', number: '', name: '' }), null);
});

test('공개 기록: 새로 시작·공개 전 백업에도 처음 공개한 답으로 고정, 학생 삭제 키와 분리', () => {
  store.clear();
  const st = { grade: '2', klass: '3', number: '7', name: '홍길동' };
  A.recordEvent('c', st, 'new');
  A.recordReveal('c', st, 'weather', { at: 1000, answers: { q9: '처음 답', q10: '' } });
  A.recordReveal('c', st, 'weather', { at: 5000, answers: { q9: '나중 답', q10: '' } });
  // 새로 시작한 작성 내용
  const s = emptyState('c', 'v'); s.student = { ...st, name: '홍길동 ' };
  assert.deepEqual(A.applyPriorReveals(s), ['weather']);
  assert.equal(s.reveals.weather.answers.q9, '처음 답');
  assert.equal(s.reveals.moon, null);
  // 공개 기록이 더 늦은 백업도 처음 공개 기록으로
  const s2 = emptyState('c', 'v'); s2.student = st; s2.reveals.weather = { at: 9000, answers: { q9: '바꾼 답', q10: '' } };
  A.applyPriorReveals(s2);
  assert.equal(s2.reveals.weather.at, 1000);
  // 다른 학생·다른 사례에는 적용 안 함
  const s3 = emptyState('c', 'v'); s3.student = { ...st, number: '8' };
  assert.deepEqual(A.applyPriorReveals(s3), []);
  assert.ok(A.STUDENT_ATTEMPTS_KEY.startsWith('tideLabAssess.'), '학생의 내 작성 내용 삭제(tideLab.*)로 지워지지 않는 키');
  assert.equal(A.entryFor('c', st).events.map((e) => e.how).join(','), 'new,reveal-weather,reveal-weather');
});

test('같은 시간대 다른 학생 정보 기록: 12시간 안의 사건만, 이름은 첫 글자만, 다른 사례 제외', () => {
  store.clear();
  const me = { grade: '2', klass: '3', number: '7', name: '홍길동' };
  const fake = { grade: '2', klass: '3', number: '70', name: '가짜' };
  const realNow = Date.now;
  let t = 1_000_000_000_000;
  Date.now = () => t;
  try {
    A.recordEvent('c', fake, 'new');
    A.recordReveal('c', fake, 'weather', { at: t, answers: { q9: '', q10: '' } });
    t += 3600e3; A.recordEvent('c', me, 'new');
    t += 3600e3; A.recordEvent('c', { ...fake, number: '71' }, 'new');
    A.recordEvent('other', fake, 'new');
    t += 30 * 3600e3; A.recordEvent('c', { grade: '1', klass: '1', number: '1', name: '먼학생' }, 'new');
  } finally { Date.now = realNow; }
  const o = A.othersNear('c', me);
  assert.equal(o.length, 2);
  assert.equal(o[0].who, '2학년 3반 70번 가○');
  assert.deepEqual(o[0].events.map((e) => e.how), ['new', 'reveal-weather']);
  assert.ok(!o.some((x) => x.who.includes('먼')), '12시간 밖은 제외');
  assert.deepEqual(A.othersNear('c', { ...me, number: '9' }), [], '기록 없는 학생은 비교하지 않음');
  assert.equal(A.maskStudent({ grade: '1', klass: '2', number: '3', name: '김' }), '1학년 2반 3번 김○');
});

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

// 수행평가 흐름: 평가 설정 적용·검증, 저장 형식 2, 보고서 순서·공개 전 자료 숨김 (실제 부산 2022-09 자료 사용)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadRegistry, loadCase, stationCaseData } from '../../js/data/loader.js';
import {
  parseSetup, applyAssessment, enabledStations, validateStationSetup, studentDeployment, availableMonths, compareCandidates, monthRange,
} from '../../js/setup/setup.js';
import { emptyState, sanitizeState, sanitizeDrawing, parseBackup, makeBackupText } from '../../js/state/persistence.js';
import { buildReport } from '../../js/report/model.js';
import { snapshotEvidence } from '../../js/state/evidence.js';
import { figurePanels } from '../../js/chart/specs.js';
import { activeQuestions, INQUIRIES } from '../../js/content/questions.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readText = (p) => readFile(join(ROOT, p), 'utf8');
const measure = (t, s) => String(t).length * s * 0.55;

async function multi() {
  const reg = await loadRegistry(readText);
  return loadCase(reg.cases.find((c) => c.id === 'khoa-multi-2022-09'), readText);
}
const deployed = async () => parseSetup(JSON.parse(await readText('data/assessment.json')));

test('배포 설정: 부산만 평가에 사용, 기간·구간 적용, 모든 관측소는 근거용으로 유지', async () => {
  const cd0 = await multi();
  const cfg = await deployed();
  const cd = applyAssessment(cd0, cfg);
  assert.deepEqual(enabledStations(cd).map((s) => s.id), ['DT_0005']);
  assert.equal(cd.stations.length, 11, '11개 관측소 자료 보존');
  const b = stationCaseData(cd, 'DT_0005');
  assert.deepEqual(b.ranges.inq2, monthRange('2022-09', b.tz));
  assert.equal(b.ranges.inq1[1] - b.ranges.inq1[0], 3 * 864e5);
  assert.equal(b.setup.reviewed, false, '임시 후보(교사 검토 필요)');
  assert.ok(b.typhoon && b.keyTimes.length > 0);
  assert.deepEqual(compareCandidates(b), [], '평가에 쓰지 않는 관측소는 비교 후보가 아님');
});

test('관측소별 설정: 구간·자료 연결 해제 적용(없는 자료는 만들지 않음)', async () => {
  const cd0 = await multi();
  const cfg = parseSetup({
    format: 'tide-lab-assessment-setup', version: 1, caseId: 'khoa-multi-2022-09',
    stations: {
      DT_0001: { enabled: true, month: '2022-09', basic: { start: '2022-09-20 00:00', end: '2022-09-23 00:00' }, focus: { start: '2022-09-04 00:00', end: '2022-09-08 00:00' }, links: { moon: false, weather: false, typhoon: false }, memo: '비밀' },
      DT_0005: { enabled: true },
    },
  });
  const cd = applyAssessment(cd0, cfg);
  const a = stationCaseData(cd, 'DT_0001');
  assert.equal(a.moon, null); assert.equal(a.weather, null); assert.equal(a.typhoon, null);
  assert.equal(a.availability.weather, false);
  assert.deepEqual(a.keyTimes, [], '태풍을 끄면 태풍 관련 시각도 없음');
  assert.equal(a.raw.weather != null, true, '원자료는 그대로');
  assert.deepEqual(compareCandidates(a).map((s) => s.id), ['DT_0005']);
  const dep = studentDeployment(cfg);
  assert.ok(!JSON.stringify(dep).includes('비밀'), '학생용 배포 파일에는 교사용 메모 없음');
});

test('설정 검증: 범위 밖·결측·위상·예측 필요 문항', async () => {
  const cd0 = await multi();
  const raw = stationCaseData(cd0, 'DT_0005');
  assert.deepEqual(availableMonths(raw).map((m) => m.key), ['2022-09']);
  const base = { enabled: true, month: '2022-09', basic: { start: '2022-09-13 00:00', end: '2022-09-16 00:00' }, focus: { start: '2022-09-04 00:00', end: '2022-09-08 00:00' }, links: { moon: true, weather: true, typhoon: true }, questions: {}, reviewed: false, memo: '' };
  let v = validateStationSetup(raw, base);
  assert.equal(v.filter((x) => x.level === 'error').length, 0);
  assert.ok(v.some((x) => x.area === '검토' && /교사 검토 필요/.test(x.text)));
  v = validateStationSetup(raw, { ...base, focus: { start: '2022-10-02 00:00', end: '2022-10-03 00:00' } });
  assert.ok(v.some((x) => x.level === 'error' && /밖에 있습니다/.test(x.text)));
  v = validateStationSetup(raw, { ...base, month: '2023-01' });
  assert.ok(v.some((x) => x.level === 'error' && /관측 조위가 없습니다/.test(x.text)));
  v = validateStationSetup(raw, { ...base, questions: { a5q5: true } });
  assert.ok(v.some((x) => x.level === 'error' && /조위 잔차/.test(x.text)), '예측 조위가 없으면 선택 문항 오류');
  v = validateStationSetup(raw, { ...base, links: { ...base.links, moon: false } });
  assert.ok(v.some((x) => x.area === '달의 위상' && x.level === 'warn'));
  // 결측이 있는 구간(가짜 결측을 만들지 않고, 원자료 한 점을 비운 복사본으로 확인)
  const holed = { ...raw, observed: { ...raw.observed, points: raw.observed.points.map((p) => (p.t === raw.observed.points[300].t ? { ...p, v: null } : p)) } };
  v = validateStationSetup(holed, { ...base, focus: { start: '2022-09-12 00:00', end: '2022-09-14 00:00' } });
  assert.ok(v.some((x) => x.area === '집중 관찰 구간' && /결측 1개/.test(x.text)));
});

test('저장 형식 2: 이전 형식 거부(원본 보존은 앱에서), 그림·공개 상태 정리', () => {
  assert.throws(() => sanitizeState({ format: 'tide-lab-save', schemaVersion: 1, caseId: 'x' }), /이전 버전/);
  const r = parseBackup(JSON.stringify({ format: 'tide-lab-backup', schemaVersion: 1, caseId: 'x', work: {} }), { knownCaseIds: ['x'], currentCaseId: 'x', currentDataVersion: '' });
  assert.equal(r.ok, false); assert.match(r.error, /보관하세요/);
  const d = sanitizeDrawing({ w: 640, h: 360, strokes: [{ c: 'red', w: 99, p: [[-5, 10], [700, 400], ['x', 1]] }], texts: [{ x: 1, y: 2, t: '달', c: '#c92a2a', s: 18 }, { t: '' }] });
  assert.deepEqual(d.strokes[0].p, [[0, 10], [640, 360]]);
  assert.equal(d.strokes[0].c, '#1d2733'); assert.equal(d.strokes[0].w, 14); assert.equal(d.texts.length, 1);
  const s = emptyState('khoa-multi-2022-09', 'v');
  s.started = true; s.stationId = 'DT_0005';
  s.answers.a2q4 = '일직선'; s.drawings.a2q4 = d;
  s.reveals.moon = { at: 1, answers: { a2q4: '일직선' }, drawing: d };
  s.byStation.DT_0001 = { answers: { a1q1: '인천 답' }, links: {}, drawings: {}, reveals: {}, analysis: {} };
  const back = sanitizeState(JSON.parse(JSON.stringify(s)));
  assert.equal(back.reveals.moon.answers.a2q4, '일직선');
  assert.equal(back.reveals.weather, null);
  assert.equal(back.byStation.DT_0001.answers.a1q1, '인천 답');
  const b2 = parseBackup(makeBackupText(back), { knownCaseIds: ['khoa-multi-2022-09'], currentCaseId: 'khoa-multi-2022-09', currentDataVersion: 'v' });
  assert.equal(b2.ok, true);
});

test('보고서: 새 순서, 공개 전에는 위상·태풍 정보 없음, 교사 메모 없음', async () => {
  const cfg = await deployed();
  cfg.stations.DT_0005.memo = '교사메모';
  const cd = stationCaseData(applyAssessment(await multi(), cfg), 'DT_0005');
  const s = emptyState(cd.id, cd.dataVersion);
  s.student = { grade: '3', klass: '1', number: '2', name: '가' };
  s.stationId = 'DT_0005';
  s.answers.a4q1 = '처음 추측';
  let m = buildReport(cd, s);
  assert.deepEqual(m.parts.map((p) => p.key), ['inq1', 'inq2', 'inq2-pos', 'inq2-moon', 'inq3', 'inq4', 'inq5']);
  const all = JSON.stringify(m);
  assert.ok(!/힌남노|HINNAMNOR/.test(all), '공개 전 태풍 정보 없음');
  assert.ok(!all.includes('교사메모'));
  assert.equal(m.parts.find((p) => p.key === 'inq2-moon').table, null);
  assert.equal(m.parts.find((p) => p.key === 'inq5').blocks.length, 0);
  s.reveals.moon = { at: 2, answers: {}, drawing: null };
  s.reveals.weather = { at: 3, answers: { a4q1: '처음 추측' }, drawing: null };
  s.answers.a4q1 = '고친 추측(무시돼야 함)';
  s.answers.a5q3 = '보완 설명';
  m = buildReport(cd, s);
  assert.ok(m.caseInfo.some(([k, v]) => k.startsWith('태풍') && v.includes('힌남노')));
  assert.ok(m.parts.find((p) => p.key === 'inq2-moon').table.rows.length >= 4);
  const b = m.parts.find((p) => p.key === 'inq5').blocks.find((x) => x.id === 'a5q3');
  assert.equal(b.sideBySide.left, '처음 추측', '초기 추측은 공개 시점 답');
  assert.equal(b.answer, '보완 설명');
  assert.equal(m.parts.find((p) => p.key === 'inq4').blocks[0].answer, '처음 추측');
  assert.ok(m.processing.some((x) => /잔차\)를 계산하지 않았다/.test(x)), '예측 조위 없음 한계');
  assert.equal(activeQuestions(INQUIRIES[4], cd.setup).some((q) => q.id === 'a5q5'), false, '선택 문항은 기본 꺼짐');
});

test('근거: 탐구 3(집중 구간)·탐구 5(기상·태풍) 그림과 측정값', async () => {
  const cd = stationCaseData(applyAssessment(await multi(), await deployed()), 'DT_0005');
  const t = Date.UTC(2022, 8, 5, 20); // 2022-09-06 05:00 KST
  const e3 = snapshotEvidence(cd, 3, { view: null, points: [{ label: 'A', t }], pair: null });
  assert.equal(e3.values.points[0].v, 184);
  assert.equal(e3.values.days.length, 4);
  assert.equal(figurePanels(cd, { ...e3, id: 'x', num: '3-1' }, { width: 500, measure }).length, 2);
  const e5 = snapshotEvidence(cd, 5, { view: null, marks: [{ label: 'A', t }], cursor: null, panels: null });
  assert.equal(e5.values.marks[0].obs, 184);
  assert.ok(e5.values.marks[0].weather.pressureSea > 900);
  assert.ok(e5.values.typhoon.nearest.distKm < 25);
  const panels = figurePanels(cd, { ...e5, id: 'y', num: '5-1' }, { width: 500, measure });
  assert.ok(panels.every((p) => !p.spec || !/잔차/.test(p.spec.header?.title || '')), '예측 없음 → 잔차 그래프 없음');
});

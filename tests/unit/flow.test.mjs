// 수행평가 흐름(형식 3): 사례 불러오기, 평가 설정, 저장 형식, 자료 공개 고정, 보고서 구성
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadRegistry, loadCase } from '../../js/data/loader.js';
import { applySetup, parseSetup, defaultSetup, validateSetup, studentDeployment } from '../../js/setup/setup.js';
import { emptyState, sanitizeState, parseBackup, makeBackupText, SCHEMA_VERSION } from '../../js/state/persistence.js';
import { buildReport, answerLines, layoutFigure } from '../../js/report/model.js';
import { yDomains, extremaIn, inq4TideSpecs, periodTitle, monthDays } from '../../js/chart/assess.js';
import { layoutChart } from '../../js/chart/layout.js';
import { ALL_QUESTIONS, INQUIRIES } from '../../js/content/questions.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readText = (p) => readFile(join(ROOT, p), 'utf8');
const measure = (t, s) => String(t).length * s * 0.6;
async function load(id) {
  const reg = await loadRegistry(readText);
  return loadCase(reg.cases.find((c) => c.id === id), readText);
}
const deployed = () => parseSetup(JSON.parse(readFileSync(join(ROOT, 'data/assessment.json'), 'utf8')));
const allText = (m) => JSON.stringify(m.sections.map((s) => ({ ...s, items: s.items.map(({ panels, ...r }) => r) }))) + JSON.stringify(m.sources) + JSON.stringify(m.processing) + JSON.stringify(m.info);

test('실제 사례: 인천·부산·묵호 1년, 부산 2022-09·태풍, 시간대 확인 근거', async () => {
  const ad = await load('khoa-assess-2025-26');
  assert.equal(ad.isSample, false);
  assert.deepEqual(ad.stationList.map((s) => s.id), ['DT_0001', 'DT_0005', 'DT_0006']);
  assert.equal(ad.rep, 'DT_0005');
  assert.equal(ad.months.length, 12);
  for (const id of ['DT_0001', 'DT_0005', 'DT_0006']) {
    assert.equal(ad.st[id].predicted.points.length, 8760);
    assert.equal(ad.st[id].observed.points.length, 8760);
    assert.equal(ad.st[id].observed.datumConfirmed, false);
  }
  assert.ok(ad.st.DT_0005.weather.fields.pressureSea);
  assert.equal(ad.past.observed.points.length, 720);
  assert.ok(ad.past.typhoon.track.length > 10);
  assert.equal(ad.timeBasis.confirmed, true);
  assert.match(ad.timeBasis.evidence, /time-check/);
  const r = JSON.parse(readFileSync(join(ROOT, 'data/raw/khoa-2025-26/time-check/result.json'), 'utf8'));
  assert.equal(r.confirmed, true);
  assert.ok(r.results.every((x) => x.ok));
});

test('배포 설정: 분석 연월·구간 적용, 메모는 배포 파일에 없음', async () => {
  const ad0 = await load('khoa-assess-2025-26');
  const cfg = deployed();
  assert.equal(cfg.caseId, 'khoa-assess-2025-26');
  const ad = applySetup(ad0, cfg);
  const f = (t) => new Date(t + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  assert.deepEqual(ad.win.a.map(f), ['2022-09-04 00:00', '2022-09-09 00:00']);
  assert.deepEqual(ad.win.b.map(f), ['2022-09-25 00:00', '2022-09-30 00:00']);
  assert.deepEqual(ad.win.count.map(f), ['2026-09-11 00:00', '2026-09-12 00:00']);
  assert.equal(ad.win.month[1] - ad.win.month[0], 30 * 864e5);
  const dep = studentDeployment({ ...cfg, memo: '교사 메모' });
  assert.equal('memo' in dep, false);
  // 이전 형식 설정은 읽지 않는다
  assert.throws(() => parseSetup({ format: 'tide-lab-assessment-setup', version: 1, caseId: 'x', stations: {} }), /이전 구성/);
});

test('설정 검증: 잘못된 구간은 오류, 바른 구간은 확인', async () => {
  const ad = await load('khoa-assess-2025-26');
  const ok = validateSetup(ad, defaultSetup(ad));
  assert.equal(ok.filter((x) => x.level === 'error').length, 0);
  const bad = { ...defaultSetup(ad), month: '2026-09', inq1: { start: '2026-08-30 00:00', end: '2026-09-02 00:00', countStart: '2026-09-05 00:00' }, inq4: { a: { start: '2021-01-01 00:00', end: '2021-01-05 00:00' }, b: { start: '2026-09-19 00:00', end: '2026-09-24 00:00' } } };
  const v = validateSetup(ad, bad);
  assert.ok(v.some((x) => x.level === 'error' && /분석 연월\(2026-09\) 밖/.test(x.text)));
  assert.ok(v.some((x) => x.level === 'error' && /24시간 구간/.test(x.text)));
  assert.ok(v.some((x) => x.level === 'error' && /기간 A/.test(x.area) && /관측 조위 자료가 없습니다/.test(x.text)));
});

test('같은 눈금 크기: 범위 크기는 같고 각자 가운데', () => {
  const s = (vals) => ({ points: vals.map((v, i) => ({ t: i, v })) });
  const [a, b] = yDomains([{ series: s([0, 100]), t0: 0, t1: 9 }, { series: s([500, 520]), t0: 0, t1: 9 }], 'same');
  assert.equal(Math.round(a[1] - a[0]), Math.round(b[1] - b[0]));
  assert.equal((b[0] + b[1]) / 2, 510);
  const [c, d] = yDomains([{ series: s([0, 100]), t0: 0, t1: 9 }, { series: s([500, 520]), t0: 0, t1: 9 }], 'own');
  assert.ok(d[1] - d[0] < c[1] - c[0]);
  assert.deepEqual(extremaIn(s([3, null, 9, 1]), 0, 3).range, 8);
});

test('저장 형식 3: 이전 형식 거부, 답 정리, 백업 왕복', async () => {
  assert.equal(SCHEMA_VERSION, 3);
  assert.throws(() => sanitizeState({ format: 'tide-lab-save', schemaVersion: 2, caseId: 'x' }), /이전 버전/);
  const st = emptyState('khoa-assess-2025-26', 'v');
  st.started = true;
  st.answers.q1 = { high: { t: 1, v: 100 }, low: { t: 'x' }, range: '80' };
  st.answers.q5 = ['DT_0001', '<script>', ''];
  st.answers.q6 = { DT_0005: { type: '혼합조', reason: '높이가 다름' }, DT_0006: { type: '아무거나' } };
  st.answers.q7 = { t0: 10, t1: 5, text: 'x' };
  const clean = sanitizeState(JSON.parse(JSON.stringify(st)));
  assert.deepEqual(clean.answers.q1.high, { t: 1, v: 100 });
  assert.equal(clean.answers.q1.low, null);
  assert.deepEqual(clean.answers.q5, ['DT_0001', '', '']);
  assert.equal(clean.answers.q6.DT_0006.type, '');
  assert.equal(clean.answers.q7.t0, null, '끝이 시작보다 앞서면 버림');
  const r = parseBackup(makeBackupText(clean), { knownCaseIds: ['khoa-assess-2025-26'], currentCaseId: 'khoa-assess-2025-26', currentDataVersion: 'v' });
  assert.equal(r.ok, true);
  assert.equal(r.state.answers.q6.DT_0005.reason, '높이가 다름');
});

test('보고서: 공개 전에는 기상·태풍·위상·⑪ 내용 없음, 공개 후 고정된 답 사용', async () => {
  const ad = applySetup(await load('khoa-assess-2025-26'), deployed());
  const st = emptyState(ad.id, ad.dataVersion);
  st.student = { grade: '2', klass: '3', number: '7', name: '홍길동' };
  st.answers.q3 = { spring: '2026-09-12', neap: '2026-09-20' };
  st.answers.q9 = '기간 A에 크게 솟음';
  st.answers.q10 = '바다에서 밀려옴';
  let m = buildReport(ad, st);
  const before = allText(m);
  for (const w of ['태풍', '힌남노', '기압', '풍속', '풍향', '기상', '안정적', '삭 ', '망 ']) assert.ok(!before.includes(w), `공개 전 보고서에 '${w}' 없음`);
  assert.ok(m.missing.some((x) => x.reveal));
  assert.ok(m.missing.some((x) => x.qid === 'q11'));
  // 공개(달의 위상·추가 자료): 공개 순간 답 보관 후 현재 답을 바꿔도 보고서는 보관본
  st.reveals.moon = { at: Date.now(), answers: { q3: { ...st.answers.q3 }, q4: { spring: null, neap: null } } };
  st.reveals.weather = { at: Date.now(), answers: { q9: st.answers.q9, q10: st.answers.q10 } };
  st.answers.q3.spring = '2026-09-01';
  st.answers.q10 = '바꾼 답';
  st.answers.q11 = '해면기압이 크게 낮았다.';
  m = buildReport(ad, st);
  const q3 = answerLines(ad, st, ALL_QUESTIONS.find((q) => q.id === 'q3'));
  assert.match(q3[0], /9월 12일/);
  const s4 = m.sections.find((s) => s.key === 'inq4');
  const side = s4.items.find((x) => x.type === 'side');
  assert.equal(side.left, '바다에서 밀려옴');
  assert.match(side.right, /해면기압/);
  assert.ok(s4.items.some((x) => x.type === 'figure' && /확인한 기압·바람이 상대적으로 안정적인 기간/.test(x.caption)));
  assert.ok(m.sections[0].items.some((x) => x.type === 'table' && /달의 위상/.test(x.title)));
  // 그림은 실제로 그릴 수 있음(그래프 공유: 탐구 1 문항 ①②는 그림 하나)
  const figs = m.sections[0].items.filter((x) => x.type === 'figure');
  assert.equal(figs.length, 2);
  for (const sec of m.sections) for (const f of sec.items.filter((x) => x.type === 'figure')) assert.ok(layoutFigure(f, { width: 480, measure }).length >= 1);
  assert.ok(!allText(m).includes('교사 메모'));
});

test('끈 문항은 보고서에서 빠지고 번호는 유지', async () => {
  const ad = applySetup(await load('khoa-assess-2025-26'), { ...deployed(), questions: { q2: false, q8: false } });
  const m = buildReport(ad, emptyState(ad.id, ad.dataVersion));
  const ids = m.sections.flatMap((s) => s.items.filter((x) => x.id && x.type !== 'figure').map((x) => x.id));
  assert.ok(!ids.includes('q2') && !ids.includes('q8'));
  assert.ok(m.sections[0].items.some((x) => x.label === '문항 ③'));
});

test('탐구 4 그래프: 공개 전 제목에 날짜만, 같은 눈금 크기', async () => {
  const ad = applySetup(await load('khoa-assess-2025-26'), deployed());
  assert.equal(periodTitle(ad, 'a', false), '기간 A: 2022년 9월 4일 ~ 9월 8일');
  assert.equal(periodTitle(ad, 'b', false), '기간 B: 2022년 9월 25일 ~ 9월 29일');
  const { periodTyphoon, periodCd } = await import('../../js/chart/assess.js');
  assert.equal(periodCd(ad, 'b'), ad.past, '기간 B도 부산 2022년 9월 자료');
  assert.match(periodTyphoon(ad, 'a').name, /힌남노/);
  assert.ok(periodTyphoon(ad, 'a').km < 30);
  assert.ok(periodTyphoon(ad, "b").km > 700, `기간 B 최근접 ${periodTyphoon(ad, 'b').km}`);
  assert.match(periodTitle(ad, 'b', true), /확인한 기압·바람이 상대적으로 안정적인 기간/);
  const [a, b] = inq4TideSpecs({ width: 600, height: 220, measure }, ad).map((s) => layoutChart(s).yDomain);
  assert.ok(Math.abs((a[1] - a[0]) - (b[1] - b[0])) < 1e-6);
  // 한 달 일별 변동 폭: 30일, 결측 없음
  const days = monthDays(ad.st.DT_0005, ad.win.month);
  assert.equal(days.length, 30);
  assert.ok(days.every((d) => d.complete));
});

test('예시·검증 사례: 예시 표시, 없는 자료는 미제공(만들지 않음), 시간대 미확인', async () => {
  const s = await load('sample-2099');
  assert.equal(s.isSample, true);
  const m = await load('test-minimal');
  assert.equal(m.past.weather, null);
  assert.equal(m.past.typhoon, null);
  assert.equal(m.moon, null);
  assert.equal(m.timeBasis.confirmed, false);
  assert.ok(m.st.SAMPLE_S.observed.points.some((p) => p.v == null), '결측은 null로 남김');
  const gap = m.st.SAMPLE_S.observed.points.filter((p) => p.t >= Date.parse('2099-09-13T15:00:00Z') && p.t < Date.parse('2099-09-13T21:00:00Z'));
  assert.equal(gap.length, 6);
  assert.ok(gap.every((p) => p.v === null), '결측 시각은 0이 아니라 null');
  assert.equal(INQUIRIES.length, 4);
});

test('10분 간격 예측(부산 2026-09): 정시 값은 1시간 예측과 같고 탐구 1에 쓰임', async () => {
  const { inq1Series } = await import('../../js/chart/assess.js');
  const ad = applySetup(await load('khoa-assess-2025-26'), deployed());
  const p10 = ad.st.DT_0005.predicted10;
  assert.deepEqual(p10.months, ['2026-09']);
  assert.equal(p10.intervalMs, 600000);
  assert.equal(p10.points.length, 30 * 144);
  const hourly = new Map(ad.st.DT_0005.predicted.points.map((p) => [p.t, p.v]));
  for (const p of p10.points.filter((x) => x.t % 3600e3 === 0)) assert.equal(p.v, hourly.get(p.t));
  assert.equal(inq1Series(ad), p10);
  const other = applySetup(await load('khoa-assess-2025-26'), { ...deployed(), month: '2026-08', inq1: { start: '2026-08-10 00:00', end: '2026-08-13 00:00', countStart: '2026-08-11 00:00' } });
  assert.equal(inq1Series(other), other.st.DT_0005.predicted, '10분 자료가 없는 달은 1시간 자료');
});

test('문항 ④ 배치판: 달 1·달 2의 위치각 저장, 옮기지 않은 판은 빈 답, 이유 저장, 이전 형식은 보관', () => {
  const st = emptyState('x', 'v');
  st.answers.q4 = { spring: { moons: [{ angle: 365, placed: true }, { angle: 180, placed: true }] }, neap: { moons: [{ angle: 35, placed: false }, { angle: 125, placed: false }] }, reason: '일직선' };
  let c = sanitizeState(JSON.parse(JSON.stringify(st)));
  assert.deepEqual(c.answers.q4.spring, { moons: [{ angle: 5, placed: true }, { angle: 180, placed: true }] });
  // 달 하나만 있던 이전 형식도 읽음(달 2는 옮기지 않은 상태)
  assert.deepEqual(sanitizeState({ ...JSON.parse(JSON.stringify(st)), answers: { q4: { spring: { moon: { angle: 90, placed: true } } } } }).answers.q4.spring, { moons: [{ angle: 90, placed: true }, { angle: 125, placed: false }] });
  assert.equal(c.answers.q4.neap, null);
  assert.equal(c.answers.q4.reason, '일직선');
  st.answers.q4 = {
    spring: { w: 640, h: 360, strokes: [{ c: '#1d2733', w: 3, p: [[1, 1], [50, 50]] }], texts: [] },
    neap: { sun: { x: 80, y: 120, placed: true }, earth: { x: 330, y: 120, placed: true }, moon: { x: 430, y: 120, placed: true } },
  };
  c = sanitizeState(JSON.parse(JSON.stringify(st)));
  assert.equal(c.answers.q4.spring, null);
  assert.equal(c.answers.q4.neap, null);
  assert.equal(c.answers.q4.oldDrawings.spring.strokes.length, 1, '이전 그림판 그림 보관');
  assert.equal(c.answers.q4.oldOrbits.neap.moon.x, 430, '이전 배치판 배치 보관');
});

test('탐구 2 같은 축: 지역마다 기간 평균을 0으로, 세 그래프 세로 범위·눈금 동일', async () => {
  const { inq2Specs, inq2Series } = await import('../../js/chart/assess.js');
  const ad = applySetup(await load('khoa-assess-2025-26'), deployed());
  const specs = inq2Specs({ width: 600, height: 190, measure }, ad, 'same');
  const L = specs.map((sp) => layoutChart(sp));
  assert.deepEqual(L[0].yDomain, L[1].yDomain);
  assert.deepEqual(L[1].yDomain, L[2].yDomain);
  assert.equal(L[0].yDomain[0], -L[0].yDomain[1]);
  const d = inq2Series(ad, 'same')[1];
  const raw = ad.st.DT_0005.predicted.points.find((p) => p.t === ad.win.inq2[0]).v;
  assert.equal(Math.round((d.series.points.find((p) => p.t === ad.win.inq2[0]).v + d.mean) * 100) / 100, raw, '원래 값 = 차이 + 평균');
});

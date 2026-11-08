// 여러 관측소 사례 — 로더·근거·그림·보고서 출처 검증(메모리 속 합성 자료, 파일 저장 없음)
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCaseData, stationCaseData } from '../../js/data/loader.js';
import { snapshotEvidence, evidenceTables } from '../../js/state/evidence.js';
import { figurePanels, sameSpanDomains } from '../../js/chart/specs.js';
import { layoutChart } from '../../js/chart/layout.js';
import { reportSources } from '../../js/report/model.js';

function csv(base, amp) {
  const rows = ['time,tide_cm,qc'];
  for (let d = 1; d <= 3; d++) for (let h = 0; h < 24; h++) {
    rows.push(`2022-09-0${d} ${String(h).padStart(2, '0')}:00,${Math.round(base + amp * Math.sin((h + d * 24) / 1.97))},1`);
  }
  return rows.join('\n');
}
const tide = (file, id) => ({
  file, adapter: 'csv-tide', kind: 'observed', label: '관측 조위', stationId: id, datum: 'UNCONFIRMED', datumLabel: '미확인', datumConfirmed: false,
  unit: 'cm', intervalMinutes: 60, time: { column: 'time', offset: '+09:00' }, value: { column: 'tide_cm' }, quality: { column: 'qc', ok: ['1'] }, missingValues: [''], meta: {},
});
const config = {
  formatVersion: 2, id: 'multi-test', dataVersion: 'v1', isSample: true,
  timezone: { label: 'KST', offsetMinutes: 540 }, station: { id: 'A1', name: '가' }, defaultStation: 'B2',
  stations: [
    { id: 'A1', name: '서쪽', sea: '서해', lat: 37, lon: 126.5, datasets: { observed: tide('a.csv', 'A1'), predicted: { provided: false }, weather: { provided: false } }, keyTimes: [{ time: '2022-09-02 06:00', label: '최근접 A' }] },
    { id: 'B2', name: '동쪽', sea: '동해', lat: 37.5, lon: 129.1, datasets: { observed: tide('b.csv', 'B2'), predicted: { provided: false }, weather: { provided: false } }, keyTimes: [{ time: '2022-09-02 09:00', label: '최근접 B' }] },
  ],
  datasets: { moonPhases: { provided: false }, typhoon: { provided: false } },
  inquiry1: { start: '2022-09-01 00:00', end: '2022-09-03 00:00' },
  inquiry2: { start: '2022-09-01 00:00', end: '2022-09-04 00:00' },
  inquiry3: { start: '2022-09-01 00:00', end: '2022-09-03 00:00', keyTimes: [{ time: '2022-09-02 04:50', label: '공통' }] },
};
const files = { 'a.csv': csv(450, 300), 'b.csv': csv(20, 15) };
const measure = (t, s) => String(t).length * s * 0.55;

test('여러 관측소: 기본 관측소, 관측소별 자료·주요 시각', async () => {
  const cd = await buildCaseData(config, async (f) => files[f]);
  assert.equal(cd.station.id, 'B2', 'defaultStation');
  assert.equal(cd.multi, true);
  assert.equal(cd.stations.length, 2);
  const a = stationCaseData(cd, 'A1');
  assert.equal(a.station.name, '서쪽');
  assert.notEqual(a.observed.points[0].v, cd.observed.points[0].v);
  assert.deepEqual(a.keyTimes.map((k) => k.label), ['공통', '최근접 A'], '공통 + 관측소별 주요 시각');
  assert.equal(stationCaseData(cd, 'NOPE'), null);
  assert.equal(a.availability.predicted, false, '예측이 없어도 관측 조위는 제공');
});

test('근거: 관측소 기록, 비교 그림 2개, 같은 눈금 크기는 범위 크기만 같음', async () => {
  const cd = await buildCaseData(config, async (f) => files[f]);
  const a = stationCaseData(cd, 'A1');
  const st = { view: null, points: [{ label: 'A', t: a.observed.points[5].t }], pair: null, compare: { stationId: 'B2', yMode: 'same' } };
  const ev = { id: 'e1', num: '1-1', ...snapshotEvidence(a, 1, st) };
  assert.equal(ev.stationId, 'A1');
  assert.equal(ev.stationSea, '서해');
  assert.ok(ev.datasets.some((d) => d.label.includes('비교') && d.label.includes('동쪽')));
  // 지금 화면이 다른 관측소(B2)여도 근거는 A1 자료로 그린다
  const panels = figurePanels(cd, ev, { width: 480, measure });
  assert.equal(panels.length, 2);
  assert.match(panels[0].spec.header.title, /서쪽/);
  assert.match(panels[1].spec.header.title, /동쪽/);
  const dom = sameSpanDomains(a, stationCaseData(cd, 'B2'), ev.state.view);
  assert.ok(Math.abs((dom.a[1] - dom.a[0]) - (dom.b[1] - dom.b[0])) < 1e-9, '두 축의 높이 범위 크기 같음');
  assert.ok(Math.abs(dom.a[0] - dom.b[0]) > 100, '절대값은 관측소별(같은 숫자로 맞추지 않음)');
  const L = layoutChart(panels[1].spec);
  assert.ok(L.yDomain[1] - L.yDomain[0] > 0);
  const tables = evidenceTables(cd, ev);
  assert.ok(tables.meta.some(([k, v]) => k === '관측소' && v.includes('A1')));
  assert.ok(tables.meta.some(([k, v]) => k === '비교 관측소' && v.includes('B2')));
});

test('찾을 수 없는 관측소의 근거는 다른 관측소 자료로 그리지 않음', async () => {
  const cd = await buildCaseData(config, async (f) => files[f]);
  const ev = { id: 'e2', num: '1-2', inquiry: 1, stationId: 'GONE', station: '없어진 곳', period: cd.ranges.inq1, state: { view: cd.ranges.inq1, points: [] }, values: { kind: 'inq1', points: [], diffs: [] }, datasets: [], dataVersion: 'v1' };
  const panels = figurePanels(cd, ev, { width: 480, measure });
  assert.equal(panels.length, 1);
  assert.match(panels[0].spec.message, /찾을 수 없어/);
});

test('보고서 출처: 근거·비교에 쓰인 관측소 모두와 기준면 주의', async () => {
  const cd = await buildCaseData(config, async (f) => files[f]);
  const state = { evidences: [{ inquiry: 1, stationId: 'A1', state: { compare: { stationId: 'B2', yMode: 'separate' } } }] };
  const rows = reportSources(cd, state);
  assert.ok(rows.some((r) => r.role.startsWith('서쪽(A1)')));
  assert.ok(rows.some((r) => r.role.startsWith('동쪽(B2)')));
  assert.ok(rows.some((r) => r.role === '관측소 비교 시 주의'));
});

// 데이터 처리 규칙 단위 검증: node --test tests/unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseCSV } from '../../js/data/csv.js';
import { normalizeTideSeries, normalizeWeather } from '../../js/data/normalize.js';
import { parseDateTime, fmtDateTime, fmtDuration, dayKey, HOUR } from '../../js/util/time.js';
import { fmtSigned, fmtNum, MINUS, compass16 } from '../../js/util/format.js';
import { segments, pairDiff, nearestValid, pointAt } from '../../js/analysis/series.js';
import { dailyRanges } from '../../js/analysis/daily.js';
import { computeResidual, checkComparable } from '../../js/analysis/residual.js';
import { loadRegistry, loadCase } from '../../js/data/loader.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readText = (p) => readFile(join(ROOT, p), 'utf8');
const KST = { offsetMinutes: 540, label: 'KST' };

const tideSpec = (over = {}) => ({
  file: 't.csv', kind: 'observed', label: '관측 조위', stationId: 'S', datum: 'D', unit: 'cm',
  intervalMinutes: 60, time: { column: 'time', offset: '+09:00' }, value: { column: 'v' },
  quality: { column: 'q', ok: ['1'], suspect: ['2'], bad: ['3'], missing: ['9'] },
  missingValues: ['', '-999'], ...over,
});

test('CSV: 따옴표·주석·BOM·CRLF', () => {
  const rows = parseCSV('﻿# 주석\r\na,b\r\n"x,1","He said ""hi"""\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['x,1', 'He said "hi"']]);
});

test('시각 파싱: 시간대 오프셋 적용과 날짜 경계', () => {
  const t = parseDateTime('2099-09-08 00:00', 540);
  assert.equal(new Date(t).toISOString(), '2099-09-07T15:00:00.000Z');
  assert.equal(parseDateTime('2099-09-07T15:00Z'), t);
  assert.equal(parseDateTime('2099-09-08T00:00+09:00'), t);
  assert.equal(dayKey(t, KST), '2099-09-08');
  assert.equal(dayKey(t - 1, KST), '2099-09-07');
  assert.ok(Number.isNaN(parseDateTime('2099-02-30 00:00', 540)), '존재하지 않는 날짜 거부');
  assert.ok(Number.isNaN(parseDateTime('2099-09-08 00:00')), '오프셋 없으면 거부');
});

test('조위 변환: 결측·오류값은 0이 아니라 null, 음수 유지, 품질 표시', () => {
  const csv = 'time,v,q\n2099-09-08 00:00,-12,1\n2099-09-08 01:00,,9\n2099-09-08 02:00,-999,1\n2099-09-08 03:00,15,3\n2099-09-08 04:00,abc,1\n2099-09-08 05:00,20,2\n';
  const s = normalizeTideSeries(csv, tideSpec());
  assert.deepEqual(s.points.map((p) => p.v), [-12, null, null, null, null, 20]);
  assert.deepEqual(s.points.map((p) => p.q), ['ok', 'missing', 'missing', 'bad', 'bad', 'suspect']);
  assert.ok(!s.points.some((p) => p.v === 0));
});

test('조위 변환: m → cm 명시적 변환과 UTC 원자료', () => {
  const csv = 'time,v\n2099-09-07 15:00,1.23\n2099-09-07 16:00,-0.05\n';
  const s = normalizeTideSeries(csv, tideSpec({ unit: 'm', time: { column: 'time', offset: '+00:00' }, quality: null }));
  assert.deepEqual(s.points.map((p) => p.v), [123, -5]);
  assert.deepEqual(s.conversions, ['m → cm (×100)']);
  assert.equal(fmtDateTime(s.points[0].t, KST), '2099-09-08 00:00');
});

test('조위 변환: 중복 시각은 첫 값만, 정렬', () => {
  const csv = 'time,v,q\n2099-09-08 02:00,3,1\n2099-09-08 00:00,1,1\n2099-09-08 00:00,9,1\n';
  const s = normalizeTideSeries(csv, tideSpec());
  assert.deepEqual(s.points.map((p) => p.v), [1, 3]);
  assert.ok(s.issues.some((i) => i.type === 'duplicate'));
});

test('그래프 구간: 결측·시간 공백에서 선을 끊음', () => {
  const t0 = parseDateTime('2099-09-08 00:00', 540);
  const pts = [0, 1, 2, 4, 5, 6].map((h, i) => ({ t: t0 + h * HOUR, v: i === 4 ? null : h }));
  const segs = segments(pts, HOUR);
  assert.deepEqual(segs.map((s) => s.map((p) => p.v)), [[0, 1, 2], [4], [6]]);
});

test('두 지점의 시간·높이 차이 (음수 포함)', () => {
  const t0 = parseDateTime('2099-09-08 05:00', 540);
  const a = { t: t0, v: 152 };
  const b = { t: t0 + 12 * HOUR + 0, v: -8 };
  const d = pairDiff(a, b);
  assert.equal(d.dtMs, 12 * HOUR);
  assert.equal(d.dv, -160);
  assert.equal(fmtSigned(d.dv), MINUS + '160');
  assert.equal(fmtSigned(15), '+15');
  assert.equal(fmtNum(-0.0001, 1), '0.0');
  assert.equal(fmtDuration(12 * HOUR + 25 * 60000), '12시간 25분');
  assert.equal(fmtDuration(25 * HOUR), '1일 1시간');
});

test('가장 가까운 실제 자료 선택: 결측은 건너뜀', () => {
  const t0 = 0;
  const pts = [{ t: 0, v: 1 }, { t: HOUR, v: null }, { t: 2 * HOUR, v: 3 }];
  assert.equal(nearestValid(pts, HOUR * 0.9).t, 0);
  assert.equal(nearestValid(pts, HOUR * 1.2).t, 2 * HOUR);
  assert.equal(pointAt(pts, 30 * 60000), null);
  void t0;
});

test('일별 변동 폭: 날짜 경계(KST), 불완전한 날 표시', () => {
  const day = parseDateTime('2099-09-08 00:00', 540);
  const pts = [];
  for (let h = -2; h < 48; h++) {
    if (h >= 30 && h <= 32) continue; // 9일 06~08시 결측
    pts.push({ t: day + h * HOUR, v: h === 5 ? -20 : h === 11 ? 150 : h === -1 ? 999 : 50, q: 'ok' });
  }
  const days = dailyRanges(pts, KST, HOUR, day, day + 48 * HOUR);
  assert.equal(days.length, 2);
  assert.equal(days[0].day, '2099-09-08');
  assert.equal(days[0].complete, true);
  assert.equal(days[0].range, 170, '전날 23시의 999는 포함되지 않아야 함');
  assert.equal(days[0].max.v, 150);
  assert.equal(days[0].min.v, -20);
  assert.equal(days[1].complete, false);
  assert.equal(days[1].valid, 21);
  assert.equal(days[1].missing, 3);
});

test('잔차: 같은 시각만 비교, 보간하지 않음', () => {
  const obs = { stationId: 'S', datum: 'D', datumLabel: 'D', unit: 'cm', points: [
    { t: 0, v: 100 }, { t: HOUR, v: 110 }, { t: 2 * HOUR, v: null }, { t: 3 * HOUR, v: 90 },
  ] };
  const pred = { stationId: 'S', datum: 'D', datumLabel: 'D', unit: 'cm', points: [
    { t: 0, v: 80 }, { t: HOUR + 30 * 60000, v: 100 }, { t: 2 * HOUR, v: 70 }, { t: 3 * HOUR, v: 95 },
  ] };
  const r = computeResidual(obs, pred);
  assert.equal(r.ok, true);
  assert.deepEqual(r.points.map((p) => p.v), [20, null, null, -5]);
  assert.equal(r.matched, 2);
  assert.equal(r.obsOnly, 1);
  assert.equal(r.predOnly, 1);
});

test('잔차: 기준면·관측소가 다르면 계산하지 않음', () => {
  const base = { stationId: 'S', datum: 'D', datumLabel: 'D', unit: 'cm', points: [{ t: 0, v: 1 }] };
  const r1 = computeResidual(base, { ...base, datum: 'X', datumLabel: 'X' });
  assert.equal(r1.ok, false);
  assert.equal(r1.points.length, 0);
  assert.match(r1.problems[0], /기준면/);
  assert.equal(checkComparable(base, { ...base, stationId: 'T' }).ok, false);
  assert.equal(computeResidual(base, null).ok, false);
});

test('기상 자료: 범위 밖 값 결측, 풍향 16방위', () => {
  const csv = 'time,p,w,d\n2099-09-08 00:00,1005.2,12.5,45\n2099-09-08 01:00,-999,,400\n';
  const w = normalizeWeather(csv, {
    intervalMinutes: 60, time: { column: 'time', offset: '+09:00' }, station: {},
    missingValues: ['', '-999'],
    fields: { pressure: { column: 'p', unit: 'hPa', range: [850, 1100] }, windSpeed: { column: 'w', unit: 'm/s' }, windDir: { column: 'd', unit: 'deg', range: [0, 360] } },
  });
  assert.deepEqual(w.points[0], { t: w.points[0].t, pressure: 1005.2, windSpeed: 12.5, windDir: 45 });
  assert.equal(w.points[1].pressure, null);
  assert.equal(w.points[1].windSpeed, null);
  assert.equal(w.points[1].windDir, null);
  assert.equal(compass16(45), '북동');
  assert.equal(compass16(359), '북');
});

test('예시 사례 불러오기: 자료 연결과 예시 표시', async () => {
  const reg = await loadRegistry(readText);
  const cd = await loadCase(reg.cases.find((c) => c.id === 'sample-2099'), readText);
  assert.equal(cd.isSample, true);
  assert.equal(cd.availability.residual, true);
  assert.equal(cd.predicted.conversions[0], 'm → cm (×100)');
  assert.ok(cd.observed.points.some((p) => p.v != null && p.v < 0), '음수 조위 포함');
  assert.ok(cd.observed.points.some((p) => p.v == null), '결측 포함');
  assert.ok(cd.weatherDistanceKm > 1, '기상 관측 지점 거리 계산');
});

test('검증용 사례: 기준면 불일치 → 잔차 없음, 기상·달 자료 미제공', async () => {
  const reg = await loadRegistry(readText);
  const cd = await loadCase(reg.cases.find((c) => c.id === 'test-minimal'), readText);
  assert.equal(cd.availability.predicted, true);
  assert.equal(cd.availability.residual, false);
  assert.equal(cd.residual.points.length, 0);
  assert.equal(cd.availability.weather, false);
  assert.equal(cd.availability.moonPhases, false);
  // UTC·m 원자료가 KST·cm로 변환되었는지
  const first = cd.observed.points[0];
  assert.equal(fmtDateTime(first.t, cd.tz), '2099-09-18 00:00');
  assert.ok(Number.isInteger(Math.round(first.v)));
});

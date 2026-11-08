// 기상 자료 수집·변환 검증 — 로컬 가짜 서버(합성값, 임시 폴더만 사용)
// 국립해양조사원 기압·바람 API가 2022년 자료를 주지 않는 경우 → 기상청 ASOS로 대체되는지,
// 해면기압·현지기압이 섞이지 않는지, 품질 플래그(1·9)가 결측으로 처리되는지 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEY = 'TESTKEY';

function asosItems(ymd) {
  const d = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6)}`;
  const out = [];
  for (let h = 0; h < 24; h++) {
    if (ymd === '20220905' && h === 7) continue; // 1시간 행 없음
    const it = { tm: `${d} ${String(h).padStart(2, '0')}:00`, stnId: '159', stnNm: '부산', pa: String(1000 - h * 0.2), ps: String(1008 - h * 0.2), ws: String(3 + h * 0.1), wd: '200', paQcflg: '', psQcflg: '', wsQcflg: '', wdQcflg: '' };
    if (ymd === '20220905' && h === 3) { it.ps = '1004.0'; it.psQcflg = '1'; } // 오류 플래그
    if (ymd === '20220906' && h === 1) { it.ws = ''; it.wsQcflg = '9'; } // 결측 플래그
    out.push(it);
  }
  return out;
}

test('KHOA 기상 자료 없음 → ASOS 대체, 기압 종류 분리, QC 결측 처리', async () => {
  const srv = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.pathname.includes('AsosHourlyInfoService')) {
      assert.equal(u.searchParams.get('stnIds'), '159');
      assert.equal(u.searchParams.get('dataType'), 'JSON');
      assert.equal(u.searchParams.get('startDt'), u.searchParams.get('endDt'));
      const items = asosItems(u.searchParams.get('startDt'));
      return send({ response: { header: { resultCode: '00', resultMsg: 'NORMAL_SERVICE' }, body: { dataType: 'JSON', items: { item: items }, pageNo: 1, numOfRows: 300, totalCount: items.length } } });
    }
    // 국립해양조사원 기압·바람: 2022년 자료 없음
    send({ response: { header: { resultCode: '03', resultMsg: 'NODATA_ERROR' }, body: { items: '', totalCount: 0 } } });
  });
  await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;
  const tmp = mkdtempSync(join(tmpdir(), 'wx-test-'));
  const raw = join(tmp, 'raw');
  const env = { ...process.env, DATA_GO_KR_SERVICE_KEY: KEY, HTTPS_PROXY: '', https_proxy: '', NODE_USE_ENV_PROXY: '' };
  const r = await new Promise((resolve) => {
    const p = spawn(process.execPath, [join(ROOT, 'tools/khoa/collect.mjs'), '--start', '2022-09-05', '--end', '2022-09-06', '--datasets', 'airpress,wind,asos', '--out', raw, '--base-url', `http://localhost:${port}`, '--delay-ms', '0'], { env });
    let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ code, out }));
  });
  srv.close();
  assert.equal(r.code, 0, r.out);
  const m = JSON.parse(readFileSync(join(raw, 'manifest.json'), 'utf8'));
  assert.equal(m.requests['airpress|DT_0005|2022-09-05'].status, 'nodata');
  assert.equal(m.requests['asos|159|2022-09-05'].status, 'ok', 'ASOS는 지점번호 159로 기록');

  // 조위 원본이 없으면 사례를 만들지 않으므로, 검증용 조위 원본(합성)을 함께 넣는다
  const hourlyDir = join(raw, 'hourly', 'DT_0005');
  for (const ymd of ['20220905', '20220906']) {
    mkdirSync(join(hourlyDir, ymd), { recursive: true });
    const d = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6)}`;
    const items = Array.from({ length: 24 }, (_, h) => ({ obsvtrNm: '부산', lat: 35.09638, lot: 129.03527, obsrvnDt: `${d} ${String(h).padStart(2, '0')}:00`, tdlvVl: 100 + h }));
    writeFileSync(join(hourlyDir, ymd, 'page-1.json'), JSON.stringify({ rawText: JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'NORMAL_SERVICE' }, body: { items: { item: items }, totalCount: 24 } } }) }));
    m.requests[`hourly|DT_0005|${d}`] = { dataset: 'hourly', station: 'DT_0005', date: d, status: 'ok', files: [`hourly/DT_0005/${ymd}/page-1.json`] };
  }
  writeFileSync(join(raw, 'manifest.json'), JSON.stringify(m));
  const cases = join(tmp, 'cases');
  const b = spawnSync(process.execPath, [join(ROOT, 'tools/khoa/build-case.mjs'), '--raw', raw, '--cases-dir', cases, '--start', '2022-09-05', '--end', '2022-09-06', '--case-id', 'wx-case'], { encoding: 'utf8' });
  assert.equal(b.status, 0, b.stderr + b.stdout);
  const dir = join(cases, 'wx-case');
  assert.ok(existsSync(join(dir, 'weather.csv')));
  const cj = JSON.parse(readFileSync(join(dir, 'case.json'), 'utf8'));
  const f = cj.datasets.weather.fields;
  assert.deepEqual(Object.keys(f).sort(), ['pressureSea', 'pressureStation', 'windDir', 'windSpeed']);
  assert.notEqual(f.pressureSea.column, f.pressureStation.column, '해면기압·현지기압은 다른 열');
  assert.match(cj.datasets.weather.station.name, /ASOS\(159\)/);
  assert.equal(cj.datasets.weather.station.elevation_m, 69.56, '지점정보의 해발고도');
  const q = JSON.parse(readFileSync(join(dir, 'quality-report.json'), 'utf8'));
  assert.equal(q.weather.source, 'asos');
  assert.equal(q.weather.completeness.pressureSea.valid, 48 - 2, '행 없음 1 + 오류 플래그 1');
  assert.equal(q.weather.completeness.windSpeed.valid, 48 - 2, '행 없음 1 + 결측 플래그 1');
  assert.equal(q.weather.completeness.pressureStation.valid, 47);

  // 앱 로더: 플래그 값은 null, 기압 종류 분리
  const { buildCaseData } = await import(join(ROOT, 'js/data/loader.js'));
  const cd = await buildCaseData(cj, async (fn) => readFileSync(join(dir, fn), 'utf8'));
  const at = (t) => cd.weather.points.find((p) => p.t === Date.parse(t));
  assert.equal(at('2022-09-04T18:00:00Z').pressureSea, null, '09-05 03:00 KST 오류 플래그 → 결측');
  assert.equal(at('2022-09-04T18:00:00Z').pressureStation, 999.4, '현지기압은 그대로');
  assert.equal(at('2022-09-05T16:00:00Z').windSpeed, null, '09-06 01:00 KST 결측 플래그');
  assert.equal(cd.weather.points.some((p) => p.pressureSea === 0 || p.windSpeed === 0 && p.t === Date.parse('2022-09-05T16:00:00Z')), false, '0으로 채우지 않음');
  assert.ok(!cd.weather.points.some((p) => p.t === Date.parse('2022-09-04T22:00:00Z')), '없는 시각(07시)은 만들지 않음');
  // 태풍: 실황 분석 경로(실제 수집 파일)와 주요 시각
  assert.ok(cd.typhoon.track.length > 10);
  assert.ok(cd.keyTimes.length >= 2);
});

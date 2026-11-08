// 수집기·변환기 검증 — 로컬 가짜 서버 사용
// 가짜 서버의 값은 검증용 합성값이며 data/ 폴더에 저장하지 않는다(임시 폴더만 사용).
// 응답 구조는 공공데이터포털 '오픈API 활용가이드'의 응답 예시 구조를 따른다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEY = 'TEST+KEY/abc==';

function rows(kind, date) {
  const out = [];
  for (let h = 0; h < 24; h++) {
    const t = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)} ${String(h).padStart(2, '0')}:00`;
    const base = Math.round(100 + 80 * Math.sin(h / 2));
    if (kind === 'hourly') out.push({ obsvtrNm: '부산', lat: 35.0, lot: 129.0, obsrvnDt: t, tdlvVl: base + 3 });
    else out.push({ obsvtrNm: '부산', lat: 35.0, lot: 129.0, predcDt: t, tdlvHgt: base });
  }
  return out;
}

function startMock() {
  const hits = { count: 0, failedOnce: false, keys: new Set() };
  const srv = createServer((req, res) => {
    hits.count++;
    const u = new URL(req.url, 'http://x');
    hits.keys.add(u.searchParams.get('serviceKey'));
    const date = u.searchParams.get('reqDate');
    const kind = u.pathname.includes('hourlyTide') ? 'hourly' : 'forecast';
    const send = (obj, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (u.searchParams.get('serviceKey') !== KEY) return send({ OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR', returnAuthMsg: '등록되지 않은 서비스키', returnReasonCode: '30' } } }, 403);
    // 9월 2일 관측: 첫 시도는 서버 오류 → 재시도로 성공해야 함
    if (kind === 'hourly' && date === '20220902' && !hits.failedOnce) { hits.failedOnce = true; res.writeHead(503); res.end('Service Unavailable'); return; }
    // 9월 3일 예측: 자료 없음
    if (kind === 'forecast' && date === '20220903') return send({ response: { header: { resultCode: '03', resultMsg: 'NODATA_ERROR' }, body: { items: '', totalCount: 0 } } });
    let items = rows(kind, date);
    if (kind === 'hourly' && date === '20220901') {
      items = items.filter((it) => !it.obsrvnDt.endsWith('05:00')); // 1시간 누락
      items.push({ ...items[0] }); // 같은 값 중복
      items.push({ ...items[1], tdlvVl: 999 }); // 다른 값 중복(충돌)
      items[2] = { ...items[2], tdlvVl: '' }; // 빈 값
    }
    // 페이지 나눔: 서버가 한 번에 10행씩만 준다고 가정
    const pageNo = Number(u.searchParams.get('pageNo') || 1);
    const per = 10;
    send({ response: { header: { resultCode: '00', resultMsg: 'NORMAL_SERVICE' }, body: { items: { item: items.slice((pageNo - 1) * per, pageNo * per) }, pageNo, numOfRows: per, totalCount: items.length, type: 'json' } } });
  });
  return new Promise((r) => srv.listen(0, () => r({ srv, hits, port: srv.address().port })));
}

test('수집 → 원본 보관 → 사례 파일·품질 보고서', async () => {
  const { srv, hits, port } = await startMock();
  const tmp = mkdtempSync(join(tmpdir(), 'khoa-test-'));
  const raw = join(tmp, 'raw');
  const cases = join(tmp, 'cases');
  const env = { ...process.env, DATA_GO_KR_SERVICE_KEY: encodeURIComponent(KEY), HTTPS_PROXY: '', https_proxy: '', NODE_USE_ENV_PROXY: '' };
  const run = (args) => new Promise((resolve) => {
    import('node:child_process').then(({ spawn }) => {
      const p = spawn(process.execPath, [join(ROOT, 'tools/khoa/collect.mjs'), ...args], { env });
      let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
      p.on('close', (code) => resolve({ code, out }));
    });
  });
  const r1 = await run(['--start', '2022-09-01', '--end', '2022-09-03', '--datasets', 'hourly,forecast', '--out', raw, '--base-url', `http://localhost:${port}`, '--delay-ms', '0', '--backoff-ms', '10']);
  assert.equal(r1.code, 0, r1.out);
  assert.ok(hits.keys.has(KEY), 'Encoding 키를 넣어도 원래 키로 보냄');
  const m = JSON.parse(readFileSync(join(raw, 'manifest.json'), 'utf8'));
  assert.equal(m.requests['hourly|DT_0005|2022-09-01'].status, 'ok');
  assert.equal(m.requests['hourly|DT_0005|2022-09-01'].pages, 3, '25행 → 10행씩 3페이지');
  assert.equal(m.requests['hourly|DT_0005|2022-09-02'].status, 'ok', '일시적 503 후 재시도 성공');
  assert.equal(m.requests['forecast|DT_0005|2022-09-03'].status, 'nodata');
  const failures = readFileSync(join(raw, 'failures.jsonl'), 'utf8').trim().split('\n');
  assert.equal(failures.length, 1);
  assert.ok(!readFileSync(join(raw, 'failures.jsonl'), 'utf8').includes('TEST'), '실패 기록에 인증키 없음');
  const page = JSON.parse(readFileSync(join(raw, 'hourly/DT_0005/20220901/page-1.json'), 'utf8'));
  assert.ok(page.rawText.includes('NORMAL_SERVICE'), '원본 응답 보관');
  assert.ok(!JSON.stringify(page).includes('TEST'), '원본 파일에 인증키 없음');

  // 다시 실행하면 성공한 날은 건너뜀
  const before = hits.count;
  const r2 = await run(['--start', '2022-09-01', '--end', '2022-09-03', '--datasets', 'hourly,forecast', '--out', raw, '--base-url', `http://localhost:${port}`, '--delay-ms', '0']);
  assert.equal(r2.code, 0);
  assert.equal(hits.count, before, '이미 받은 자료는 다시 요청하지 않음');
  srv.close();

  // 변환
  const b = spawnSync(process.execPath, [join(ROOT, 'tools/khoa/build-case.mjs'), '--raw', raw, '--cases-dir', cases, '--start', '2022-09-01', '--end', '2022-09-03', '--case-id', 'test-case'], { encoding: 'utf8' });
  assert.equal(b.status, 0, b.stderr + b.stdout);
  const dir = join(cases, 'test-case');
  assert.deepEqual(readdirSync(dir).sort(), ['case.json', 'moon.csv', 'observed.csv', 'predicted.csv', 'quality-report.json', 'quality-report.md', 'typhoon_forecast.csv', 'typhoon_track.csv']);
  const q = JSON.parse(readFileSync(join(dir, 'quality-report.json'), 'utf8'));
  assert.equal(q.observed.expected, 72);
  assert.equal(q.observed.valid, 72 - 3, '누락 1 + 빈 값 1 + 충돌 1');
  assert.ok(q.observed.ranges.some((r) => r.from === '2022-09-01 05:00' && r.reason === '응답에 없음'));
  assert.ok(q.observed.issues.some((i) => i.type.startsWith('중복(같은 값')));
  assert.ok(q.observed.issues.some((i) => i.type.startsWith('중복(값 충돌')));
  assert.equal(q.predicted.valid, 48, '9/3 예측은 자료 없음');
  assert.ok(q.predicted.ranges.some((r) => r.from === '2022-09-03 00:00' && r.hours === 24 && r.reason === '수집 상태: nodata'));
  assert.equal(q.station.nameMatches, true);
  assert.match(q.metadata.datum, /미확인/);
  const obsCsv = readFileSync(join(dir, 'observed.csv'), 'utf8');
  assert.ok(!/2022-09-01 05:00/.test(obsCsv), '없는 시각은 행을 만들지 않음');
  assert.match(obsCsv, /2022-09-01 02:00,,9/, '빈 값은 0이 아니라 빈 칸');
  const cj = JSON.parse(readFileSync(join(dir, 'case.json'), 'utf8'));
  assert.equal(cj.isSample, false);
  assert.equal(cj.datasets.observed.datumConfirmed, false);
  assert.equal(cj.datasets.predicted.datumConfirmed, false);
  // 앱 로더로 읽었을 때 잔차가 계산되지 않아야 함
  const { buildCaseData } = await import(join(ROOT, 'js/data/loader.js'));
  const cd = await buildCaseData(cj, async (f) => readFileSync(join(dir, f), 'utf8'));
  assert.equal(cd.residual.ok, false);
  assert.match(cd.residual.problems[0], /기준면이 확인되지/);
  assert.equal(cd.observed.points.filter((p) => p.v === 0).length, 0);
  assert.ok(existsSync(join(cases, 'index.json')));
});

test('원본 자료가 없으면 사례 파일을 만들지 않음', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'khoa-empty-'));
  const b = spawnSync(process.execPath, [join(ROOT, 'tools/khoa/build-case.mjs'), '--raw', join(tmp, 'none'), '--cases-dir', join(tmp, 'cases'), '--start', '2022-09-01', '--end', '2022-09-30'], { encoding: 'utf8' });
  assert.equal(b.status, 2);
  assert.ok(!existsSync(join(tmp, 'cases')));
});

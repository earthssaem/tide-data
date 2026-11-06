// 전체 흐름 검증 (Playwright): node tests/e2e/run-e2e.mjs [결과폴더]
// 학생 정보 → 탐구 1~3 분석·근거 → 결론 → 새로고침 복구 → 백업/삭제/불러오기 → PDF 다운로드·내용 확인
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = process.argv[2] || join(ROOT, 'tests', 'e2e', 'out');
mkdirSync(OUT, { recursive: true });
const PORT = 8199;
const BASE = `http://localhost:${PORT}/`;

// ── 원자료에서 직접 기대값 계산(앱 코드와 독립) ──
function readCsv(file) {
  return readFileSync(join(ROOT, 'data/cases/sample-2099', file), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).slice(1).map((l) => l.split(','));
}
const obsRows = readCsv('observed.csv').map(([t, v, q]) => ({ t, v: v === '' || q === '3' || q === '9' ? null : Number(v) }));
const predRows = new Map(readCsv('predicted.csv').map(([t, v]) => [t, Math.round(Number(v) * 100)]));
const wxRows = new Map(readCsv('weather.csv').map(([t, p, w, d]) => [t, { p: p === '' ? null : Number(p), w: w === '' ? null : Number(w), d: d === '' ? null : Number(d) }]));
const obsMap = new Map(obsRows.map((r) => [r.t, r.v]));

const results = [];
const check = (name, fn) => { try { fn(); results.push(['✓', name]); } catch (e) { results.push(['✗', name, e.message]); } };

const server = spawn(process.execPath, [join(ROOT, 'tools/serve.mjs'), String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));

// 리눅스 컨테이너에서 한글 파일 이름 다운로드를 위해 UTF-8 로캘 지정(학교 PC에서는 불필요)
const browser = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  const okDialog = async () => { await page.click('dialog button[value=ok]'); await page.waitForTimeout(150); };

  await page.goto(BASE);
  await page.waitForSelector('.student-form');

  // 1. 학생 정보 검증
  await page.click('button[type=submit]');
  check('학생 정보 미입력 시 안내', async () => {});
  assert.ok(await page.isVisible('.form-error'), '오류 안내가 보여야 함');
  await page.selectOption('select[name=grade]', '3');
  await page.fill('input[name=klass]', '2');
  await page.fill('input[name=number]', '15');
  await page.fill('input[name=name]', '김학생');
  await page.click('button[type=submit]');
  await page.waitForSelector('.screen-inq1 .chart-view svg');

  // 2. 탐구 1: 마우스 클릭으로 첫 자료점 선택
  const firstDot = page.locator('.screen-inq1 .chart-svg circle').first();
  await firstDot.click({ force: true });
  await page.waitForTimeout(150);
  let rows = await page.$$eval('#inq1-points tbody tr', (trs) => trs.map((tr) => tr.innerText));
  check('마우스 클릭으로 실제 자료점 선택(A = 9/15 00:00)', () => assert.match(rows[0], /2099-09-15 00:00/));
  await page.click('text=선택 모두 해제');

  // 키보드로 만조 세 지점 선택: 원자료에서 구간 내 국소 최대 3개
  const inq1 = obsRows.filter((r) => r.t >= '2099-09-15 00:00' && r.t < '2099-09-18 00:00');
  const highs = [];
  for (let i = 1; i < inq1.length - 1; i++) {
    if (inq1[i].v != null && inq1[i].v > inq1[i - 1].v && inq1[i].v >= inq1[i + 1].v && inq1[i].v > 120) highs.push(i);
  }
  const pick3 = highs.slice(0, 3);
  await page.focus('.screen-inq1 .chart-view');
  let pos = 0; // 마우스로 눌렀던 첫 자료점(index 0)에서 이동 시작
  for (const idx of pick3) {
    for (; pos < idx; pos++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(200);
  rows = await page.$$eval('#inq1-points tbody tr', (trs) => trs.map((tr) => tr.innerText.replace(/\s+/g, ' ')));
  const diffs = await page.$$eval('#inq1-diffs tbody tr', (trs) => trs.map((tr) => tr.innerText.replace(/\s+/g, ' ')));
  const H = pick3.map((i) => inq1[i]);
  const hours = (a, b) => (Date.parse(b.t.replace(' ', 'T') + 'Z') - Date.parse(a.t.replace(' ', 'T') + 'Z')) / 3600e3;
  const sgn = (v) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0');
  check('선택 지점 시각·조위가 원자료와 일치', () => {
    H.forEach((h, k) => { assert.ok(rows[k].includes(h.t), `${rows[k]} ⊃ ${h.t}`); assert.ok(rows[k].includes(`${String(h.v).replace('-', '−')} cm`)); });
  });
  check('시간 차이·높이 차이 계산(뒤 − 앞)', () => {
    for (let k = 0; k < 2; k++) {
      const dt = hours(H[k], H[k + 1]);
      assert.ok(diffs[k].includes(`(${dt.toFixed(2)}시간)`), `${diffs[k]} vs ${dt}`);
      assert.ok(diffs[k].includes(`${sgn(H[k + 1].v - H[k].v)} cm`), `${diffs[k]} vs ${H[k + 1].v - H[k].v}`);
    }
    // 처음과 마지막 비교(A → C)
    assert.ok(diffs[2] && diffs[2].includes(`(${hours(H[0], H[2]).toFixed(2)}시간)`));
  });

  // 근거 추가 후 그래프를 움직여도 근거 불변
  await page.click('.screen-inq1 .add-ev-bar button');
  await page.waitForSelector('.screen-inq1 .ev-card');
  const evThumbBefore = await page.$eval('.screen-inq1 .ev-card .ev-thumb', (e) => e.innerHTML);
  const evValBefore = await page.evaluate(() => JSON.stringify(window.__tideApp.store.state.evidences[0]));
  await page.click('.screen-inq1 .tool[data-act=zoomin]');
  await page.click('.screen-inq1 .tool[data-act=right]');
  await page.click('#inq1-points tbody tr:nth-child(2) button:has-text("해제")');
  await page.waitForTimeout(200);
  const evThumbAfter = await page.$eval('.screen-inq1 .ev-card .ev-thumb', (e) => e.innerHTML);
  const evValAfter = await page.evaluate(() => JSON.stringify(window.__tideApp.store.state.evidences[0]));
  check('그래프 변경 후에도 저장한 근거(그림·값) 유지', () => { assert.equal(evThumbAfter, evThumbBefore); assert.equal(evValAfter, evValBefore); });
  await page.fill('.screen-inq1 .ev-card textarea.memo', 'A·B·C는 연속한 만조로 판단');
  await page.click('#q-i1q1 .chip');
  const longAns = '첫째 줄: 만조 A와 B의 간격은 약 12시간이다.\n둘째 줄: B와 C도 비슷하다.\n\n' + Array.from({ length: 70 }, (_, i) => `${i + 1}번째 문장으로 매우 긴 답변이 다음 페이지로 잘리지 않고 이어지는지 확인합니다.`).join(' ') + '\n마지막줄확인용문장';
  await page.fill('#ans-i1q1', longAns);
  await page.fill('#ans-i1q2', '높이 차이는 −14 cm처럼 음수가 될 수 있다.\n다른 구간에서도 비슷했다.');
  // i1q3은 일부러 비워 둠
  await page.screenshot({ path: join(OUT, 'e2e-inq1.png'), fullPage: false });

  // 3. 탐구 2
  await page.click('.nav-next');
  await page.waitForSelector('.screen-inq2 .chart-view svg');
  check('달의 위상은 처음에 숨김', async () => {});
  assert.equal(await page.isChecked('#moon-toggle'), false);
  const dailyView = page.locator('.screen-inq2 .chart-view').nth(1);
  await dailyView.focus();
  // 9/2, 9/9, 9/17, 9/24 선택
  const targets = [2, 9, 17, 24];
  let cur = 0;
  for (const d of targets) { for (; cur < d; cur++) await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); await page.waitForTimeout(120); await dailyView.focus(); }
  const selDays = await page.$$eval('#inq2-days tbody tr', (trs) => trs.map((tr) => tr.innerText.replace(/\s+/g, ' ')));
  const dayRange = (day) => { const v = obsRows.filter((r) => r.t.startsWith(day) && r.v != null).map((r) => r.v); return Math.max(...v) - Math.min(...v); };
  check('일별 변동 폭 = 그날 관측 최고값 − 최저값', () => {
    ['2099-09-02', '2099-09-09', '2099-09-17', '2099-09-24'].forEach((d, k) => assert.ok(selDays[k].includes(`${dayRange(d)} cm`), `${selDays[k]} vs ${dayRange(d)}`));
  });
  const ints = await page.$$eval('#inq2-intervals tbody tr', (trs) => trs.map((tr) => tr.innerText.replace(/\s+/g, ' ')));
  check('선택 날짜 간격 계산', () => { assert.match(ints[0], /7일/); assert.match(ints[1], /8일/); assert.match(ints[2], /7일/); });
  const incomplete = await page.evaluate(() => {
    const cd = window.__tideApp.cd;
    return cd.observed.points.filter((p) => p.v == null).length;
  });
  check('결측 자료는 0이 아닌 빈 값', () => assert.ok(incomplete >= 3));
  await page.click('label[for=moon-toggle]');
  await page.waitForTimeout(200);
  check('달의 위상 켜기 후 목록 표시', async () => {});
  assert.ok((await page.textContent('.moon-info')).includes('삭'));
  await page.click('.screen-inq2 .add-ev-bar button');
  await page.fill('#ans-i2q1', '변동 폭이 큰 날: A(9/2), C(9/17)\n작은 날: B(9/9), D(9/24)');
  await page.click('#q-i2q1 .chip');
  await page.screenshot({ path: join(OUT, 'e2e-inq2.png'), fullPage: false });

  // 4. 탐구 3: 관측 최고 시각, 잔차 최대 시각, 결측 시각
  await page.click('.nav-next');
  await page.waitForSelector('.screen-inq3 .chart-view svg');
  const r3 = obsRows.filter((r) => r.t >= '2099-09-18 00:00' && r.t <= '2099-09-23 00:00');
  const maxObs = r3.filter((r) => r.v != null).reduce((a, b) => (b.v > a.v ? b : a));
  const maxRes = r3.filter((r) => r.v != null).reduce((a, b) => (b.v - predRows.get(b.t) > a.v - predRows.get(a.t) ? b : a));
  const missingT = '2099-09-21 02:00';
  const idxOf = (t) => r3.findIndex((r) => r.t === t);
  const order = [idxOf(maxObs.t), idxOf(maxRes.t), idxOf(missingT)].sort((a, b) => a - b);
  await page.locator('.screen-inq3 .chart-view').first().focus();
  pos = -1;
  for (const idx of order) { for (; pos < idx; pos++) await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); await page.waitForTimeout(100); await page.locator('.screen-inq3 .chart-view').first().focus(); }
  const r3rows = await page.$$eval('.screen-inq3 .table-host.wide tbody tr', (trs) => trs.map((tr) => [...tr.children].map((c) => c.innerText.trim())));
  const rowFor = (t) => r3rows.find((r) => r[1] === t);
  check('잔차 = 같은 시각 관측 − 예측 (최대 잔차 시각)', () => {
    const r = rowFor(maxRes.t);
    assert.ok(r, `행 없음 ${maxRes.t}`);
    const pv = predRows.get(maxRes.t);
    assert.equal(r[2], `${maxObs.t === maxRes.t ? maxObs.v : maxRes.v} cm`.replace('-', '−'));
    assert.equal(r[3], `${pv} cm`.replace('-', '−'));
    assert.equal(r[4], `${sgn(maxRes.v - pv)} cm`);
  });
  check('관측 최고 시각과 잔차 최대 시각이 각각 표시됨', () => { assert.ok(rowFor(maxObs.t)); assert.notEqual(maxObs.t, maxRes.t); });
  check('결측 시각은 "자료 없음"(보간 없음)', () => { const r = rowFor(missingT); assert.equal(r[2], '자료 없음'); assert.equal(r[4], '자료 없음'); });
  check('기상 값이 원자료와 일치', () => {
    const r = rowFor(maxRes.t); const w = wxRows.get(maxRes.t);
    assert.equal(r[5], w ? `${w.p.toFixed(1)} hPa` : '자료 없음');
  });
  await page.click('label[for=bottom-windDir]');
  await page.click('.screen-inq3 .add-ev-bar button');
  await page.fill('#ans-i3q1', `관측 조위 최고: ${maxObs.t}, ${maxObs.v} cm`);
  await page.click('#q-i3q1 .chip');
  await page.screenshot({ path: join(OUT, 'e2e-inq3.png'), fullPage: false });

  // 5. 종합 결론
  await page.click('.nav-next');
  await page.waitForSelector('#ans-c1');
  await page.fill('#ans-c1', '하루에 만조가 두 번 정도 나타났다.\n한 달에 변동 폭이 두 번 커졌다.');
  await page.click('#q-c1 .chip:nth-child(1)');
  await page.click('#q-c1 .chip:nth-child(2)');
  await page.waitForTimeout(800);

  // 6. 새로고침 복구
  const before = await page.evaluate(() => JSON.stringify({ a: window.__tideApp.store.state.answers, e: window.__tideApp.store.state.evidences, l: window.__tideApp.store.state.links }));
  await page.reload();
  await page.waitForSelector('#ans-c1');
  const after = await page.evaluate(() => JSON.stringify({ a: window.__tideApp.store.state.answers, e: window.__tideApp.store.state.evidences, l: window.__tideApp.store.state.links }));
  check('새로고침 후 답안·근거·연결 복구', () => assert.deepEqual(JSON.parse(after), JSON.parse(before)));
  check('저장 상태 "저장됨" 표시', async () => {});
  assert.match(await page.textContent('#save-status'), /저장됨/);
  await page.goto(BASE + '#/inq1');
  await page.waitForSelector('#ans-i1q1');
  check('줄바꿈 포함 답안이 입력란에 복구', async () => {});
  assert.equal(await page.inputValue('#ans-i1q1'), longAns);

  // 7. 백업 → 삭제 → 잘못된 파일 → 백업 불러오기
  await page.click('#tools-menu summary');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action=backup]')]);
  const backupPath = join(OUT, dl.suggestedFilename());
  await dl.saveAs(backupPath);
    check('백업 파일 이름', () => assert.match(dl.suggestedFilename(), /^조석탐구_백업_3학년2반15번_김학생_\d{8}-\d{4}\.json$/));
  await page.click('#tools-menu summary');
  await page.click('[data-action=clear]');
  await okDialog();
  await page.waitForSelector('.student-form');
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('tideLab.')));
  check('삭제 후 이 앱 저장 키 없음', () => assert.equal(keys.length, 0));
  // 잘못된 파일
  const badPath = join(OUT, 'bad.json');
  writeFileSync(badPath, JSON.stringify({ format: 'other' }));
  let [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('.start-actions button:has-text("백업 파일 불러오기")')]);
  await fc.setFiles(badPath);
  await page.waitForSelector('dialog');
  check('잘못된 백업 파일 거부', async () => {});
  assert.match(await page.textContent('dialog'), /백업 파일이 아닙니다/);
  await okDialog();
  [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('.start-actions button:has-text("백업 파일 불러오기")')]);
  await fc.setFiles(backupPath);
  await page.waitForSelector('dialog');
  await okDialog();
  await page.waitForSelector('.screen-inq1');
  const restored = await page.evaluate(() => JSON.stringify({ a: window.__tideApp.store.state.answers, e: window.__tideApp.store.state.evidences, l: window.__tideApp.store.state.links }));
  check('백업 불러오기로 복구', () => assert.deepEqual(JSON.parse(restored), JSON.parse(before)));

  // 8. 보고서·PDF
  await page.evaluate(() => window.__tideApp.navigate('report'));
  await page.waitForSelector('#btn-pdf');
  const checkText = await page.textContent('.check-card');
  check('미작성 문항 안내', () => assert.match(checkText, /작성하지 않은 문항/));
  await page.screenshot({ path: join(OUT, 'e2e-report.png'), fullPage: false });
  await page.click('#btn-pdf');
  await page.waitForSelector('dialog');
  const [pdfDl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), okDialog()]);
  const pdfPath = join(OUT, pdfDl.suggestedFilename());
  await pdfDl.saveAs(pdfPath);
  await page.waitForSelector('.pdf-status.ok');
  check('PDF 파일 이름', () => assert.equal(pdfDl.suggestedFilename(), '조석탐구_3학년2반15번_김학생.pdf'));
  check('다운로드 후 제출 안내 표시', async () => {});
  assert.match(await page.textContent('.pdf-status'), /선생님이 안내한 곳에 제출하세요/);
  const stillThere = await page.evaluate(() => Object.keys(window.__tideApp.store.state.answers).length);
  check('PDF 다운로드 후 답안 유지', () => assert.ok(stillThere >= 5));

  const txt = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' });
  writeFileSync(join(OUT, 'report.txt'), txt);
  const info = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
  const pages = Number(/Pages:\s+(\d+)/.exec(info)[1]);
  check('PDF A4 세로', () => assert.match(info, /595\.\d* x 841\.\d* pts/));
  check('PDF 한글 텍스트(검색 가능)·학생 정보', () => { assert.ok(txt.includes('3학년 2반 15번 김학생')); assert.ok(txt.includes('조석 데이터 탐구 보고서')); });
  check('PDF 예시 데이터 표시', () => assert.ok(txt.includes('기능 확인용 예시 데이터')));
  check('PDF 줄바꿈 유지', () => { const i = txt.indexOf('첫째 줄'); const j = txt.indexOf('둘째 줄'); assert.ok(i >= 0 && j > i && txt.slice(i, j).includes('\n')); });
  check('PDF 긴 답변이 잘리지 않음(마지막 줄 포함)', () => assert.ok(txt.includes('마지막줄확인용문장')));
  check('PDF 미작성 문항 표시', () => assert.ok(txt.includes('(작성하지 않음)')));
  check('PDF 그림 번호 = 근거 번호', () => { assert.ok(txt.includes('그림 1-1')); assert.ok(txt.includes('근거 1-1')); assert.ok(txt.includes('그림 3-1')); });
  check('PDF 쪽 번호', () => assert.ok(new RegExp(`\\b1\\s*/\\s*${pages}\\b`).test(txt) && new RegExp(`\\b${pages}\\s*/\\s*${pages}\\b`).test(txt)));
  check('PDF 자료 출처', () => assert.ok(txt.includes('자료 출처와 관측 간격')));
  check('PDF 음수 부호', () => assert.ok(/-14 cm|−14 cm/.test(txt)));
  execFileSync('pdftoppm', ['-r', '60', '-png', pdfPath, join(OUT, 'pdfpage')]);

  // 화면 답안과 PDF 내용 일치(공백 정규화 비교)
  // 쪽 바닥글을 빼고 비교(긴 답변이 쪽을 넘기 때문)
  const body = execFileSync('pdftotext', [pdfPath, '-'], { encoding: 'utf8' }).replace(/\f/g, '').split('\n').filter((l) => !/^조석 데이터 탐구실 · |^기능 확인용 예시 데이터 — 실제 관측값 아님|^\d+\s*\/\s*\d+$/.test(l.trim())).join('\n');
  const norm = (s) => s.replace(/\s+/g, '').replace(/\u2212/g, '-');
  check('화면 답안과 PDF 내용 일치', () => {
    for (const a of [longAns, '높이 차이는 −14 cm처럼 음수가 될 수 있다.', '하루에 만조가 두 번 정도 나타났다.']) {
      assert.ok(norm(body).includes(norm(a)), a.slice(0, 20));
    }
  });

  // 수정 후 재다운로드
  await page.evaluate(() => window.__tideApp.navigate('inq1'));
  await page.fill('#ans-i1q3', '만조와 간조가 하루에 대략 두 번씩 나타났다.');
  await page.evaluate(() => window.__tideApp.navigate('report'));
  await page.click('#btn-pdf');
  await page.waitForSelector('dialog');
  const [pdf2] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), okDialog()]);
  const pdf2Path = join(OUT, 'second.pdf');
  await pdf2.saveAs(pdf2Path);
  check('수정 후 재다운로드 반영', () => assert.ok(execFileSync('pdftotext', [pdf2Path, '-'], { encoding: 'utf8' }).includes('대략 두 번씩')));

  // 9. 자료 일부 미제공 사례
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errors.push(`pageerror(minimal): ${e.message}`));
  await p2.goto(BASE + '?case=test-minimal');
  await p2.waitForSelector('.student-form');
  await p2.selectOption('select[name=grade]', '1');
  await p2.fill('input[name=klass]', '1');
  await p2.fill('input[name=number]', '1');
  await p2.fill('input[name=name]', '검증');
  await p2.click('button[type=submit]');
  await p2.evaluate(() => window.__tideApp.navigate('inq2'));
  await p2.waitForSelector('#moon-toggle');
  check('달의 위상 미제공 → 토글 비활성·안내', async () => {});
  assert.equal(await p2.isDisabled('#moon-toggle'), true);
  await p2.evaluate(() => window.__tideApp.navigate('inq3'));
  await p2.waitForSelector('.screen-inq3 svg');
  const t3 = await p2.textContent('.screen-inq3');
  check('기준면 불일치 → 잔차 계산 안 함', () => { assert.match(t3, /잔차 계산 불가/); assert.match(t3, /기준면이 다릅니다/); });
  check('기상 자료 미제공 안내', () => assert.match(t3, /기상 자료 미제공/));
  const resPts = await p2.evaluate(() => window.__tideApp.cd.residual.points.length);
  check('잘못된 잔차 생성 없음', () => assert.equal(resPts, 0));
  await p2.screenshot({ path: join(OUT, 'e2e-minimal-inq3.png'), fullPage: true });
  await ctx2.close();
} catch (e) {
  results.push(['✗', '실행 중 오류', e.stack]);
} finally {
  await browser.close();
  server.kill();
}
for (const e of errors) results.push(['✗', '브라우저 오류', e]);
for (const r of results) console.log(r.join(' '));
const failed = results.filter((r) => r[0] === '✗').length;
console.log(`\n통과 ${results.length - failed} / 실패 ${failed}`);
process.exit(failed ? 1 : 0);

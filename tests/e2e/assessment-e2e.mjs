// 전체화면 평가 모드 검증 (Playwright): node tests/e2e/assessment-e2e.mjs [결과폴더]
// 정상 시작·종료, 시작 실패, 전체화면 해제, 복귀 실패, 탭 전환, Alt+Tab(포커스 상실), 짧은 포커스 상실,
// 새로고침, 재접속(비정상 종료), 입력 차단, 자동 저장과의 관계, 기록 JSON 내보내기
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = process.argv[2] || join(ROOT, 'tests', 'e2e', 'out');
mkdirSync(OUT, { recursive: true });
const PORT = 8198;
const BASE = `http://localhost:${PORT}/`;
const KEY = 'tideLabAssess.v1';

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(['✓', name]); } catch (e) { results.push(['✗', name, e.message.split('\n')[0]]); }
  if (process.env.VERBOSE) console.log(results[results.length - 1].join(' '));
}

const server = spawn(process.execPath, [join(ROOT, 'tools/serve.mjs'), String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
const browser = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
const errors = [];

const log = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
const active = async (page) => { const l = await log(page); return l.sessions.find((s) => s.id === l.activeId) || l.sessions[l.sessions.length - 1]; };
const phase = (page) => page.evaluate(() => document.documentElement.dataset.asmt);
const isFs = (page) => page.evaluate(() => !!document.fullscreenElement);
const overlayText = (page) => page.evaluate(() => { const o = document.querySelector('.asmt-overlay'); return o.hidden ? '' : o.innerText; });
const appInert = (page) => page.evaluate(() => document.getElementById('app').hasAttribute('inert'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function setVisibility(page, state) {
  await page.evaluate((st) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => st });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => st === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}
async function stubFullscreen(page, mode) {
  await page.evaluate((m) => {
    if (!window.__origRFS) window.__origRFS = Element.prototype.requestFullscreen;
    Element.prototype.requestFullscreen = m === 'reject'
      ? function () { return Promise.reject(new TypeError('Permissions check failed')); }
      : window.__origRFS;
  }, mode);
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  ctx.setDefaultTimeout(15000);
  // 학생 입장 코드는 run-e2e에서 시험한다(여기서는 이미 통과한 탭으로)
  const entryHash = JSON.parse(readFileSync(join(ROOT, 'data/assessment.json'), 'utf8')).entry?.hash;
  if (entryHash) await ctx.addInitScript((h) => { try { sessionStorage.setItem('tideLab.entryOk', h); } catch { /* 무시 */ } }, entryHash);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(BASE);
  await page.waitForSelector('.asmt-guide [data-act=start]');

  await check('접속 시 평가 시작 안내 표시, 콘텐츠 가림·입력 차단', async () => {
    assert.match(await overlayText(page), /평가 시작 안내/);
    assert.equal(await appInert(page), true);
    assert.equal(await phase(page), 'idle');
    assert.ok(!/부정행위|무결성|localStorage/.test(await overlayText(page)), '교사용 유의 사항은 학생 화면에 없음');
  });
  await page.screenshot({ path: join(OUT, 'asmt-guide.png') });

  // 시작 실패
  await stubFullscreen(page, 'reject');
  await page.click('[data-act=start]');
  await page.waitForTimeout(400);
  await check('전체화면 진입 실패 시 평가 시작 안 함', async () => {
    assert.equal(await phase(page), 'idle');
    assert.match(await overlayText(page), /전체화면으로 전환하지 못해 평가를 시작하지 않았습니다/);
    const l = await log(page);
    assert.ok(!l || l.sessions.length === 0);
  });
  await stubFullscreen(page, 'restore');

  // 정상 시작
  await page.click('[data-act=start]');
  await page.waitForTimeout(300);
  await check('[평가 시작] → 전체화면 진입 성공 후 평가 시작', async () => {
    assert.equal(await isFs(page), true);
    assert.equal(await phase(page), 'running');
    assert.equal(await appInert(page), false);
    const s = await active(page);
    assert.equal(s.status, 'running');
    assert.match(s.id, /^asmt-/);
  });
  // 앱 사용: 학생 정보 입력
  await page.selectOption('select[name=grade]', '3');
  await page.fill('input[name=klass]', '2');
  await page.fill('input[name=number]', '15');
  await page.fill('input[name=name]', '김학생');
  await page.click('.student-form button[type=submit]');
  await page.waitForSelector('#inq1-main svg');
  await page.evaluate(() => window.__tideApp.navigate('inq4'));
  await page.waitForSelector('#ans-q9');

  // 짧은 포커스 상실(2초 미만) → 기록 안 함
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await wait(900);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await wait(1500);
  await check('포커스 상실 2초 미만은 이탈로 집계하지 않음', async () => {
    assert.equal(await phase(page), 'running');
    assert.equal((await active(page)).departures.length, 0);
  });

  // 자동 저장 연결: 입력 직후(지연 저장 전) 전체화면 해제 → 답안이 바로 저장되어야 함
  await page.fill('#ans-q9', '전체화면 해제 직전에 입력한 답안');
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForSelector('.asmt-paused');
  await check('전체화면 해제 → 즉시 중지, 지정 문구 표시, 기록 저장', async () => {
    const t = await overlayText(page);
    for (const line of ['평가가 일시 중지되었습니다.', '전체화면 모드가 해제되었습니다.', '평가를 계속하려면 전체화면으로 복귀하세요.', '화면 이탈 기록이 저장되었습니다.']) assert.ok(t.includes(line), line);
    assert.match(t, /전체화면으로 복귀/);
    const s = await active(page);
    assert.equal(s.departures.length, 1);
    assert.equal(s.departures[0].type, 'fullscreen-exit');
    assert.equal(s.status, 'paused');
  });
  await check('중지 직후 입력 중이던 답안이 자동 저장 경로로 저장됨', async () => {
    const w = await page.evaluate(() => JSON.parse(localStorage.getItem('tideLab.v1.work')));
    assert.equal(w.answers.q9, '전체화면 해제 직전에 입력한 답안');
  });
  await page.screenshot({ path: join(OUT, 'asmt-paused.png') });
  await check('중지 중 콘텐츠 가림·마우스·키보드 입력 차단', async () => {
    assert.equal(await appInert(page), true);
    const top = await page.evaluate(() => { const el = document.elementFromPoint(640, 430); return el.closest('.asmt-overlay') ? 'overlay' : el.tagName; });
    assert.equal(top, 'overlay');
    // 키 입력 시도
    await page.evaluate(() => document.getElementById('ans-q9').focus());
    await page.keyboard.type('XYZ');
    assert.equal(await page.inputValue('#ans-q9'), '전체화면 해제 직전에 입력한 답안');
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.asmt-overlay')).backgroundColor);
    assert.match(bg, /rgb\(\d+, \d+, \d+\)$/, '불투명 배경');
  });

  // 복귀 실패
  await stubFullscreen(page, 'reject');
  await page.click('[data-act=resume]');
  await page.waitForTimeout(400);
  await check('복귀 실패·취소 시 중지 유지, 횟수 그대로', async () => {
    assert.equal(await phase(page), 'paused');
    assert.match(await overlayText(page), /복귀하지 못했습니다/);
    const s = await active(page);
    assert.equal(s.departures.length, 1);
    assert.ok(s.departures[0].signals.some((g) => g.type === 'resume-failed'));
    assert.equal(s.departures[0].returnedAt, null);
  });
  await stubFullscreen(page, 'restore');
  await page.click('[data-act=resume]');
  await page.waitForTimeout(300);
  await check('[전체화면으로 복귀] 성공 시에만 재개, 복귀 시각·지속 시간 기록', async () => {
    assert.equal(await phase(page), 'running');
    assert.equal(await isFs(page), true);
    assert.equal(await appInert(page), false);
    const d = (await active(page)).departures[0];
    assert.ok(d.returnedAt > d.startedAt);
    assert.equal(d.durationMs, d.returnedAt - d.startedAt);
  });

  // 탭 전환: 한 행동에서 blur → hidden → 전체화면 해제가 함께 발생
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await setVisibility(page, 'hidden');
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForTimeout(200);
  await setVisibility(page, 'visible');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(200);
  await check('탭 전환: 여러 이벤트를 1회로 집계(즉시 기록)', async () => {
    const s = await active(page);
    assert.equal(s.departures.length, 2);
    const d = s.departures[1];
    assert.deepEqual(d.signals.map((g) => g.type).slice(0, 3), ['blur', 'hidden', 'fullscreen-exit']);
    assert.equal(d.type, 'fullscreen-exit');
    assert.equal(await phase(page), 'paused');
  });
  await page.click('[data-act=resume]');
  await page.waitForTimeout(300);

  // 실제 다른 탭을 앞으로 가져오기(헤드리스에서 visibilitychange가 나오는 경우 확인)
  const other = await ctx.newPage();
  await other.goto('about:blank');
  await other.bringToFront();
  await wait(2600);
  await page.bringToFront();
  await page.waitForTimeout(300);
  const realTab = (await active(page)).departures.length;
  results.push(['ℹ', `실제 탭 전환(bringToFront): 헤드리스에서 ${realTab > 2 ? '이벤트 발생·기록됨' : '이벤트가 발생하지 않아 기록 없음(합성 이벤트로 검증)'}`]);
  await other.close();
  if (await phase(page) === 'paused') { await page.click('[data-act=resume]'); await page.waitForTimeout(300); }
  const base = (await active(page)).departures.length;

  // Alt+Tab: 전체화면은 유지된 채 창 포커스만 상실(2초 이상)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await wait(2400);
  await check('Alt+Tab(포커스만 2초 이상 상실) → 이탈 1회·중지', async () => {
    const s = await active(page);
    assert.equal(s.departures.length, base + 1);
    assert.equal(s.departures[base].type, 'focus-loss');
    assert.equal(await phase(page), 'paused');
    assert.match(await overlayText(page), /2초 이상 포커스를 잃었습니다/);
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await check('전체화면이 유지된 상태여도 버튼으로 복귀해야 재개', async () => {
    assert.equal(await isFs(page), true);
    assert.equal(await phase(page), 'paused');
  });
  await page.click('[data-act=resume]');
  await page.waitForTimeout(300);

  // 새로고침
  const before = (await active(page)).departures.length;
  await page.reload();
  await page.waitForSelector('.asmt-paused');
  await check('새로고침 → 기록 복원, 전체화면 복귀 전까지 중지 유지', async () => {
    const s = await active(page);
    assert.equal(s.departures.length, before + 1);
    assert.equal(s.departures[before].type, 'page-leave');
    assert.ok(s.departures[before].signals.some((g) => g.type === 'reload'));
    assert.equal(await phase(page), 'paused');
    assert.equal(await appInert(page), true);
    assert.equal(await isFs(page), false);
  });
  await page.waitForTimeout(500);
  await page.click('[data-act=resume]');
  await page.waitForTimeout(300);
  await check('새로고침 후 복귀 → 기존 답안 유지·평가 재개', async () => {
    assert.equal(await phase(page), 'running');
    assert.equal(await page.inputValue('#ans-q9'), '전체화면 해제 직전에 입력한 답안');
  });

  // 재접속(비정상 종료: pagehide 없음) — 탭 강제 종료 후 새 탭으로 접속
  const sid = (await active(page)).id;
  const n0 = (await active(page)).departures.length;
  // 비정상 종료 흉내: 탭을 닫은 뒤, 새 탭이 열리기 전에 pagehide 기록을 지워
  // '종료 신호가 남지 않은 채 끝난 경우'(전원 차단·강제 종료)를 만든다.
  await page.close();
  const page2 = await ctx.newPage();
  await page2.addInitScript(([k, id]) => {
    if (sessionStorage.getItem('__crashSim')) return;
    sessionStorage.setItem('__crashSim', '1');
    const l = JSON.parse(localStorage.getItem(k));
    const s = l.sessions.find((x) => x.id === id);
    const last = s.departures[s.departures.length - 1];
    if (last && last.returnedAt == null && last.type === 'page-leave') { s.departures.pop(); s.status = 'running'; }
    localStorage.setItem(k, JSON.stringify(l));
  }, [KEY, sid]);
  page2.on('pageerror', (e) => errors.push(`pageerror2: ${e.message}`));
  await page2.goto(BASE);
  await page2.waitForSelector('.asmt-paused');
  await check('재접속(비정상 종료) → 같은 세션 복원, 추정 시작 시각으로 1회 기록', async () => {
    const s = await active(page2);
    assert.equal(s.id, sid);
    assert.equal(s.departures.length, n0 + 1);
    const d = s.departures[n0];
    assert.equal(d.type, 'reconnect');
    assert.equal(d.startEstimated, true);
    assert.match(d.signals[0].detail, /마지막 확인 시각으로 추정/);
  });
  await page2.click('[data-act=resume]');
  await page2.waitForTimeout(300);

  // 앱의 '내 작성 내용 삭제'로 기록이 지워지지 않음
  await check("앱의 '내 작성 내용 삭제' 키 범위와 분리", async () => {
    const keys = await page2.evaluate(() => Object.keys(localStorage));
    assert.ok(keys.includes(KEY));
    assert.ok(!KEY.startsWith('tideLab.'));
  });

  await check('보고서(PDF 구성)에 이번 평가의 화면 이탈 기록이 그대로 들어감', async () => {
    const s = await active(page2);
    await page2.evaluate(() => window.__tideApp.navigate('report'));
    await page2.waitForSelector('[data-part=departures]');
    const t = await page2.textContent('[data-part=departures]');
    assert.ok(t.includes(s.id), '세션 ID');
    assert.match(t, new RegExp(`화면 이탈\\s*${s.departures.length}회`));
    assert.ok(t.includes(s.departures[0].typeLabel));
    assert.match(t, /\(추정\)/, '재접속 추정 시각 표시');
    const n = await page2.evaluate(() => window.__tideApp.departuresInfo().current.departures.length);
    assert.equal(n, s.departures.length);
  });

  // 정상 종료
  const nEnd = (await active(page2)).departures.length;
  await page2.click('.asmt-pill [data-act=end]');
  await page2.waitForSelector('.asmt-modal [data-act=confirm-end]');
  await page2.click('.asmt-modal [data-act=confirm-end]');
  await page2.waitForSelector('.asmt-ended');
  await check('정상 종료: 전체화면 해제, 이탈로 집계 안 함', async () => {
    assert.equal(await isFs(page2), false);
    const l = await log(page2);
    const s = l.sessions.find((x) => x.id === sid);
    assert.equal(s.status, 'ended');
    assert.ok(s.endedAt);
    assert.equal(s.departures.length, nEnd);
    assert.equal(l.activeId, null);
    assert.ok(!/부정행위|무결성|localStorage|fullscreenchange/.test(await page2.textContent('.asmt-ended')), '종료 화면에 교사용 유의 사항 없음');
  });
  await page2.evaluate(() => { window.dispatchEvent(new Event('blur')); });
  await wait(2300);
  await page2.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
  await check('종료 후 이탈 감지 중지', async () => {
    const s = (await log(page2)).sessions.find((x) => x.id === sid);
    assert.equal(s.departures.length, nEnd);
    assert.equal(await phase(page2), 'ended');
  });
  await page2.screenshot({ path: join(OUT, 'asmt-ended.png') });
  await check('종료 화면: 이탈 기록 표시, 기록 받기(JSON) 버튼 없음(PDF 보고서에 포함)', async () => {
    assert.equal(await page2.$('.asmt-ended [data-act=download]'), null);
    assert.match(await page2.textContent('.asmt-ended'), new RegExp(`화면 이탈\\s*${nEnd}회`));
  });
  await page2.click('.asmt-ended [data-act=new]');
  await check('새 평가 시작 안내로 돌아감(버튼 클릭 전 전체화면 강제 진입 없음)', async () => {
    assert.equal(await phase(page2), 'idle');
    assert.equal(await isFs(page2), false);
    assert.equal(await page2.$('.asmt-guide [data-act=download]'), null, '시작 안내에 기록 받기 없음');
    assert.ok(!(await overlayText(page2)).includes('지난 평가 기록'));
  });
} catch (e) {
  results.push(['✗', '실행 중 오류', e.stack]);
} finally {
  await browser.close();
  server.kill();
}
for (const e of errors) results.push(['✗', '브라우저 오류', e]);
for (const r of results) console.log(r.join(' '));
const failed = results.filter((r) => r[0] === '✗').length;
console.log(`\n통과 ${results.filter((r) => r[0] === '✓').length} / 실패 ${failed}`);
process.exit(failed ? 1 : 0);

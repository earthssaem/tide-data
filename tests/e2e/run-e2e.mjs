// 수행평가 흐름 검증 (Playwright): node tests/e2e/run-e2e.mjs [결과폴더]
// 학생용(부산 2022-09 실제 자료): 학생 정보 → 관측소 선택 → 탐구 1~5(자료 공개 단계) → 결론 → 새로고침·백업 복원 → PDF
// 교사용: 관측소별 설정·검증·내보내기 → 미리보기 적용(학생 답안과 분리) · 이전 형식 보존 · 자료 로딩 실패
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
const CASE_DIR = join(ROOT, 'data/cases/khoa-multi-2022-09/stations/DT_0005');

// ── 원자료에서 직접 기대값 계산(앱 코드와 독립) ──
function readCsv(file) {
  const lines = readFileSync(join(CASE_DIR, file), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
  const head = lines[0].split(',');
  return lines.slice(1).map((l) => Object.fromEntries(l.split(',').map((v, i) => [head[i], v])));
}
const obs = readCsv('observed.csv').map((r) => ({ t: r.time, v: r.tide_cm === '' ? null : Number(r.tide_cm) }));
const wx = new Map(readCsv('weather.csv').map((r) => [r.time, r]));
const idxIn = (from, t) => obs.slice(obs.findIndex((r) => r.t === from)).findIndex((r) => r.t === t);

async function passAssessment(p) {
  await p.waitForSelector('#asmt-root', { state: 'attached' });
  const btn = await p.$('.asmt-overlay:not([hidden]) [data-act=start], .asmt-overlay:not([hidden]) [data-act=resume]');
  if (btn) { await btn.click(); await p.waitForFunction(() => document.documentElement.dataset.asmt === 'running'); }
}

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(['✓', name]); console.log('✓', name); } catch (e) { results.push(['✗', name, e.message]); console.log('✗', name, '\n   ', e.message); }
};

// 초기 단계(공개 전)에 나오면 안 되는 말: 원인·태풍 정보와 기상 자료
const BANNED = ['태풍', '힌남노', 'HINNAMNOR', '상륙', '최근접', '기압', '풍속', '풍향', '기상', '해일', '비정상'];
async function visibleText(p) {
  return p.evaluate(() => {
    const parts = [document.body.innerText, document.title];
    document.querySelectorAll('[aria-label],[title],[placeholder],[alt]').forEach((el) => {
      for (const a of ['aria-label', 'title', 'placeholder', 'alt']) if (el.getAttribute(a)) parts.push(el.getAttribute(a));
    });
    document.querySelectorAll('svg text').forEach((t) => parts.push(t.textContent));
    return parts.join('\n');
  });
}
async function noSpoiler(p, where) {
  const txt = await visibleText(p);
  const hit = BANNED.filter((w) => txt.includes(w));
  assert.deepEqual(hit, [], `${where}: ${hit.join(', ')}`);
}

const server = spawn(process.execPath, [join(ROOT, 'tools/serve.mjs'), String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
const browser = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
const newCtx = async (o) => { const c = await browser.newContext(o); c.setDefaultTimeout(15000); return c; };
const errors = [];
const watch = (p, tag) => {
  p.on('pageerror', (e) => errors.push(`pageerror(${tag}): ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(`console(${tag}): ${m.text()}`); });
};
const okDialog = async (p) => { await p.click('dialog[open] button[value=ok]'); await p.waitForTimeout(200); };
const go = async (p, step) => { await p.evaluate((s) => window.__tideApp.navigate(s), step); await p.waitForTimeout(350); };
const stateOf = (p) => p.evaluate(() => JSON.parse(JSON.stringify(window.__tideApp.store.state)));
async function pressRight(p, sel, n) {
  await p.focus(sel);
  for (let i = 0; i < n; i++) await p.keyboard.press('ArrowRight');
}

const longAns = '첫째 줄: 만조 사이의 간격은 약 12시간 25분이었다.\n둘째 줄: 하루에 만조와 간조가 두 번씩 나타났다.\n' + '긴 답변 줄바꿈 확인 문장입니다. '.repeat(40) + '마지막줄확인용문장';

try {
  const ctx = await newCtx({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page, 'student');

  // ───── 1. 시작 화면 ─────
  await page.goto(BASE + '?case=sample-2099');
  await passAssessment(page);
  await page.waitForSelector('.student-form');
  await check('시작: 제목·활동 소개 문구', async () => {
    assert.equal(await page.textContent('.start-hero h1'), '조석 데이터 탐구실');
    assert.match(await page.textContent('.start-hero .lead'), /우리나라 여러 지역의 해수면 변화에서 규칙을 찾고, 관측 자료를 근거로 그 원인을 탐구해 봅시다\./);
  });
  await check('학생용: 주소창 ?case=로 가상 데이터를 고를 수 없음(실제 자료만)', async () => {
    assert.equal(await page.isVisible('#sample-banner'), false);
    const id = await page.evaluate(() => window.__tideApp.cd.id);
    assert.equal(id, 'khoa-multi-2022-09');
  });
  await check('시작 화면에 태풍·원인 정보 없음', () => noSpoiler(page, '시작'));
  await page.click('#btn-start');
  await check('학생 정보 미입력 시 안내', async () => assert.ok(await page.isVisible('.form-error')));
  await page.selectOption('select[name=grade]', '3');
  await page.fill('input[name=klass]', '2');
  await page.fill('input[name=number]', '15');
  await page.fill('input[name=name]', '김학생');
  await page.click('#btn-start');

  // ───── 2. 관측소 선택 ─────
  await page.waitForSelector('#station-list .sp-pick');
  await page.waitForSelector('#station-map svg');
  await check('관측소 선택: 교사가 켠 관측소(부산)만 목록에 표시', async () => {
    const ids = await page.$$eval('#station-list .sp-pick', (b) => b.map((x) => x.dataset.id));
    assert.deepEqual(ids, ['DT_0005']);
  });
  await check('관측소 소개에 결과를 미리 쓰지 않음(조차·태풍 등)', async () => {
    await noSpoiler(page, '관측소 선택');
    const t = await page.textContent('#screen');
    assert.ok(!/조차가 큰|영향이 뚜렷|첫 작동/.test(t));
  });
  await page.click('#station-map .map-st');
  await check('지도에서 고르면 위치와 분석 기간 표시', async () => {
    assert.match(await page.textContent('#station-detail'), /35\.10°N/);
    assert.match(await page.textContent('#station-period'), /2022-09-01 00:00 ~ 10-01 00:00/);
  });
  await page.click('#btn-explore');
  await page.waitForSelector('.screen-inq1 .chart-view svg');

  // ───── 3. 탐구 1 ─────
  await check('탐구 1: 교사 설정 기본 관찰 구간 적용(부산 9/13~9/16)', async () => assert.match(await page.textContent('#ctx-range'), /2022-09-13 00:00 ~ 09-16 00:00/));
  await check('탐구 1: 태풍·원인 정보 미노출(제목·범례·설명·접근성 문구 포함)', () => noSpoiler(page, '탐구 1'));
  const r1 = obs.filter((r) => r.t >= '2022-09-13 00:00' && r.t < '2022-09-16 00:00');
  const highs = [];
  for (let i = 1; i < r1.length - 1; i++) if (r1[i].v > r1[i - 1].v && r1[i].v >= r1[i + 1].v && r1[i].v > 100) highs.push(i);
  const pick = highs.slice(0, 2);
  const lowIdx = r1.findIndex((r, i) => i > pick[0] && i < pick[1] && r.v === Math.min(...r1.slice(pick[0], pick[1]).map((x) => x.v)));
  await pressRight(page, '.screen-inq1 .chart-view', pick[0] + 1); await page.keyboard.press('Enter');
  for (const [from, to] of [[pick[0], lowIdx], [lowIdx, pick[1]]]) { for (let i = 0; i < to - from; i++) await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); }
  await page.waitForTimeout(200);
  const kinds = await page.$$('#inq1-points .kind-sel');
  await kinds[0].selectOption('high'); await page.waitForTimeout(100);
  await (await page.$$('#inq1-points .kind-sel'))[1].selectOption('low'); await page.waitForTimeout(100);
  await (await page.$$('#inq1-points .kind-sel'))[2].selectOption('high'); await page.waitForTimeout(150);
  await check('탐구 1: 키보드로 고른 지점 = 원자료(시각·조위)', async () => {
    const rows = await page.$$eval('#inq1-points tbody tr', (trs) => trs.map((tr) => tr.innerText));
    assert.equal(rows.length, 3);
    [pick[0], lowIdx, pick[1]].forEach((k, i) => { assert.ok(rows[i].includes(r1[k].t), rows[i]); assert.ok(rows[i].includes(`${r1[k].v} cm`), rows[i]); });
  });
  await check('탐구 1: 학생이 표시한 만조끼리 시간 차이 계산(자동 판정 없음)', async () => {
    const t = await page.textContent('#inq1-kind-diffs');
    const h = pick[1] - pick[0];
    assert.match(t, new RegExp(`${h}시간`));
    assert.ok(!/(반일주조|일주조|혼합조)/.test(await page.textContent('#screen')));
  });
  await page.fill('#ans-a1q1', 'A(만조), B(간조), C(만조)를 골랐다.');
  await page.fill('#ans-a1q2', longAns);
  await page.fill('#ans-a1q3', '하루에 만조와 간조가 대략 두 번씩 나타났다.');
  await page.fill('#ans-a1q4', '높이 차이는 −14 cm처럼 음수가 될 수 있다.');
  await page.click('.screen-inq1 .add-ev-bar button');
  await page.waitForTimeout(300);
  await page.click('#q-a1q1 .links .chip');

  // ───── 4. 탐구 2 ─────
  await go(page, 'inq2');
  await page.waitForSelector('.screen-inq2 .chart-view svg');
  await check('탐구 2: 공개 전 달의 위상·음력·정답 표시 없음', async () => {
    assert.equal(await page.$$eval('.moon-item', (x) => x.length), 0);
    assert.equal(await page.$('#moon-toggle'), null);
    const svgText = await page.$$eval('.screen-inq2 svg text', (x) => x.map((t) => t.textContent).join(' '));
    assert.ok(!/(삭|망|상현|하현) \d/.test(svgText), '그래프에 위상선이 있으면 안 됨');
    assert.ok(!/음력/.test(await page.textContent('#screen')));
    assert.ok(await page.isVisible('#btn-reveal-moon'));
    await noSpoiler(page, '탐구 2');
  });
  const daily = '.screen-inq2 .chart-view >> nth=1';
  await pressRight(page, daily, 11); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
  for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter'); await page.waitForTimeout(250);
  await (await page.$$('#inq2-days .kind-sel'))[0].selectOption('spring'); await page.waitForTimeout(150);
  await (await page.$$('#inq2-days .kind-sel'))[1].selectOption('neap'); await page.waitForTimeout(150);
  await check('탐구 2: 고른 날짜와 학생 판단(대조·소조) 표시', async () => {
    const t = await page.textContent('#inq2-days');
    assert.match(t, /9월 11일/); assert.match(t, /9월 20일/);
    const st = await stateOf(page);
    assert.deepEqual(st.analysis.inq2.selectedDays.map((d) => d.kind), ['spring', 'neap']);
  });
  for (const [id, v] of [['a2q1', '변동 폭이 커졌다 작아졌다를 반복한다.'], ['a2q2', '대조: 9월 11일 무렵, 소조: 9월 20일 무렵'], ['a2q3', '약 2주 간격으로 반복된다.'], ['a2q4', '대조 때는 달·지구·태양이 일직선, 소조 때는 직각을 이룬다.']]) await page.fill(`#ans-${id}`, v);
  const surf = page.locator('#draw-a2q4 .draw-surface');
  await surf.scrollIntoViewIfNeeded();
  let bb = await surf.boundingBox();
  await page.mouse.move(bb.x + bb.width * 0.2, bb.y + bb.height * 0.5); await page.mouse.down();
  await page.mouse.move(bb.x + bb.width * 0.7, bb.y + bb.height * 0.45, { steps: 10 }); await page.mouse.up();
  await page.click('#draw-a2q4 [data-tool=text]');
  bb = await surf.boundingBox();
  await page.mouse.click(bb.x + bb.width * 0.15, bb.y + bb.height * 0.3);
  await page.fill('#draw-a2q4 .draw-text-input input', '달그림표시');
  await page.click('#draw-a2q4 .draw-text-input .btn-primary');
  await page.waitForTimeout(200);
  await check('탐구 2: 그림판 선·글자 저장', async () => {
    const st = await stateOf(page);
    assert.equal(st.drawings.a2q4.strokes.length, 1);
    assert.ok(st.drawings.a2q4.strokes[0].p.length > 3);
    assert.equal(st.drawings.a2q4.texts[0].t, '달그림표시');
  });
  await page.click('.screen-inq2 .add-ev-bar button');
  await page.waitForTimeout(300);
  await page.click('#btn-reveal-moon');
  await page.waitForSelector('dialog[open]');
  await okDialog(page);
  await page.waitForSelector('.moon-item');
  await check('탐구 2: [달의 위상 자료 확인] 후 위상 공개', async () => {
    assert.ok(await page.$$eval('.moon-item', (x) => x.length) >= 4);
    const svgText = await page.$$eval('.screen-inq2 svg text', (x) => x.map((t) => t.textContent).join(' '));
    assert.match(svgText, /망 9\/10/);
  });
  await check('탐구 2: 공개 전 답(문항 1~4·그림)을 따로 보관하고 고정', async () => {
    const st = await stateOf(page);
    assert.equal(st.reveals.moon.answers.a2q4, '대조 때는 달·지구·태양이 일직선, 소조 때는 직각을 이룬다.');
    assert.equal(st.reveals.moon.drawing.texts[0].t, '달그림표시');
    assert.equal(await page.$eval('#ans-a2q4', (e) => e.readOnly), true);
    assert.equal(await page.$('#draw-a2q4 .draw-tool'), null);
  });
  await page.fill('#ans-a2q5', '실제 망(9/10) 다음 날 변동 폭이 가장 컸다. 내가 찾은 대조 시기와 하루 정도 차이가 있다.');

  // ───── 5. 탐구 3 ─────
  await go(page, 'inq3');
  await page.waitForSelector('.screen-inq3 .chart-view svg');
  await check('탐구 3: 집중 관찰 구간 적용(9/4~9/8), 원인 정보 미노출', async () => {
    assert.match(await page.textContent('#ctx-range'), /2022-09-04 00:00 ~ 09-08 00:00/);
    await noSpoiler(page, '탐구 3');
  });
  const k3 = idxIn('2022-09-04 00:00', '2022-09-06 05:00');
  await pressRight(page, '.screen-inq3 .chart-view >> nth=0', k3 + 1); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  await check('탐구 3: 고른 지점 값 = 원자료, 날짜별 최고·최저·평균 표', async () => {
    const t = await page.textContent('#inq3-points');
    assert.ok(t.includes('2022-09-06 05:00') && t.includes(`${obs.find((r) => r.t === '2022-09-06 05:00').v} cm`), t);
    assert.equal(await page.$$eval('#inq3-days tbody tr', (x) => x.length), 4);
  });
  await page.click('.screen-inq3 [data-go=month]'); await page.waitForTimeout(200);
  await check('탐구 3: 한 달 전체·기본 구간으로 돌아가 비교 가능', async () => {
    let st = await stateOf(page);
    assert.equal(st.analysis.inq3.view[1] - st.analysis.inq3.view[0], 30 * 864e5);
    await page.click('.screen-inq3 [data-go=basic]'); await page.waitForTimeout(200);
    st = await stateOf(page);
    assert.equal(st.analysis.inq3.view[1] - st.analysis.inq3.view[0], 3 * 864e5);
    await page.click('.screen-inq3 [data-go=focus]'); await page.waitForTimeout(200);
  });
  await page.click('.screen-inq3 .add-ev-bar button'); await page.waitForTimeout(300);
  await page.click('#q-a3q2 .links .chip');
  await page.fill('#ans-a3q1', '9월 6일 새벽에 앞의 반복 양상과 다르게 조위가 갑자기 높아졌다.');
  await page.fill('#ans-a3q2', 'A(9/6 05:00) 조위가 이 구간에서 가장 높았다.');
  await page.fill('#ans-a3q3', '높아진 상태는 몇 시간 이어졌다.');

  // ───── 6. 탐구 5 잠금 확인 → 탐구 4 ─────
  await go(page, 'inq5');
  await check('탐구 5: 탐구 4에서 확인하기 전에는 잠김', async () => {
    assert.ok(await page.isVisible('#inq5-gate'));
    assert.match(await page.textContent('[data-step=inq5]'), /잠김/);
    await noSpoiler(page, '탐구 5(잠김)');
  });
  await go(page, 'inq4');
  await check('탐구 4: 추가 자료 확인 전 원인 힌트·선택지 없음', async () => {
    await noSpoiler(page, '탐구 4');
    assert.equal(await page.$$eval('.screen-inq4 input[type=radio], .screen-inq4 select', (x) => x.length), 0);
  });
  await page.fill('#ans-a4q1', '바다의 상태가 갑자기 달라졌을 것 같다. 바람이 강했을 수도 있다.');
  await page.click('#btn-reveal-weather');
  await page.waitForSelector('dialog[open]');
  await check('탐구 4: 빈 답변으로 진행 시 안내(자동으로 채우지 않음)', async () => assert.match(await page.textContent('dialog[open]'), /아직 쓰지 않은 문항: 문항 2/));
  await okDialog(page);
  await page.waitForSelector('.screen-inq5 .chart-view svg');
  await check('추가 자료 공개 시점의 답 별도 보관·초기 추측 고정', async () => {
    const st = await stateOf(page);
    assert.equal(st.reveals.weather.answers.a4q1, '바다의 상태가 갑자기 달라졌을 것 같다. 바람이 강했을 수도 있다.');
    assert.equal(st.reveals.weather.answers.a4q2, '');
    assert.equal(st.answers.a4q2 || '', '');
  });

  // ───── 7. 탐구 5 ─────
  await check('탐구 5: 기압·풍속·풍향·태풍 경로 공개(같은 시간축 별도 그래프)', async () => {
    const t = await page.textContent('#screen');
    assert.match(t, /힌남노/);
    assert.ok(await page.isVisible('#wx-pressureSea'));
    assert.ok(await page.$('#track-map svg') || true);
    assert.equal(await page.$$eval('.screen-inq5 .wx-host .chart-view', (x) => x.length), 3);
  });
  await check('탐구 5: 예측 조위 없음 → 잔차 그래프 없이 안내', async () => {
    const t = await page.textContent('#screen');
    assert.match(t, /예측 조위 자료가 없어/);
    assert.ok(!/잔차 = 같은 시각/.test(t));
  });
  await check('탐구 5: 기상 관측 지점 위치·거리, 중심기압 주의', async () => {
    const t = await page.textContent('#screen');
    assert.match(t, /약 1\.0 km/); assert.match(t, /부산의 관측 기압이 아님/); assert.match(t, /원인을 확정할 수 없습니다/);
  });
  const k5 = idxIn('2022-09-04 00:00', '2022-09-06 05:00');
  await pressRight(page, '.screen-inq5 .chart-view >> nth=0', k5 + 1); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
  const w5 = wx.get('2022-09-06 05:00');
  await check('탐구 5: 고른 시각의 조위·해면기압·풍속 = 원자료', async () => {
    const t = await page.textContent('.screen-inq5 .table-host.wide');
    assert.ok(t.includes(`${obs.find((r) => r.t === '2022-09-06 05:00').v} cm`), t);
    assert.ok(t.includes(`${Number(w5.pressure_sea_hpa).toFixed(1)} hPa`), t);
    assert.ok(t.includes(`${Number(w5.wind_ms).toFixed(1)} m/s`), t);
  });
  await page.waitForSelector('#track-map svg', { timeout: 5000 });
  await page.click('.screen-inq5 .add-ev-bar button'); await page.waitForTimeout(400);
  await page.click('#q-a5q1 .links .chip');
  await check('탐구 5: 초기 추측을 수정 문항 옆에 표시', async () => assert.match(await page.textContent('#q-a5q3 .compare-prev'), /바다의 상태가 갑자기/));
  await page.fill('#ans-a5q1', '9월 6일 06:00 해면기압이 가장 낮았고 풍속이 커졌다.');
  await page.fill('#ans-a5q2', '태풍 중심이 9월 6일 새벽 부산 근처를 지나갔다.');
  await page.fill('#ans-a5q3', '초기 추측(바람)을 유지하되, 기압이 낮아진 것도 원인으로 추가한다.');
  await page.fill('#ans-a5q4', '예측 조위가 없어 태풍 때문에 높아진 정확한 높이는 알 수 없다.');
  await page.screenshot({ path: join(OUT, 'e2e-inq5.png'), fullPage: true });

  // ───── 8. 새로고침 복구 ─────
  await go(page, 'conclusion');
  await page.fill('#ans-c1', '하루에 두 번 만조·간조, 한 달에 두 번 대조·소조가 나타났다.');
  await page.fill('#ans-c2', '대조는 달·태양·지구의 위치 관계와, 9월 6일의 상승은 기상 상황과 관련이 있다.');
  await page.fill('#ans-c3', '처음에는 바람만 생각했지만 기압 자료를 보고 설명을 보완했다.');
  await check('종합 결론: 초기 추측과 보완 설명 나란히', async () => { const t = await page.textContent('#side-by-side'); assert.match(t, /바다의 상태가 갑자기/); assert.match(t, /초기 추측\(바람\)을 유지/); });
  await page.waitForTimeout(800);
  const before = await stateOf(page);
  await page.reload();
  await passAssessment(page);
  await page.waitForSelector('#ans-c1');
  await check('새로고침 후 답안·근거·공개 상태 유지', async () => {
    const after = await stateOf(page);
    for (const k of ['answers', 'links', 'reveals', 'drawings', 'evidences', 'stationId']) assert.deepEqual(after[k], before[k], k);
  });
  await go(page, 'inq2');
  await check('새로고침 후 달의 위상 공개·답 고정 유지', async () => {
    assert.ok(await page.$$eval('.moon-item', (x) => x.length) >= 4);
    assert.equal(await page.$eval('#ans-a2q1', (e) => e.readOnly), true);
  });

  // ───── 9. 백업 → 삭제 → 복원 ─────
  const [bk] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => { window.__tideApp.downloadBackup(); })]);
  const bkPath = join(OUT, 'backup.json');
  await bk.saveAs(bkPath);
  await page.evaluate(() => { window.__tideApp.clearMyWork(); });
  await okDialog(page);
  await page.waitForSelector('.student-form');
  await check('삭제 후 작성 내용 없음', async () => assert.equal((await stateOf(page)).started, false));
  page.once('filechooser', (fc) => fc.setFiles(bkPath));
  await page.evaluate(() => { window.__tideApp.importBackup(); });
  await page.waitForSelector('dialog[open]');
  await okDialog(page);
  await page.waitForTimeout(500);
  await check('백업 복원 후 공개 상태·답안·그림·근거 유지', async () => {
    const after = await stateOf(page);
    for (const k of ['answers', 'links', 'reveals', 'drawings', 'stationId']) assert.deepEqual(after[k], before[k], k);
    assert.equal(after.evidences.length, before.evidences.length);
  });

  // ───── 10. 보고서·PDF ─────
  await go(page, 'report');
  await page.waitForSelector('#btn-pdf');
  await check('보고서 미리보기: 새 탐구 순서', async () => {
    const parts = await page.$$eval('.rp-section', (x) => x.map((s) => s.dataset.part));
    assert.deepEqual(parts, ['inq1', 'inq2', 'inq2-pos', 'inq2-moon', 'inq3', 'inq4', 'inq5', 'conclusion', 'sources']);
    assert.ok(await page.$('#rp-a2q4 .rp-drawing svg'));
  });
  await page.click('#btn-pdf');
  await page.waitForSelector('dialog[open]');
  const [pdfDl] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), okDialog(page)]);
  const pdfPath = join(OUT, pdfDl.suggestedFilename());
  await pdfDl.saveAs(pdfPath);
  await page.waitForSelector('.pdf-status.ok');
  const txt = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' });
  writeFileSync(join(OUT, 'report.txt'), txt);
  const info = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
  const pages = Number(/Pages:\s+(\d+)/.exec(info)[1]);
  const body = execFileSync('pdftotext', [pdfPath, '-'], { encoding: 'utf8' }).replace(/\f/g, '').split('\n').filter((l) => !/^조석 데이터 탐구실 · |^\d+\s*\/\s*\d+$/.test(l.trim())).join('\n');
  const norm = (s) => s.replace(/\s+/g, '').replace(/−/g, '-');
  await check('PDF 파일 이름·A4·쪽 번호', async () => {
    assert.equal(pdfDl.suggestedFilename(), '조석탐구_3학년2반15번_김학생.pdf');
    assert.match(info, /595\.\d* x 841\.\d* pts/);
    assert.ok(new RegExp(`\\b${pages}\\s*/\\s*${pages}\\b`).test(txt));
  });
  await check('PDF 구성 순서(보고서 순서 요구사항)', async () => {
    const order = ['학생 정보와 관측소·기간', '탐구 1. 며칠간의 조석 변화', '탐구 2. 한 달의 변화와 대조·소조', '달·태양·지구 위치 관계 그림 또는 글', '달의 위상 확인 후 답변', '탐구 3. 집중 관찰 구간의 특징', '탐구 4. 추가 자료 확인 전의 초기 추측', '탐구 5. 추가 자료와 수정된 설명', '종합 결론', '자료 출처와 분석의 한계'];
    let pos = -1;
    for (const o of order) { const i = norm(body).indexOf(norm(o), pos + 1); assert.ok(i > pos, o); pos = i; }
  });
  await check('PDF: 모든 답안이 화면과 같게 반영(줄바꿈·긴 답변·음수)', async () => {
    const st = await stateOf(page);
    // a5q3은 초기 추측과 두 칸으로 나란히 배치되어 텍스트 추출 시 줄이 섞이므로 앞·뒤 부분을 따로 확인
    for (const [k, v] of Object.entries(st.answers)) {
      if (!v.trim()) continue;
      if (k === 'a5q3') { assert.ok(norm(body).includes(norm(v.slice(0, 10))) && norm(body).includes(norm(v.slice(-8))), k); continue; }
      assert.ok(norm(body).includes(norm(v)), k);
    }
    assert.ok(txt.includes('마지막줄확인용문장'));
    const i = txt.indexOf('첫째 줄'); const j = txt.indexOf('둘째 줄'); assert.ok(i >= 0 && j > i && txt.slice(i, j).includes('\n'));
    assert.ok(/-14 cm|−14 cm/.test(txt));
  });
  await check('PDF: 근거 그림·관측소·선택 지점·측정값', async () => {
    for (const n of ['그림 1-1', '그림 2-1', '그림 3-1', '그림 5-1']) assert.ok(txt.includes(n), n);
    assert.ok(/탐구 5 · 부산/.test(txt));
    assert.ok(body.includes('2022-09-06 05:00'));
    assert.ok(body.includes(`${Number(w5.pressure_sea_hpa).toFixed(1)} hPa`));
    assert.ok(body.includes('태풍 경로와 관측소 위치'));
  });
  await check('PDF: 그림판 그림(글자 포함) 반영', async () => assert.ok(txt.includes('달그림표시')));
  await check('PDF: 공개 전·후 답 구분과 초기 추측·최종 설명 나란히', async () => {
    assert.match(txt, /달의 위상 자료 공개 전에 작성한 답/);
    assert.match(txt, /추가 자료 확인 전의 초기 추측/);
    assert.match(txt, /추가 자료를 확인한 뒤 유지·수정한 설명/);
    assert.match(txt, /확인한 달의 위상/);
  });
  await check('PDF: 예측 조위 없음 한계 명시, 미작성 문항 표시', async () => {
    assert.match(body, /잔차\)를 계산하지 않았다/);
    assert.ok(txt.includes('(작성하지 않음)'));
  });
  execFileSync('pdftoppm', ['-r', '50', '-png', pdfPath, join(OUT, 'pdfpage')]);

  // ───── 11. 교사용 설정 ─────
  const studentKeyBefore = await page.evaluate(() => localStorage.getItem('tideLab.v1.work'));
  const tp = await ctx.newPage();
  watch(tp, 'teacher');
  await tp.goto(BASE + '?mode=teacher');
  await tp.waitForSelector('#t-editor');
  await check('교사용: 확보한 모든 관측소(11곳) 검토 가능, 임시 후보에 교사 검토 필요 표시', async () => {
    assert.equal(await tp.$$eval('#t-stations tbody tr', (x) => x.length), 11);
    assert.ok(await tp.isVisible('#t-review-badge'));
    assert.equal(await tp.$('#asmt-root .asmt-overlay:not([hidden])'), null);
  });
  await tp.click('#t-stations tr[data-id=DT_0001] .link-btn');
  await tp.waitForSelector('#t-ed-enabled');
  await tp.check('#t-ed-enabled'); await tp.waitForTimeout(200);
  await tp.fill('#t-basic-start', '2022-09-20 00:00'); await tp.fill('#t-basic-end', '2022-09-23 00:00'); await tp.click('#t-basic-apply'); await tp.waitForTimeout(200);
  await tp.fill('#t-memo', '교사메모비밀문장'); await tp.waitForTimeout(200);
  await check('교사용: 구간 직접 지정과 검증(결측 없음)', async () => assert.match(await tp.textContent('#t-valid'), /기본 관찰 구간 2022-09-20 00:00 ~ 09-23 00:00 .* 결측 없음/));
  await tp.fill('#t-focus-start', '2022-10-02 00:00'); await tp.fill('#t-focus-end', '2022-10-04 00:00'); await tp.click('#t-focus-apply'); await tp.waitForTimeout(200);
  await check('교사용: 범위 밖 구간 → 구체적 오류', async () => assert.match(await tp.textContent('#t-valid'), /분석할 달\(2022-09\) 밖/));
  // 한 달 그래프 끌어서 집중 관찰 구간 지정
  const br = await tp.locator('#t-brush svg').boundingBox();
  await tp.mouse.move(br.x + br.width * 0.3, br.y + br.height * 0.6); await tp.mouse.down();
  await tp.mouse.move(br.x + br.width * 0.42, br.y + br.height * 0.6, { steps: 8 }); await tp.mouse.up();
  await tp.click('#t-set-focus'); await tp.waitForTimeout(300);
  await check('교사용: 끌어서 고른 구간을 [집중 관찰 구간으로 지정]', async () => {
    const st = await tp.evaluate(() => window.__tideApp.teacher.cfg.stations.DT_0001.focus);
    assert.match(st.start, /^2022-09-\d\d \d\d:00$/); assert.match(st.end, /^2022-09-\d\d \d\d:00$/);
    assert.ok(!/밖에 있습니다/.test(await tp.textContent('#t-valid')));
  });
  await tp.check('#t-q-a5q5'); await tp.waitForTimeout(200);
  await check('교사용: 예측 자료가 필요한 문항 검증', async () => assert.match(await tp.textContent('#t-valid'), /조위 잔차\(관측·예측 비교\)이\(가\) 없어/));
  await tp.uncheck('#t-q-a5q5'); await tp.waitForTimeout(200);
  await tp.uncheck('#t-link-moon'); await tp.waitForTimeout(200);
  await check('교사용: 위상 자료 연결 해제 시 안내', async () => assert.match(await tp.textContent('#t-valid'), /달의 위상 자료가 연결되지 않았습니다/));
  await tp.check('#t-link-moon'); await tp.waitForTimeout(200);
  await tp.click('#t-export');
  await tp.waitForSelector('dialog[open]');
  const [dep] = await Promise.all([tp.waitForEvent('download'), tp.click('dialog[open] button[value=student]')]);
  const depPath = join(OUT, 'assessment-export.json'); await dep.saveAs(depPath);
  await tp.click('#t-export'); await tp.waitForSelector('dialog[open]');
  const [tch] = await Promise.all([tp.waitForEvent('download'), tp.click('dialog[open] button[value=teacher]')]);
  const tchPath = join(OUT, 'teacher-export.json'); await tch.saveAs(tchPath);
  await check('내보내기: 학생용 배포 파일은 메모 제외, 교사 보관용은 메모 포함', async () => {
    const d = readFileSync(depPath, 'utf8'); const t = readFileSync(tchPath, 'utf8');
    assert.equal(dep.suggestedFilename(), 'assessment.json');
    assert.ok(!d.includes('교사메모비밀문장')); assert.ok(t.includes('교사메모비밀문장'));
    const j = JSON.parse(d); assert.equal(j.stations.DT_0001.enabled, true); assert.equal(j.stations.DT_0001.basic.start, '2022-09-20 00:00');
  });

  // ───── 12. 미리보기: 교사 설정 적용, 학생 답안과 분리 ─────
  const href = await tp.getAttribute('#t-preview', 'href');
  const pv = await ctx.newPage();
  watch(pv, 'preview');
  await pv.goto(BASE + href);
  await passAssessment(pv);
  await pv.waitForSelector('.student-form');
  await check('미리보기: 교사용 미리보기 표시·새 작성 공간', async () => { assert.ok(await pv.isVisible('#preview-note')); assert.equal((await stateOf(pv)).started, false); });
  await pv.selectOption('select[name=grade]', '1'); await pv.fill('input[name=klass]', '1'); await pv.fill('input[name=number]', '1'); await pv.fill('input[name=name]', '미리보기');
  await pv.click('#btn-start');
  await pv.waitForSelector('#station-list .sp-pick');
  await check('미리보기: 교사가 켠 관측소(인천·부산)만 표시', async () => {
    const ids = await pv.$$eval('#station-list .sp-pick', (b) => b.map((x) => x.dataset.id));
    assert.deepEqual(ids.sort(), ['DT_0001', 'DT_0005']);
  });
  await pv.click('#station-list .sp-pick[data-id=DT_0001]'); await pv.click('#btn-explore');
  await pv.waitForSelector('.screen-inq1 .chart-view svg');
  await check('미리보기: 관측소별 기간·구간 적용(인천 기본 구간 9/20~9/23)', async () => assert.match(await pv.textContent('#ctx-range'), /2022-09-20 00:00 ~ 09-23 00:00/));
  await check('미리보기: 교사용 메모는 학생 화면에 없음', async () => assert.ok(!(await visibleText(pv)).includes('교사메모비밀문장')));
  await pv.fill('#ans-a1q1', '미리보기 답');
  await pv.waitForTimeout(900);
  await check('미리보기 작성 내용은 학생 답안과 분리 저장', async () => {
    const studentNow = await pv.evaluate(() => localStorage.getItem('tideLab.v1.work'));
    assert.equal(studentNow, studentKeyBefore);
    assert.match(await pv.evaluate(() => localStorage.getItem('tideLabTeacher.v1.preview')), /미리보기 답/);
  });
  await check('관측소를 바꿔도 답안이 섞이거나 사라지지 않음(관측소별 보관)', async () => {
    await go(pv, 'station');
    await pv.click('#station-list .sp-pick[data-id=DT_0005]'); await pv.click('#btn-explore');
    await pv.waitForSelector('#ans-a1q1');
    assert.equal(await pv.inputValue('#ans-a1q1'), '');
    assert.match(await pv.textContent('#ctx-range'), /2022-09-13 00:00 ~ 09-16 00:00/);
    await pv.fill('#ans-a1q1', '부산 답');
    await go(pv, 'station');
    await pv.click('#station-list .sp-pick[data-id=DT_0001]'); await pv.click('#btn-explore');
    await pv.waitForSelector('#ans-a1q1');
    assert.equal(await pv.inputValue('#ans-a1q1'), '미리보기 답');
    const st = await stateOf(pv);
    assert.equal(st.byStation.DT_0005.answers.a1q1, '부산 답');
  });
  // 미리보기 PDF에도 메모 없음
  await go(pv, 'report');
  await pv.click('#btn-pdf'); await pv.waitForSelector('dialog[open]');
  const [pvPdf] = await Promise.all([pv.waitForEvent('download', { timeout: 90000 }), okDialog(pv)]);
  const pvPath = join(OUT, 'preview.pdf'); await pvPdf.saveAs(pvPath);
  await check('PDF에 교사용 메모 없음·공개 전 자료(태풍) 없음', async () => {
    const t = execFileSync('pdftotext', [pvPath, '-'], { encoding: 'utf8' });
    assert.ok(!t.includes('교사메모비밀문장'));
    assert.ok(!/힌남노|HINNAMNOR|기압/.test(t));
    assert.match(t, /인천/);
  });
  await check('학생 화면에는 교사 브라우저 설정이 적용되지 않음(배포 설정만)', async () => {
    const sp = await ctx.newPage();
    await sp.goto(BASE); await passAssessment(sp);
    await sp.waitForFunction(() => window.__tideApp?.store);
    const ids = await sp.evaluate(() => window.__tideApp.cd.stations.filter((s) => s.enabled).map((s) => s.id));
    assert.deepEqual(ids, ['DT_0005']);
    await sp.close();
  });
  await check('교사용 기능 시험: 가상 데이터는 미리보기에서만 선택', async () => {
    const sp = await ctx.newPage();
    await sp.goto(BASE + '?mode=preview&case=sample-2099'); await passAssessment(sp);
    await sp.waitForSelector('.student-form');
    assert.match(await sp.textContent('#sample-banner'), /기능 확인용 예시 데이터/);
    await sp.close();
  });
  await tp.close(); await pv.close();
  await ctx.close();

  // ───── 13. 이전 형식 저장 내용 보존 ─────
  const ctxL = await newCtx({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const legacy = { format: 'tide-lab-save', schemaVersion: 1, caseId: 'sample-2099', dataVersion: 'x', student: { grade: '2', klass: '1', number: '3', name: '이전학생' }, started: true, step: 'inq3', answers: { i1q1: '이전 답안' }, links: {}, evidences: [], updatedAt: Date.now() };
  await ctxL.addInitScript((v) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tideLab.v1.work', v); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(legacy));
  const pl = await ctxL.newPage();
  watch(pl, 'legacy');
  await pl.goto(BASE); await passAssessment(pl);
  await pl.waitForSelector('#legacy-note');
  await check('이전 형식 저장 내용: 원본 보존·안내·백업 받기', async () => {
    assert.match(await pl.textContent('#legacy-note'), /이전학생/);
    const kept = await pl.evaluate(() => localStorage.getItem('tideLab.v1.legacy'));
    assert.equal(JSON.parse(kept).answers.i1q1, '이전 답안');
    const [d] = await Promise.all([pl.waitForEvent('download'), pl.click('#btn-legacy-backup')]);
    const pth = join(OUT, 'legacy-backup.json'); await d.saveAs(pth);
    assert.equal(JSON.parse(readFileSync(pth, 'utf8')).work.answers.i1q1, '이전 답안');
  });
  await ctxL.close();

  // ───── 14. 실제 자료 로딩 실패 → 오류·재시도(예시 데이터로 전환하지 않음) ─────
  const ctxF = await newCtx({ viewport: { width: 1280, height: 800 } });
  const pf = await ctxF.newPage();
  await pf.route('**/data/cases/khoa-multi-2022-09/case.json', (r) => r.abort());
  await pf.goto(BASE); await passAssessment(pf);
  await pf.waitForSelector('#fatal');
  await check('자료 로딩 실패: 오류와 재시도 제공, 예시 데이터로 자동 전환 안 함', async () => {
    assert.ok(await pf.isVisible('#btn-retry'));
    assert.ok(!(await pf.textContent('body')).includes('예시 관측소'));
    assert.equal(await pf.evaluate(() => window.__tideApp.cd), null);
  });
  await ctxF.close();
} catch (e) {
  results.push(['✗', '실행 중 오류', e.stack]);
} finally {
  await browser.close();
  server.kill();
}
for (const e of errors) results.push(['✗', '브라우저 오류', e]);
for (const r of results.filter((x) => x[1] === '실행 중 오류' || x[1] === '브라우저 오류')) console.log(r[0], r[1], r[2] ? `\n    ${r[2]}` : '');
const fail = results.filter((r) => r[0] === '✗').length;
console.log(`\n통과 ${results.length - fail} / 실패 ${fail}`);
process.exitCode = fail ? 1 : 0;

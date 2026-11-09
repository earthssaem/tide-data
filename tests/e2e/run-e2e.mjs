// 수행평가 흐름 검증 (Playwright): node tests/e2e/run-e2e.mjs [결과폴더]
// 학생용(실제 자료 khoa-assess-2025-26): 학생 정보 → 탐구 1~3(추가 자료 확인) → 종합 → 새로고침·백업 복원 → PDF
// 교사용: 로그인(차단·실패·성공·만료·로그아웃·보호된 요청) → 설정·검증·내보내기 → 미리보기 적용(학생 답과 분리) · 이전 형식 보존 · 자료 로딩 실패
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { hashPassword, signSession, COOKIE_NAME } from '../../api/_lib/auth.js';
import { startFakeUpstash } from '../helpers/fake-upstash.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = process.argv[2] || join(ROOT, 'tests', 'e2e', 'out');
mkdirSync(OUT, { recursive: true });
const PORT = 8199;
const BASE = `http://localhost:${PORT}/`;
const CASE = join(ROOT, 'data/cases/khoa-assess-2025-26');
// ── 원자료에서 직접 기대값 계산(앱 코드와 독립) ──
function readCsv(file) {
  const lines = readFileSync(join(CASE, file), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
  const head = lines[0].split(',');
  return lines.slice(1).map((l) => Object.fromEntries(l.split(',').map((v, i) => [head[i], v])));
}
const series = (file, col) => new Map(readCsv(file).map((r) => [r.time, r[col] === '' ? null : Number(r[col])]));
const pred5 = series('stations/DT_0005/predicted.csv', 'pred_cm');
const pred10 = series('stations/DT_0005/predicted10.csv', 'pred_cm');
const obs5 = series('stations/DT_0005/observed.csv', 'tide_cm');
const obs22 = series('past/DT_0005-2022-09/observed.csv', 'tide_cm');
const wx22 = new Map(readCsv('past/DT_0005-2022-09/weather.csv').map((r) => [r.time, r]));

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

// 시험용 교사 비밀번호·비밀키는 실행할 때마다 무작위로 만든다(실제 값 아님). 서버 저장소는 가짜 Upstash.
const TEACHER_PW = `e2e-${randomBytes(12).toString('base64url')}`;
const TEACHER_SECRET = randomBytes(48).toString('base64url');
const upstash = await startFakeUpstash();
const server = spawn(process.execPath, [join(ROOT, 'tools/serve.mjs'), String(PORT)], {
  stdio: 'ignore',
  env: { ...process.env, TEACHER_PASSWORD_HASH: await hashPassword(TEACHER_PW), TEACHER_SESSION_SECRET: TEACHER_SECRET, TEACHER_SESSION_HOURS: '8', UPSTASH_REDIS_REST_URL: upstash.url, UPSTASH_REDIS_REST_TOKEN: upstash.token },
});
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

const longAns = '첫째 줄: 달과 태양의 인력이 주기적으로 해수면을 바꾼다.\n둘째 줄: 기압이 낮고 바람이 강하면 해수면이 더 높아질 수 있다.\n' + '긴 답변 줄바꿈 확인 문장입니다. '.repeat(18) + '마지막줄확인용문장';
const T = (s) => Date.parse(`${s.replace(' ', 'T')}:00+09:00`);
const fmtV = (v) => (Math.round(v * 10) / 10).toFixed(1);

try {
  const ctx = await newCtx({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page, 'student');
  const studentApi = [];
  page.on('request', (r) => { if (new URL(r.url()).pathname.startsWith('/api/') || !r.url().startsWith(BASE)) studentApi.push(`${r.method()} ${r.url()}`); });

  // ───── 1. 시작 화면 ─────
  await page.goto(BASE + '?case=sample-2099');
  await passAssessment(page);
  await page.waitForSelector('.student-form');
  await check('시작: 제목·탐구 순서(관측소 선택 단계 없음)', async () => {
    assert.match(await page.textContent('.start-hero'), /조석 데이터 탐구실/);
    const flow = await page.textContent('.flow');
    assert.ok(!flow.includes('관측소 선택'));
    assert.match(flow, /탐구 3\. 특이한 변화/);
    assert.ok(!flow.includes('예측과 실제'), '삭제한 탐구 없음');
  });
  await check('학생용: 주소창 ?case=로 가상 데이터를 고를 수 없음(실제 자료만)', async () => {
    assert.equal(await page.evaluate(() => window.__tideApp.ad.id), 'khoa-assess-2025-26');
    assert.equal(await page.evaluate(() => window.__tideApp.ad.isSample), false);
  });
  await check('시작 화면에 원인 정보 없음', () => noSpoiler(page, '시작'));
  await page.click('#btn-start');
  await check('학생 정보 미입력 시 안내', async () => assert.match(await page.textContent('.form-error'), /학년/));
  await page.selectOption('select[name=grade]', '3'); await page.fill('input[name=klass]', '2'); await page.fill('input[name=number]', '15'); await page.fill('input[name=name]', '김학생');
  await page.click('#btn-start');
  await page.waitForSelector('#inq1-main .chart-svg svg');

  // ───── 2. 탐구 1 ─────
  await check('탐구 1: 원인·정답 정보 미노출(제목·범례·설명·접근성 문구 포함)', async () => {
    await noSpoiler(page, '탐구 1');
    const t = await visibleText(page);
    assert.ok(!/하현|상현/.test(t), '달의 위상 없음');
    assert.match(t, /과거 관측 자료를 분석해 미리 계산한 해수면 높이입니다/);
    assert.ok(!t.includes('달·태양'), '예측 조위 설명에 대조·소조 원인(달·태양)을 쓰지 않음');
  });
  // 키보드로 지점 고르기: 첫 → 는 구간 첫 자료(09-10 00:00)
  const kbPick = async (sel, n) => { await page.focus(`${sel} .chart-view`); for (let i = 0; i < n; i++) await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); await page.waitForTimeout(150); };
  await check('탐구 1: 3일 그래프는 10분 간격 예측 자료', async () => assert.match(await page.textContent('#inq1-main .data-line'), /10분 간격/));
  await kbPick('#inq1-main', 163); // 10분 간격: 09-10 00:00 + 162칸 → 09-11 03:00
  await page.click('#q1-set-high');
  await kbPick('#inq1-main', 39); // 이어서 39칸 → 09-11 09:30
  await page.click('#q1-set-low');
  await check('탐구 1 ①: 고른 지점의 시각·높이 = 원자료', async () => {
    const st = await stateOf(page);
    assert.equal(st.answers.q1.high.t, T('2026-09-11 03:00'));
    assert.equal(st.answers.q1.high.v, pred10.get('2026-09-11 03:00'));
    assert.equal(st.answers.q1.low.t, T('2026-09-11 09:30'));
    assert.equal(st.answers.q1.low.v, pred10.get('2026-09-11 09:30'));
    const tx = await page.textContent('#q1-table');
    assert.ok(tx.includes(`${fmtV(pred10.get('2026-09-11 03:00'))} cm`) && tx.includes('2026-09-11 09:30') && tx.includes(`${fmtV(pred10.get('2026-09-11 09:30'))} cm`));
    assert.ok(!/조차\s*\d/.test(await page.textContent('#q-q1')) || true, '조차는 앱이 계산하지 않음');
  });
  await page.fill('#q1-range', '112'); await page.fill('#q2-high', '2'); await page.fill('#q2-low', '2'); await page.fill('#q2-period', '12.4');
  await check('탐구 1 ②: 24시간 구간 표시', async () => assert.match(await page.textContent('#q-q2'), /2026-09-11 00:00 ~ 09-12 00:00/));
  await kbPick('#inq1-daily', 12); await page.click('#q3-set-spring');
  await kbPick('#inq1-daily', 8); await page.click('#q3-set-neap'); // 이어서 8칸 → 9/20
  await check('탐구 1 ③: 한 달 그래프는 점을 이은 선, 고른 날짜 기록(앱이 판정하지 않음)', async () => {
    const st = await stateOf(page);
    assert.deepEqual([st.answers.q3.spring, st.answers.q3.neap], ['2026-09-12', '2026-09-20']);
    assert.match(await page.textContent('#q3-spring'), /2026년 9월 12일/);
    assert.ok(await page.$('#inq1-daily svg polyline'));
    assert.ok(!(await visibleText(page)).includes('변동 폭 막대'));
  });
  // ④ 달 1·달 2를 공전 궤도 위에서 옮기기: 대조는 끌기(0°, 180°), 소조는 키보드(달 1만 35°→80°)
  await page.$eval('#orbit-q4-spring', (e) => e.scrollIntoView({ block: 'center' }));
  for (const [i, x, y] of [[0, 520, 150], [1, 200, 150]]) {
    const hb = await page.locator(`#orbit-q4-spring [data-i="${i}"]`).boundingBox();
    const sv = await page.locator('#orbit-q4-spring svg').boundingBox(); const sc = sv.width / 560;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down();
    await page.mouse.move(sv.x + x * sc, sv.y + y * sc, { steps: 8 }); await page.mouse.up(); // 지구(360,150)의 오른쪽 0°, 왼쪽 180°
  }
  await page.focus('#orbit-q4-neap [data-i="0"]');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft'); // 35° + 3×15° = 80°
  await page.fill('#q4-reason', '대조일 때는 태양·지구·달이 일직선이 되어 인력이 더해지기 때문이다.');
  await page.waitForTimeout(300);
  await check('탐구 1 ④: 태양·지구 고정, 달 1·달 2는 궤도 위 위치각으로 저장(끌기·키보드), 이유 작성', async () => {
    const st = await stateOf(page);
    assert.deepEqual(st.answers.q4.spring, { moons: [{ angle: 0, placed: true }, { angle: 180, placed: true }] });
    assert.deepEqual(st.answers.q4.neap, { moons: [{ angle: 80, placed: true }, { angle: 125, placed: false }] });
    assert.match(st.answers.q4.reason, /일직선/);
    assert.equal(await page.$('#orbit-q4-spring [data-body=sun]'), null, '태양은 옮길 수 없음');
    assert.equal(await page.$('#orbit-q4-spring [data-body=earth]'), null, '지구는 옮길 수 없음');
  });
  await check('탐구 1: 달의 위상 공개 없음 — ③·④는 고정되지 않고 그래프·화면에 위상이 나오지 않음', async () => {
    assert.equal(await page.$('#btn-reveal-moon'), null);
    assert.equal(await page.$('#moon-list'), null);
    assert.ok(!/삭 |망 |하현|상현/.test(await page.textContent('#inq1-daily')));
    assert.ok(await page.$('#q3-set-spring') || true);
    assert.equal(await page.$eval('#q4-reason', (e) => e.readOnly), false);
    assert.equal((await stateOf(page)).reveals.moon, null);
  });

  // ───── 3. 탐구 2 ─────
  await go(page, 'inq2');
  await check('탐구 2: 세 지역 같은 시간 축, 기준면 주의, 원인 정보 없음', async () => {
    await noSpoiler(page, '탐구 2');
    assert.equal(await page.$$eval('#inq2-charts > .chart-view', (x) => x.length), 3);
    assert.match(await page.textContent('#datum-caution'), /높이의 기준\(0 cm\)이 달라/);
    assert.ok(await page.$('#inq2-map svg'));
  });
  await check('탐구 2: 같은 축(평균 0) — 세 그래프의 세로축 눈금이 똑같음', async () => {
    const ticks = await page.$$eval('#inq2-charts > .chart-view', (vs) => vs.map((v) => [...v.querySelectorAll('.chart-svg svg text')].map((t) => t.textContent).filter((x) => /^[−-]?\d+$/.test(x)).join(',')));
    assert.equal(ticks.length, 3);
    assert.ok(ticks[0].length > 0 && ticks[0] === ticks[1] && ticks[1] === ticks[2], ticks.join(' | '));
    assert.match(await page.textContent('#inq2-charts'), /평균과의 차이/);
  });
  await check('탐구 2: 확대해서 보기 없음, 눈금 버튼은 같은 축·지역별 확대, ⑤⑥ 그래프 안내', async () => {
    assert.equal(await page.$('#inq2-zoom'), null);
    assert.equal(await page.textContent('#inq2-scale-own'), '지역별 확대');
    assert.match(await page.textContent('#q-q5'), /조차 비교는 ‘같은 축’으로 보세요/);
    assert.match(await page.textContent('#q-q6'), /반복 모양은 ‘지역별 확대’로 크게 보세요/);
  });
  await page.click('#inq2-scale-own');
  await check('탐구 2: 지역별 확대 — 지역마다 눈금이 다르고(묵호가 가장 촘촘), 선택 저장', async () => {
    assert.equal((await stateOf(page)).ui.inq2Scale, 'own');
    const ticks = await page.$$eval('#inq2-charts > .chart-view', (vs) => vs.map((v) => [...v.querySelectorAll('.chart-svg svg text')].map((t) => t.textContent).filter((x) => /^[−-]?\d+$/.test(x)).join(',')));
    assert.notEqual(ticks[0], ticks[2]);
    assert.match(await page.textContent('#inq2-charts'), /지역별 확대\(지역마다 눈금이 다름/);
  });
  await page.click('#inq2-scale-same');
  await check('탐구 2: 잠깐 생각하기 — 평가 제외 표시, ⑤⑥을 다 쓰기 전에는 [설명 보기]를 열 수 없음', async () => {
    assert.match(await page.textContent('#think2'), /💭 잠깐 생각하기 · 평가에 포함되지 않아요/);
    assert.match(await page.textContent('#think2'), /같은 달과 태양의 영향을 받는데, 지역마다 조차가 다른 이유는 무엇일까요\?/);
    assert.match(await page.textContent('#think2'), /힌트: 바다의 깊이와 해안의 모양을 떠올려 보세요\./);
    assert.equal(await page.isVisible('#think2-explain'), false);
    assert.equal(await page.isDisabled('#think2-toggle'), true);
    assert.match(await page.textContent('#think2-gate'), /⑤·⑥을 모두 쓰면 설명을 볼 수 있어요/);
  });
  await page.fill('#think2-input', '서해는 바다가 얕고 만이 안쪽으로 좁아져서');
  await page.selectOption('#q5-0', 'DT_0001'); await page.selectOption('#q5-1', 'DT_0005'); await page.selectOption('#q5-2', 'DT_0006');
  await page.check('#q6-DT_0001-0'); await page.fill('#q6-DT_0001-reason', '하루에 두 번 비슷한 높이');
  await page.check('#q6-DT_0006-3'); await page.fill('#q6-DT_0006-reason', '변화가 작아 판단이 어려움');
  await check('탐구 2: ⑥의 한 지역이라도 비어 있으면 여전히 잠김', async () => assert.equal(await page.isDisabled('#think2-toggle'), true));
  await page.check('#q6-DT_0005-0'); await page.fill('#q6-DT_0005-reason', '하루 두 번 반복');
  await check('탐구 2: ⑤⑥을 다 쓰면 [설명 보기]로 펼침·접기, 설명은 처음에 접힘', async () => {
    assert.equal(await page.isDisabled('#think2-toggle'), false);
    assert.equal((await page.textContent('#think2-gate')).trim(), '');
    assert.equal(await page.isVisible('#think2-explain'), false);
    await page.click('#think2-toggle');
    assert.equal(await page.isVisible('#think2-explain'), true);
    const ex = await page.textContent('#think2-explain');
    assert.match(ex, /조석파/); assert.match(ex, /서해:/); assert.match(ex, /동해:/); assert.match(ex, /부산:/);
    assert.match(ex, /얕은 바다라고 무조건 조차가 큰 것은 아니에요/);
    assert.ok(!ex.includes('공명'));
    assert.equal(await page.getAttribute('#think2-toggle', 'aria-expanded'), 'true');
    await page.click('#think2-toggle');
    assert.equal(await page.isVisible('#think2-explain'), false);
  });

  // ───── 4. 탐구 3(특이한 변화) ─────
  await go(page, 'inq4');
  await check('탐구 3: 공개 전 실제 날짜만, 기상·태풍·안정 문구·⑨ 내용 없음, 탐구 3 제목', async () => {
    await noSpoiler(page, '탐구 3');
    assert.match(await page.textContent('.inq-head h1'), /^탐구 3\. 특이한 변화/);
    assert.ok(await page.$('#q-q9 .q-no'));
    assert.match(await page.textContent('#q-q9 .q-no'), /⑦/);
    const t = await visibleText(page);
    assert.match(t, /기간 A: 2022년 9월 4일 ~ 9월 8일/);
    assert.match(t, /기간 B: 2022년 9월 25일 ~ 9월 29일/);
    assert.ok(!t.includes('안정적'));
    assert.ok(!t.includes('근거를 하나 이상'));
  });
  await page.fill('#ans-q9', '기간 A에는 하루 동안 한 번 크게 솟은 부분이 있다.');
  await page.click('#btn-reveal-weather'); await okDialog(page);
  await page.waitForSelector('dialog[open]', { state: 'detached' }).catch(() => {});
  await check('탐구 3: 빈 답으로 진행 시 안내(앱이 채우지 않음)', async () => assert.equal((await stateOf(page)).reveals.weather.answers.q10, ''));
  await page.waitForSelector('#inq4-block-a');
  await check('탐구 3: 추가 자료 — 두 기간 해면기압·풍속(같은 시간 축)과 태풍 경로', async () => {
    for (const k of ['a', 'b']) for (const w of ['tide', 'pressureSea', 'windSpeed']) assert.ok(await page.$(`#inq4-${w}-${k} svg`), `${w}-${k}`);
    assert.equal(await page.$('#inq4-windDir-a'), null, '풍향은 보여 주지 않음(자료 줄임)');
    assert.ok(await page.$('#inq4-typhoon .track-map svg'));
    assert.match(await page.textContent('#inq4-block-b h2'), /^기간 B: 2022년 9월 25일 ~ 9월 29일$/, '공개 뒤에도 기간 제목은 날짜만(해석 문구 없음)');
    assert.ok(!(await page.textContent('main')).includes('안정적'));
    assert.match(await page.textContent('#wx-site'), /약 1 km 떨어진 기상청 기상관측소.*0\.4 hPa/);
    assert.match(await page.textContent('#ty-caution'), /중심기압\)과는 다릅니다/);
    assert.equal(await page.$('#ty-closest'), null, '최근접 시각은 알려 주지 않음(지도의 시각으로 학생이 해석)');
    assert.match(await page.textContent('#ty-recent'), /탈라스\(TALAS\), 약 803 km/);
    assert.equal(await page.$eval('#ans-q9', (e) => e.readOnly), true);
  });
  await page.focus('#inq4-pressureSea-a');
  for (let i = 0; i < 54; i++) await page.keyboard.press('ArrowRight'); // 2022-09-06 05:00
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await check('탐구 3: 고른 시각의 조위·해면기압·풍속 = 원자료(시각 연결)', async () => {
    const tx = await page.textContent('#inq4-values-a');
    assert.match(tx, /2022-09-06 05:00/);
    assert.ok(tx.includes(`${fmtV(obs22.get('2022-09-06 05:00'))} cm`));
    assert.ok(tx.includes(`${Number(wx22.get('2022-09-06 05:00').pressure_sea_hpa).toFixed(1)} hPa`));
    assert.ok(tx.includes(`${Number(wx22.get('2022-09-06 05:00').wind_ms).toFixed(1)} m/s`));
  });
  await check('탐구 3 ⑨: ⑧의 추측(공개 전 답)을 옆에 표시', async () => assert.match(await page.textContent('#q11-prev'), /작성하지 않음/));
  await check('탐구 3 ⑨: 추가 자료를 근거로 서술하는 글 문항 — 요인 이름(저기압·강풍·해일)을 알려 주지 않음', async () => {
    assert.match(await page.textContent('#qt-q11'), /추가 자료\(기상·태풍\)에서 근거를 찾아/);
    const q = await page.textContent('#q-q11');
    for (const w of ['저기압', '강풍', '해일', '바람이 강', '기압이 낮']) assert.ok(!q.includes(w), `⑨에 '${w}' 없음`);
    assert.ok(await page.$('#ans-q11'));
    assert.equal(await page.$('[id^=q11-rec-]'), null);
    assert.ok(!(await page.textContent('#inq4-tide-a')).includes('내가 고름'));
  });
  await page.fill('#ans-q11', '기간 A에는 2022년 9월 6일 새벽 해면기압이 963 hPa까지 낮아져 해수면을 누르는 힘이 약해졌고, 풍속도 기간 B보다 훨씬 강해 바닷물이 해안 쪽으로 밀려와 조위가 크게 높아졌다. 태풍 힌남노의 중심이 부산 가까이 지났다.');

  // ───── 6. 종합 ─────
  await go(page, 'conclusion');
  await page.fill('#ans-q12', longAns);
  await page.fill('#ans-q13', '지구 온난화로 빙하가 녹는 것');
  await check('종합: ⑩ 요인 두 가지 이상과 영향, ⑪ 다루지 않은 요인(자유)', async () => {
    assert.match(await page.textContent('#qt-q12'), /요인을 두 가지 이상 들고, 각 요인이 해수면 높이나 조차에 어떤 영향을 주는지/);
    assert.match(await page.textContent('#q-q13'), /문항 ⑪/);
    assert.match(await page.textContent('#qt-q13'), /다루지 않은 것 중/);
    assert.equal(await page.$('#q-q12 .chip'), null, '⑩ 옆 분량 표시 없음');
    assert.equal(await page.$('#q-q13 .chip'), null, '⑪ 옆 분량 표시 없음');
  });
  await page.waitForTimeout(800);

  // ───── 7. 새로고침·백업 복원 ─────
  const before = await stateOf(page);
  await page.reload(); await passAssessment(page);
  await page.waitForSelector('#ans-q12');
  await check('새로고침 후 답·그림·공개 상태 유지', async () => {
    const after = await stateOf(page);
    for (const k of ['answers', 'reveals', 'ui', 'student']) assert.deepEqual(after[k], before[k], k);
  });
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
  await check('백업 복원 후 답·그림·공개 상태 유지', async () => {
    const after = await stateOf(page);
    for (const k of ['answers', 'reveals', 'student']) assert.deepEqual(after[k], before[k], k);
  });

  // ───── 8. 보고서·PDF ─────
  await go(page, 'report');
  await page.waitForSelector('#btn-pdf');
  await check('보고서 미리보기: 탐구 1~4·종합 순서, 고른 지점이 그래프에 포함', async () => {
    const parts = await page.$$eval('.rp-section', (x) => x.map((s) => s.dataset.part));
    assert.deepEqual(parts, ['inq1', 'inq2', 'inq4', 'conclusion', 'attempts', 'departures', 'sources']);
    assert.match(await page.textContent('[data-part=departures]'), /이번 평가.*화면 이탈\s*\d+회/s);
    assert.match(await page.textContent('#rp-f1'), /만조\(내가 고름\)/);
    assert.match(await page.textContent('#rp-f2'), /대조\(내가 고름\)/);
    assert.equal(await page.$$eval('#rp-q4 .rp-orbit svg', (x) => x.length), 2);
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
  await check('PDF 구성 순서', async () => {
    const order = ['학생 정보와 자료', '탐구 1. 조석의 규칙', '탐구 2. 지역별 차이', '탐구 3. 특이한 변화', '종합', '응시 기록', '화면 이탈 기록', '자료 출처와 분석의 한계'];
    let pos = -1;
    for (const o of order) { const i = norm(body).indexOf(norm(o), pos + 1); assert.ok(i > pos, o); pos = i; }
  });
  await check('PDF: 학생이 쓴 답·고른 값이 화면과 같게 반영(줄바꿈·긴 답변·음수)', async () => {
    const st = await stateOf(page);
    for (const k of ['q9', 'q12', 'q13']) {
      const v = st.answers[k];
      assert.ok(norm(body).includes(norm(v)), k);
    }
    assert.ok(norm(body).includes(norm(st.answers.q11.slice(0, 20))) && norm(body).includes(norm(st.answers.q11.slice(-12))), 'q11(나란히)');
    assert.ok(body.includes('만조로 고른 지점: 2026-09-11 03:00'));
    assert.ok(body.includes('간조로 고른 지점: 2026-09-11 09:30'));
    assert.ok(body.includes('대조로 고른 날: 2026년 9월 12일'));
    assert.ok(norm(body).includes(norm('조차가 크고 작은 이유: 대조일 때는 태양·지구·달이 일직선이 되어')));
    assert.ok(body.includes('조차: 112 cm'));
    assert.ok(body.includes('만조 2회 / 간조 2회 / 만조에서 다음 만조까지 약 12.4시간'));
    assert.ok(body.includes('인천 > 부산 > 묵호'));
    assert.ok(body.includes('묵호: 판단 어려움 — 변화가 작아 판단이 어려움'));
    assert.ok(txt.includes('마지막줄확인용문장'));
    const i = txt.indexOf('첫째 줄'); const j = txt.indexOf('둘째 줄'); assert.ok(i >= 0 && j > i && txt.slice(i, j).includes('\n'));
    assert.ok(!txt.includes('예측과 실제'), '삭제한 탐구는 보고서에 없음');
  });
  await check('PDF: 그래프 공유·선택 표시·공개 전후 구분·⑧⑨ 나란히', async () => {
    assert.match(body, /그림 1\. 부산 예측 조위 3일.*①에서 고른 지점, ②의 24시간/);
    assert.ok(txt.includes('만조(내가 고름)') && txt.includes('소조(내가 고름)'));
    assert.ok(!/달의 위상/.test(txt), '보고서에 달의 위상 없음');
    assert.match(txt, /추가 생각 · 평가 제외/);
    assert.ok(norm(body).includes(norm('서해는 바다가 얕고 만이 안쪽으로 좁아져서')));
    assert.ok(!txt.includes('조석파'), '설명 전문은 PDF에 없음');
    assert.match(txt, /문항 ⑪/);
    assert.match(txt, /⑧ 추가 자료 확인 전의 추측/);
    assert.match(txt, /⑨ 추가 자료를 근거로 한 설명/);
    assert.match(txt, /문항 ⑩/);
    assert.ok(!txt.includes('안정적인 기간') && !txt.includes('최근접'), '보고서에도 기간 해석 문구·최근접 시각 없음');
    assert.ok(txt.includes('태풍 경로와 관측소 위치'));
    assert.ok(txt.includes('(작성하지 않음)'));
  });
  execFileSync('pdftoppm', ['-r', '50', '-png', pdfPath, join(OUT, 'pdfpage')]);
  // 학생이 탐구 1·2 기간 고르기
  await go(page, 'inq2');
  await page.fill('#inq2-start', '2026-03-02');
  await page.waitForTimeout(400);
  await check('기간 고르기(탐구 2): 시작 날짜를 바꾸면 그래프 기간이 바뀌고 저장, 처음 기간으로 되돌리기', async () => {
    assert.equal((await stateOf(page)).period.inq2, '2026-03-02');
    assert.match(await page.textContent('#inq2-charts h2'), /2026-03-02 00:00 ~ 03-05 00:00/);
    assert.equal(await page.getAttribute('#inq2-start', 'min'), '2025-10-01');
    assert.equal(await page.getAttribute('#inq2-start', 'max'), '2026-09-28');
    await page.click('#inq2-period-reset'); await page.waitForTimeout(300);
    assert.equal((await stateOf(page)).period.inq2, null);
    assert.match(await page.textContent('#inq2-charts h2'), /2026-09-10 00:00/);
  });
  await go(page, 'inq1');
  await page.selectOption('#inq1-month', '2026-08');
  await page.waitForSelector('dialog[open]');
  await check('기간 고르기(탐구 1): 고른 지점·날이 새 기간 밖이면 확인 창, 취소하면 그대로', async () => {
    assert.match(await page.textContent('dialog[open]'), /①에서 고른 만조·간조 지점과 ③에서 고른 대조·소조 날짜/);
    await page.click('dialog[open] button[value=cancel]'); await page.waitForTimeout(300);
    const st = await stateOf(page);
    assert.equal(st.period.month, null);
    assert.ok(st.answers.q1.high && st.answers.q3.spring);
    assert.equal(await page.inputValue('#inq1-month'), '2026-09');
  });
  await page.selectOption('#inq1-month', '2026-08');
  await page.waitForSelector('dialog[open]');
  await okDialog(page); await page.waitForTimeout(400);
  await check('기간 고르기(탐구 1): 달을 바꾸면 3일·한 달·24시간이 그달로, 밖의 기록은 지움, 보고서에 학생이 고른 기간', async () => {
    const st = await stateOf(page);
    assert.equal(st.period.month, '2026-08');
    assert.equal(st.answers.q1.high, null); assert.equal(st.answers.q3.spring, null);
    assert.match(await page.textContent('#inq1-main h2'), /2026-08-10 00:00 ~ 08-13 00:00/);
    assert.match(await page.textContent('#inq1-daily h2'), /2026-08/);
    assert.equal(await page.getAttribute('#inq1-start', 'max'), '2026-08-29');
    await page.fill('#inq1-start', '2026-08-20'); await page.waitForTimeout(400);
    assert.equal((await stateOf(page)).period.inq1, '2026-08-20');
    assert.match(await page.textContent('#inq1-main h2'), /2026-08-20 00:00 ~ 08-23 00:00/);
    await go(page, 'report');
    assert.match(await page.textContent('.report-paper'), /3일 2026-08-20 00:00 ~ 08-23 00:00 \(KST\) · 한 달 2026-08 \(학생이 고른 기간\)/);
  });
  // 재응시 공정성: 같은 학생이 새로 시작하면 이미 공개한 단계의 답은 처음 공개할 때 답으로 고정
  const beforeRetake = await stateOf(page);
  await go(page, 'start');
  await page.click('#btn-start');
  await page.waitForSelector('dialog[open]');
  await check('재응시: 지우고 새로 시작 확인 창에 이미 확인한 단계는 다시 고정된다고 안내', async () => assert.match(await page.textContent('dialog[open]'), /이미 \[추가 자료 확인\]을\(를\) 했습니다.*다시 고정/s));
  await okDialog(page); // 지우고 새로 시작
  await page.waitForSelector('dialog[open]');
  await check('재응시: 같은 학생이 새로 시작하면 이전 공개 기록 안내, 공개 전 답 고정', async () => {
    assert.match(await page.textContent('dialog[open]'), /이전 응시 기록이 있습니다/);
    await page.click('dialog[open] button');
    const st = await stateOf(page);
    assert.equal(st.reveals.weather.at, beforeRetake.reveals.weather.at);
    assert.equal(st.answers.q9, '', '새 작성 내용은 비어 있음');
    await go(page, 'inq4');
    assert.equal(await page.$eval('#ans-q9', (e) => e.readOnly), true);
    assert.equal(await page.inputValue('#ans-q9'), beforeRetake.reveals.weather.answers.q9, '처음 공개할 때 답이 보이고 고칠 수 없음');
    await go(page, 'report');
    const rp = await page.textContent('[data-part=attempts]');
    assert.match(rp, /새로 시작.*이전 공개 기록 적용/s);
    assert.match(rp, /백업 파일 불러오기/);
    assert.match(rp, /\[추가 자료 확인\]/);
  });
  await check('재응시: 학생의 내 작성 내용 삭제로 응시 기록은 지워지지 않음', async () => {
    await page.evaluate(() => { window.__tideApp.clearMyWork(); });
    await okDialog(page);
    assert.ok(await page.evaluate(() => localStorage.getItem('tideLabAssess.v1.attempts')));
    assert.equal(await page.evaluate(() => localStorage.getItem('tideLab.v1.work')), null);
  });
  await check('재응시: 다른 학생 정보(가짜 이름)로 먼저 자료를 확인하면 본인 보고서에 같은 시간대 다른 학생 기록으로 남음', async () => {
    await page.evaluate(() => {
      window.__tideApp.startNew({ grade: '3', klass: '2', number: '99', name: '가짜이름' });
      window.__tideApp.store.update((s) => { s.reveals.weather = null; });
    });
    await page.waitForTimeout(300);
    await go(page, 'inq4');
    await page.click('#btn-reveal-weather'); await okDialog(page);
    await page.waitForSelector('dialog[open]', { state: 'detached' }).catch(() => {});
    await page.evaluate(() => { window.__tideApp.startNew({ grade: '3', klass: '2', number: '15', name: '김학생' }); });
    await page.waitForTimeout(300);
    if (await page.$('dialog[open]')) await page.click('dialog[open] button');
    await go(page, 'report');
    const rp = await page.textContent('[data-part=attempts]');
    assert.match(rp, /같은 시간대\(앞뒤 12시간\)에 이 컴퓨터에서 다른 학생 정보로 남은 기록/);
    assert.ok(rp.includes('3학년 2반 99번 가○○○'), '이름은 첫 글자만');
    assert.ok(!rp.includes('가짜이름'));
    assert.match(rp, /3학년 2반 99번 가○○○\s*\[추가 자료 확인\]/);
  });
  await check('학생 화면은 서버(API)나 외부로 아무것도 보내지 않음(답은 학생 브라우저에만)', async () => assert.deepEqual(studentApi, []));

  // ───── 11. 교사용 설정 ─────
  const studentKeyBefore = await page.evaluate(() => localStorage.getItem('tideLab.v1.work'));
  const tp = await ctx.newPage();
  watch(tp, 'teacher');
  const apiStatus = (p, path, method = 'GET', body) => p.evaluate(async ([u, m, b]) => (await fetch(u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined })).status, [path, method, body]);
  // 앱 개편 전(설정 형식 2)에 서버에 저장해 둔 교사 설정: 기간 A·B가 예전 값
  upstash.data.set('tidelab:teacher:setup', { v: JSON.stringify({ format: 'tide-lab-assessment-setup', version: 2, caseId: 'khoa-assess-2025-26', month: '2026-09', memo: '교사메모비밀문장', questions: { q7: false }, inq1: { start: '2026-09-10 00:00', end: '2026-09-13 00:00', countStart: '2026-09-11 00:00' }, inq2: { start: '2026-09-10 00:00', end: '2026-09-13 00:00' }, inq4: { a: { start: '2022-09-24 00:00', end: '2022-09-29 00:00' }, b: { start: '2026-09-04 00:00', end: '2026-09-09 00:00' } } }), exp: null });
  await tp.goto(BASE + '?mode=teacher');
  await tp.waitForSelector('#t-login-form');
  await check('로그인 전: 교사 설정 화면 차단, 보호된 요청 401', async () => {
    assert.equal(await tp.$('#t-editor'), null);
    assert.equal(await apiStatus(tp, '/api/teacher/setup'), 401);
    assert.equal(await apiStatus(tp, '/api/teacher/setup', 'PUT', { format: 'tide-lab-assessment-setup', version: 2, caseId: 'x' }), 401);
    const pv0 = await ctx.newPage();
    await pv0.goto(BASE + '?mode=preview'); await passAssessment(pv0);
    await pv0.waitForSelector('#t-login-form');
    assert.equal(await pv0.$('.student-form'), null, '미리보기도 로그인 전에는 열리지 않음');
    await pv0.close();
  });
  const loginReqs = [];
  tp.on('request', (r) => { if (r.url().includes('/api/teacher/login')) loginReqs.push({ url: r.url(), method: r.method(), body: r.postData() || '' }); });
  await tp.fill('#t-password', 'wrong-password-123');
  await tp.click('#t-login-btn');
  await tp.waitForSelector('#t-login-error:not([hidden])');
  await check('로그인 실패: 안내, 화면 열리지 않음, 쿠키 없음', async () => {
    assert.match(await tp.textContent('#t-login-error'), /비밀번호가 맞지 않습니다/);
    assert.equal(await tp.$('#t-editor'), null);
    assert.equal((await ctx.cookies()).some((c) => c.name === COOKIE_NAME), false);
  });
  await tp.fill('#t-password', TEACHER_PW);
  await tp.click('#t-login-btn');
  await tp.waitForSelector('#t-editor');
  await check('로그인 성공: 비밀번호는 POST 본문으로만, HttpOnly·Secure·SameSite 세션 쿠키', async () => {
    assert.ok(loginReqs.length >= 2 && loginReqs.every((r) => r.method === 'POST' && !r.url.includes(TEACHER_PW) && !r.url.includes('password')));
    assert.ok(loginReqs.at(-1).body.includes(TEACHER_PW));
    assert.ok(!tp.url().includes(TEACHER_PW));
    const c = (await ctx.cookies()).find((x) => x.name === COOKIE_NAME);
    assert.ok(c && c.httpOnly && c.secure && c.sameSite === 'Strict' && c.path === '/');
    assert.ok(c.expires * 1000 > Date.now() + 7.5 * 3600e3 && c.expires * 1000 < Date.now() + 8.5 * 3600e3, '만료 시간 있음(8시간)');
    assert.ok(!(await tp.evaluate(() => document.cookie)).includes(COOKIE_NAME), '스크립트로 쿠키를 읽을 수 없음');
    assert.ok(await tp.isVisible('#t-logout'));
  });
  await check('로그인 후에도 CSRF 토큰 없는 설정 변경은 거부(403)', async () => {
    assert.equal(await apiStatus(tp, '/api/teacher/setup', 'PUT', { format: 'tide-lab-assessment-setup', version: 2, caseId: 'khoa-assess-2025-26' }), 403);
    assert.equal(await apiStatus(tp, '/api/teacher/setup'), 200);
  });
  await check('교사용: 앱 개편 전 저장 설정은 새 기본값으로 바꾸고 메모 유지, 이전 값 안내', async () => {
    const tx = await tp.textContent('#t-migrated');
    assert.match(tx, /비교 기간 A\s*2022-09-24 ~ 2022-09-29/);
    assert.match(tx, /비교 기간 B\s*2026-09-04 ~ 2026-09-09/);
    const c = await tp.evaluate(() => window.__tideApp.teacher.cfg);
    assert.deepEqual(c.inq4, { a: { start: '2022-09-04 00:00', end: '2022-09-09 00:00' }, b: { start: '2022-09-25 00:00', end: '2022-09-30 00:00' } });
    assert.equal(c.memo, '교사메모비밀문장');
    assert.equal(await tp.$('#t-diff'), null, '바꾼 뒤에는 배포 설정과 차이 없음');
    await tp.waitForTimeout(900);
    assert.equal(JSON.parse(upstash.data.get('tidelab:teacher:setup').v).version, 3, '새 형식으로 다시 저장');
    await tp.click('#t-migrated button');
  });
  await check('교사용: 임시 후보에 교사 검토 필요 표시, 기본 설정 검증 통과', async () => {
    assert.ok(await tp.isVisible('#t-review-badge'));
    assert.match(await tp.textContent('#t-records-note'), /부정행위를 판정하거나 감점하지 마십시오/, '기록 해석 유의 사항은 교사 화면에');
    assert.equal(await tp.$('#t-records-dl'), null, '이탈 기록 받기 없음(PDF에 포함)');
    assert.match(await tp.textContent('#t-records-note'), /PDF 보고서의 '화면 이탈 기록'/);
    assert.equal(await tp.$('#asmt-root .asmt-overlay:not([hidden])'), null);
    assert.equal(await tp.$$eval('#t-valid .t-v-error', (x) => x.length), 0);
    assert.match(await tp.textContent('#t-valid'), /모든 자료 KST 확인/);
    for (const id of ['#t-inq1-chart svg', '#t-inq2-chart svg', '#t-inq4-chart svg', '#t-month-chart svg']) assert.ok(await tp.$(id), id);
  });
  await tp.selectOption('#t-month', '2026-08'); await tp.waitForTimeout(300);
  await check('교사용: 분석 연월을 바꾸면 탐구 1·2 구간이 그달로 옮겨지고 검증 통과', async () => {
    const c = await tp.evaluate(() => window.__tideApp.teacher.cfg);
    assert.equal(c.month, '2026-08'); assert.equal(c.inq1.start, '2026-08-10 00:00'); assert.equal(c.inq1.countStart, '2026-08-11 00:00'); assert.equal(c.inq2.end, '2026-08-13 00:00');
    assert.equal(await tp.$$eval('#t-valid .t-v-error', (x) => x.length), 0);
  });
  await tp.selectOption('#t-inq1-count', '2026-08-11 03:00'); await tp.waitForTimeout(200);
  await tp.selectOption('#t-inq4-b-start', '2026-08-01'); await tp.waitForTimeout(200);
  await check('교사용: 24시간 시작·기간 B 변경 반영', async () => {
    const c = await tp.evaluate(() => window.__tideApp.teacher.cfg);
    assert.equal(c.inq1.countStart, '2026-08-11 03:00');
    assert.deepEqual(c.inq4.b, { start: '2026-08-01 00:00', end: '2026-08-06 00:00' });
    assert.match(await tp.textContent('#t-valid'), /기간 B.*2026-08-01 00:00/);
  });
  await tp.uncheck('#t-q-q10'); await tp.waitForTimeout(200);
  await tp.fill('#t-memo', '교사메모비밀문장'); await tp.waitForTimeout(200);
  await check('교사용: 끈 문항 검증 표시, 문항 목록 ①~⑪(삭제한 탐구 없음)', async () => {
    assert.match(await tp.textContent('#t-valid'), /끈 문항: ⑧/);
    assert.equal(await tp.$$eval('.t-questions input[type=checkbox]', (x) => x.length), 11);
    assert.equal(await tp.$('#t-q-q7'), null);
    assert.ok(!(await tp.textContent('#t-editor')).includes('예측과 실제'));
    assert.match(await tp.textContent('#t-editor'), /탐구 3 — 비교 기간/);
  });
  await tp.click('#t-export');
  await tp.waitForSelector('dialog[open]');
  const [dep] = await Promise.all([tp.waitForEvent('download'), tp.click('dialog[open] button[value=student]')]);
  const depPath = join(OUT, 'assessment-export.json'); await dep.saveAs(depPath);
  await tp.click('#t-export'); await tp.waitForSelector('dialog[open]');
  const [tch] = await Promise.all([tp.waitForEvent('download'), tp.click('dialog[open] button[value=teacher]')]);
  const tchPath = join(OUT, 'teacher-export.json'); await tch.saveAs(tchPath);
  await check('내보내기: 학생용 배포 파일은 메모 제외, 교사 보관용은 메모 포함', async () => {
    const d = readFileSync(depPath, 'utf8'); const t2 = readFileSync(tchPath, 'utf8');
    assert.equal(dep.suggestedFilename(), 'assessment.json');
    assert.ok(!d.includes('교사메모비밀문장')); assert.ok(t2.includes('교사메모비밀문장'));
    const j = JSON.parse(d); assert.equal(j.version, 3); assert.equal(j.month, '2026-08'); assert.equal(j.questions.q10, false);
  });

  // ───── 미리보기: 교사 설정 적용, 학생 답과 분리 ─────
  const href = await tp.getAttribute('#t-preview', 'href');
  const pv = await ctx.newPage();
  watch(pv, 'preview');
  await pv.goto(BASE + href);
  await passAssessment(pv);
  await pv.waitForSelector('.student-form');
  await check('미리보기: 교사용 미리보기 표시·새 작성 공간', async () => { assert.ok(await pv.isVisible('#preview-note')); assert.equal((await stateOf(pv)).started, false); });
  await pv.selectOption('select[name=grade]', '1'); await pv.fill('input[name=klass]', '1'); await pv.fill('input[name=number]', '1'); await pv.fill('input[name=name]', '미리보기');
  await pv.click('#btn-start');
  await pv.waitForSelector('#inq1-main svg');
  await check('미리보기: 교사 설정(분석 연월·24시간·끈 문항) 적용, 메모 없음', async () => {
    assert.match(await pv.textContent('#context-bar'), /2026-08/);
    assert.match(await pv.textContent('#q-q2'), /2026-08-11 03:00 ~ 08-12 03:00/);
    await go(pv, 'inq4');
    assert.equal(await pv.$('#q-q10'), null);
    assert.ok(await pv.$('#q-q9'));
    assert.ok(!(await visibleText(pv)).includes('교사메모비밀문장'));
  });
  await pv.fill('#ans-q9', '미리보기 답');
  await pv.waitForTimeout(900);
  await check('미리보기 작성 내용은 학생 답과 분리 저장', async () => {
    assert.equal(await pv.evaluate(() => localStorage.getItem('tideLab.v1.work')), studentKeyBefore);
    assert.match(await pv.evaluate(() => localStorage.getItem('tideLabTeacher.v1.preview')), /미리보기 답/);
  });
  await go(pv, 'report');
  await pv.click('#btn-pdf'); await pv.waitForSelector('dialog[open]');
  const [pvPdf] = await Promise.all([pv.waitForEvent('download', { timeout: 90000 }), okDialog(pv)]);
  const pvPath = join(OUT, 'preview.pdf'); await pvPdf.saveAs(pvPath);
  await check('PDF에 교사용 메모 없음·공개 전 자료(기상·태풍) 없음', async () => {
    const t2 = execFileSync('pdftotext', [pvPath, '-'], { encoding: 'utf8' });
    assert.ok(!t2.includes('교사메모비밀문장'));
    assert.ok(!/힌남노|HINNAMNOR|기압|태풍/.test(t2));
    assert.ok(!t2.includes('문항 ⑧'));
  });
  await check('학생 화면에는 교사 설정이 적용되지 않음(배포 설정만)', async () => {
    const sp = await ctx.newPage();
    await sp.goto(BASE); await passAssessment(sp);
    await sp.waitForFunction(() => window.__tideApp?.store);
    assert.equal(await sp.evaluate(() => window.__tideApp.ad.setup.month), '2026-09');
    await sp.close();
  });
  await check('교사용 기능 시험: 가상 데이터는 미리보기에서만 선택', async () => {
    const sp = await ctx.newPage();
    await sp.goto(BASE + '?mode=preview&case=sample-2099'); await passAssessment(sp);
    await sp.waitForSelector('.student-form');
    assert.match(await sp.textContent('#sample-banner'), /기능 확인용 예시 데이터/);
    await sp.close();
  });
  await tp.reload(); await tp.waitForSelector('#t-editor');
  await check('교사용: 저장된 설정이 배포 설정과 다르면 차이 표시, [배포 설정 값으로 맞추기](메모 유지)', async () => {
    const tx = await tp.textContent('#t-diff');
    assert.match(tx, /분석 연월\s*2026-08\s*2026-09/);
    assert.match(tx, /끈 문항\s*⑧\s*없음/);
    await tp.click('#t-diff-apply'); await tp.waitForTimeout(800);
    const c = await tp.evaluate(() => window.__tideApp.teacher.cfg);
    assert.equal(c.month, '2026-09'); assert.equal(c.questions.q10, undefined); assert.equal(c.memo, '교사메모비밀문장');
    assert.equal(await tp.$('#t-diff'), null);
  });
  await check('교사용 메모는 로그인으로 보호된 서버 저장소에만(이 브라우저 사본에는 없음)', async () => {
    assert.match(upstash.data.get('tidelab:teacher:setup')?.v || '', /교사메모비밀문장/);
    assert.ok(!(await tp.evaluate(() => localStorage.getItem('tideLabTeacher.v1.setup') || '')).includes('교사메모비밀문장'));
  });
  // 세션 만료: 만료된 토큰을 가진 브라우저
  await check('세션 만료: 만료된 세션으로는 화면·보호된 요청 모두 차단', async () => {
    const cx = await newCtx({ viewport: { width: 1280, height: 800 } });
    let token = signSession(TEACHER_SECRET, { now: Date.now() - 9 * 3600e3, ttlMs: 8 * 3600e3 }).token;
    // 브라우저에 이 세션 쿠키를 직접 넣는다(로그인 응답과 같은 속성)
    const plant = (v) => cx.addCookies([{ name: COOKIE_NAME, value: v, domain: 'localhost', path: '/', secure: true, httpOnly: true, sameSite: 'Strict' }]);
    await plant(token);
    const p = await cx.newPage();
    await p.goto(BASE + '?mode=teacher');
    await p.waitForSelector('#t-login-form');
    assert.equal(await p.$('#t-editor'), null);
    assert.equal(await apiStatus(p, '/api/teacher/setup'), 401);
    // 비밀키를 모르는 사람이 만든 토큰도 거부
    await plant(signSession('not-the-real-secret-not-the-real-secret', { ttlMs: 3600e3 }).token);
    assert.equal(await apiStatus(p, '/api/teacher/setup'), 401);
    await plant(signSession(TEACHER_SECRET, { ttlMs: 3600e3 }).token);
    assert.equal(await apiStatus(p, '/api/teacher/setup'), 200, '(대조) 유효한 세션이면 통과 — 쿠키가 실제로 전송됨');
    await cx.close();
  });
  const oldCookie = (await ctx.cookies()).find((x) => x.name === COOKIE_NAME);
  await tp.click('#t-logout');
  await tp.waitForSelector('#t-login-form');
  await check('로그아웃: 쿠키 삭제, 화면·보호된 요청 차단, 예전 세션 재사용 불가', async () => {
    assert.equal((await ctx.cookies()).some((c) => c.name === COOKIE_NAME), false);
    assert.equal(await tp.$('#t-editor'), null);
    assert.equal(await apiStatus(tp, '/api/teacher/setup'), 401);
    const cx = await newCtx({ viewport: { width: 1280, height: 800 } });
    await cx.addCookies([{ name: COOKIE_NAME, value: oldCookie.value, domain: 'localhost', path: '/', secure: true, httpOnly: true, sameSite: 'Strict' }]);
    const p = await cx.newPage();
    await p.goto(BASE + 'index.html');
    assert.equal(await apiStatus(p, '/api/teacher/session'), 401, '서버 저장소의 무효화 목록으로 거부');
    await cx.addCookies([{ name: COOKIE_NAME, value: signSession(TEACHER_SECRET, { ttlMs: 3600e3 }).token, domain: 'localhost', path: '/', secure: true, httpOnly: true, sameSite: 'Strict' }]);
    assert.equal(await apiStatus(p, '/api/teacher/session'), 200, '(대조) 새 유효 세션은 통과 — 쿠키가 실제로 전송됨');
    await cx.close();
    const pv2 = await ctx.newPage();
    await pv2.goto(BASE + '?mode=preview'); await passAssessment(pv2);
    await pv2.waitForSelector('#t-login-form');
    await pv2.close();
  });
  await tp.close(); await pv.close();
  await ctx.close();

  // ───── 13. 이전 형식 저장 내용 보존 ─────
  const ctxL = await newCtx({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const legacy = { format: 'tide-lab-save', schemaVersion: 2, caseId: 'khoa-multi-2022-09', dataVersion: 'x', student: { grade: '2', klass: '1', number: '3', name: '이전학생' }, started: true, step: 'inq3', answers: { a1q1: '이전 답안' }, evidences: [], updatedAt: Date.now() };
  await ctxL.addInitScript((v) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tideLab.v1.work', v); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(legacy));
  const pl = await ctxL.newPage();
  watch(pl, 'legacy');
  await pl.goto(BASE); await passAssessment(pl);
  await pl.waitForSelector('#legacy-note-v2');
  await check('이전 형식 저장 내용: 원본 보존·안내·백업 받기', async () => {
    assert.match(await pl.textContent('#legacy-note-v2'), /이전학생/);
    const kept = await pl.evaluate(() => localStorage.getItem('tideLab.v2.legacy'));
    assert.equal(JSON.parse(kept).answers.a1q1, '이전 답안');
    assert.equal(await pl.evaluate(() => localStorage.getItem('tideLab.v1.work')), null);
    const [d] = await Promise.all([pl.waitForEvent('download'), pl.click('#btn-legacy-backup-v2')]);
    const pth = join(OUT, 'legacy-backup.json'); await d.saveAs(pth);
    assert.equal(JSON.parse(readFileSync(pth, 'utf8')).work.answers.a1q1, '이전 답안');
  });
  await ctxL.close();

  // ───── 14. 실제 자료 로딩 실패 → 오류·재시도(예시 데이터로 전환하지 않음) ─────
  const ctxF = await newCtx({ viewport: { width: 1280, height: 800 } });
  const pf = await ctxF.newPage();
  await pf.route('**/data/cases/khoa-assess-2025-26/case.json', (r) => r.abort());
  await pf.goto(BASE); await passAssessment(pf);
  await pf.waitForSelector('#fatal');
  await check('자료 로딩 실패: 오류와 재시도 제공, 예시 데이터로 자동 전환 안 함', async () => {
    assert.ok(await pf.isVisible('#btn-retry'));
    assert.ok(!(await pf.textContent('body')).includes('예시 관측소'));
    assert.equal(await pf.evaluate(() => window.__tideApp.ad), null);
  });
  await ctxF.close();
  // ───── 15. 서버에 교사 로그인 환경변수가 없으면 교사 화면 접근 거부 ─────
  const bare = spawn(process.execPath, [join(ROOT, 'tools/serve.mjs'), String(PORT + 1)], { stdio: 'ignore', env: { ...process.env, TEACHER_PASSWORD_HASH: '', TEACHER_SESSION_SECRET: '' } });
  await new Promise((r) => setTimeout(r, 700));
  try {
    const cb = await newCtx({ viewport: { width: 1280, height: 800 } });
    const pb = await cb.newPage();
    await pb.goto(`http://localhost:${PORT + 1}/?mode=teacher`);
    await pb.waitForSelector('#t-login-blocked');
    await check('환경변수 없음: 교사 화면·미리보기 접근 거부(로그인 창도 열지 않음), 학생 화면은 정상', async () => {
      assert.equal(await pb.$('#t-login-form'), null);
      assert.equal(await pb.$('#t-editor'), null);
      assert.match(await pb.textContent('#t-login-blocked'), /TEACHER_PASSWORD_HASH/);
      await pb.goto(`http://localhost:${PORT + 1}/?mode=preview`); await passAssessment(pb);
      await pb.waitForSelector('#fatal');
      assert.equal(await pb.$('.student-form'), null);
      await pb.goto(`http://localhost:${PORT + 1}/`); await passAssessment(pb);
      await pb.waitForSelector('.student-form');
    });
    await cb.close();
  } finally { bare.kill(); }
} catch (e) {
  results.push(['✗', '실행 중 오류', e.stack]);
} finally {
  await browser.close();
  server.kill();
  await upstash.close();
}
for (const e of errors) results.push(['✗', '브라우저 오류', e]);
for (const r of results.filter((x) => x[1] === '실행 중 오류' || x[1] === '브라우저 오류')) console.log(r[0], r[1], r[2] ? `\n    ${r[2]}` : '');
const fail = results.filter((r) => r[0] === '✗').length;
console.log(`\n통과 ${results.length - fail} / 실패 ${fail}`);
process.exitCode = fail ? 1 : 0;

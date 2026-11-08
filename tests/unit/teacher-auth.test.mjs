// 교사 로그인(서버 기능) 검증: 설정 없음 거부, 비밀번호 검증, 세션 쿠키·만료, CSRF·출처, 시도 제한, 로그아웃, 보호된 설정 요청
// 시험용 비밀번호는 실행할 때마다 무작위로 만든다(실제 비밀번호 아님).
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword, parsePasswordHash, signSession, verifySession, csrfFor, COOKIE_NAME, readConfig } from '../../api/_lib/auth.js';
import { _resetMemory } from '../../api/_lib/store.js';
import login from '../../api/teacher/login.js';
import session from '../../api/teacher/session.js';
import logout from '../../api/teacher/logout.js';
import setup from '../../api/teacher/setup.js';
import { startFakeUpstash } from '../helpers/fake-upstash.mjs';

const PW = `시험-${randomBytes(9).toString('base64url')}`;
const HASH = await hashPassword(PW);
const SECRET = randomBytes(48).toString('base64url');
const KEYS = ['TEACHER_PASSWORD_HASH', 'TEACHER_SESSION_SECRET', 'TEACHER_SESSION_HOURS', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'VERCEL'];
function setEnv(o) { for (const k of KEYS) delete process.env[k]; Object.assign(process.env, o); _resetMemory(); }
const baseEnv = () => ({ TEACHER_PASSWORD_HASH: HASH, TEACHER_SESSION_SECRET: SECRET });

let ipSeq = 1;
function req({ method = 'GET', body, cookie, csrf, origin = 'https://tide.example', host = 'tide.example', proto = 'https', ctype = 'application/json', ip, extra = {} } = {}) {
  const headers = { host, 'x-forwarded-proto': proto, ...extra };
  if (origin) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  if (csrf) headers['x-csrf-token'] = csrf;
  if (body !== undefined) headers['content-type'] = ctype;
  return { method, headers, body, socket: { remoteAddress: ip || `10.0.0.${ipSeq++}` }, url: '/api/teacher/x' };
}
function res() {
  return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b ? JSON.parse(b) : null; } };
}
async function call(h, r) { const out = res(); await h(r, out); return out; }
const cookieOf = (r) => (r.headers['set-cookie'] || '').split(';')[0];

test('비밀번호 검증값: scrypt 형식, 맞는 비밀번호만 통과, 잘못된 형식 거부', async () => {
  assert.match(HASH, /^scrypt\$32768\$8\$1\$/);
  assert.ok(!HASH.includes(PW));
  assert.equal(await verifyPassword(PW, HASH), true);
  assert.equal(await verifyPassword(`${PW}x`, HASH), false);
  assert.equal(await verifyPassword(PW, 'plain-text-password'), false);
  assert.equal(parsePasswordHash('scrypt$1024$8$1$aaaaaaaaaaaaaaaaaaaaaa$bbbb'), null, '약한 설정·짧은 값 거부');
});

test('환경변수가 없거나 약하면 로그인·보호된 요청 모두 거부(503)', async () => {
  setEnv({});
  assert.equal((await call(login, req({ method: 'POST', body: { password: PW } }))).statusCode, 503);
  assert.equal((await call(session, req())).statusCode, 503);
  assert.equal((await call(setup, req())).statusCode, 503);
  setEnv({ TEACHER_PASSWORD_HASH: HASH, TEACHER_SESSION_SECRET: 'short' });
  assert.equal(readConfig().ok, false);
  const r = await call(login, req({ method: 'POST', body: { password: PW } }));
  assert.equal(r.statusCode, 503);
  assert.equal(r.headers['set-cookie'], undefined);
});

test('로그인: POST 본문만, 실패는 401(쿠키 없음), 성공은 HttpOnly·Secure·SameSite 세션 쿠키', async () => {
  setEnv(baseEnv());
  assert.equal((await call(login, req({ method: 'GET' }))).statusCode, 405);
  const viaUrl = req({ method: 'POST', body: {} }); viaUrl.url = `/api/teacher/login?password=${encodeURIComponent(PW)}`;
  assert.equal((await call(login, viaUrl)).statusCode, 400, '주소의 비밀번호는 쓰지 않음');
  assert.equal((await call(login, req({ method: 'POST', body: 'password=x', ctype: 'application/x-www-form-urlencoded' }))).statusCode, 415);
  const bad = await call(login, req({ method: 'POST', body: { password: 'wrong-password' } }));
  assert.equal(bad.statusCode, 401);
  assert.equal(bad.headers['set-cookie'], undefined);
  assert.ok(!JSON.stringify(bad.body).includes('wrong-password'));
  const ok = await call(login, req({ method: 'POST', body: { password: PW } }));
  assert.equal(ok.statusCode, 200);
  const c = ok.headers['set-cookie'];
  assert.match(c, new RegExp(`^${COOKIE_NAME}=v1\\.`));
  for (const f of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=28800']) assert.ok(c.includes(f), f);
  assert.equal(ok.headers['cache-control'], 'no-store');
  assert.ok(ok.body.expiresAt > Date.now() + 7.9 * 3600e3);
  const s = await call(session, req({ cookie: cookieOf(ok) }));
  assert.equal(s.statusCode, 200);
  assert.equal(s.body.authenticated, true);
  assert.equal(s.body.csrfToken, ok.body.csrfToken);
});

test('로그인: HTTPS·같은 출처가 아니면 거부', async () => {
  setEnv({ ...baseEnv(), VERCEL: '1' });
  assert.equal((await call(login, req({ method: 'POST', body: { password: PW }, proto: 'http', origin: 'http://tide.example' }))).statusCode, 403, 'Vercel에서 http 거부');
  assert.equal((await call(login, req({ method: 'POST', body: { password: PW }, origin: 'https://evil.example' }))).statusCode, 403, '다른 출처 거부');
  assert.equal((await call(login, req({ method: 'POST', body: { password: PW }, origin: null }))).statusCode, 403, '출처 정보 없음 거부');
  assert.equal((await call(login, req({ method: 'POST', body: { password: PW }, origin: null, extra: { 'sec-fetch-site': 'same-origin' } }))).statusCode, 200);
});

test('세션: 위조·만료 토큰 거부', () => {
  const { token } = signSession(SECRET, { ttlMs: 3600e3 });
  assert.ok(verifySession(token, SECRET));
  assert.equal(verifySession(token, `${SECRET}x`), null, '다른 비밀키');
  const [v, body, sig] = token.split('.');
  const forged = JSON.parse(Buffer.from(body, 'base64url'));
  forged.exp += 99999;
  assert.equal(verifySession(`${v}.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${sig}`, SECRET), null, '내용 조작');
  assert.equal(verifySession(token, SECRET, { now: Date.now() + 3601e3 }), null, '만료');
  assert.equal(verifySession('', SECRET), null);
});

test('세션 만료 후 보호된 요청 401', async () => {
  setEnv(baseEnv());
  const { token } = signSession(SECRET, { now: Date.now() - 9 * 3600e3, ttlMs: 8 * 3600e3 });
  const r = await call(session, req({ cookie: `${COOKIE_NAME}=${token}` }));
  assert.equal(r.statusCode, 401);
  assert.equal(r.body.authenticated, false);
});

test('시도 제한: 같은 곳에서 5번 실패하면 맞는 비밀번호도 429', async () => {
  setEnv(baseEnv());
  const ip = '10.9.9.9';
  for (let i = 0; i < 5; i++) assert.equal((await call(login, req({ method: 'POST', body: { password: `wrong-${i}` }, ip }))).statusCode, 401);
  const r = await call(login, req({ method: 'POST', body: { password: PW }, ip }));
  assert.equal(r.statusCode, 429);
  assert.ok(Number(r.headers['retry-after']) > 0);
  assert.equal(r.headers['set-cookie'], undefined);
  assert.equal((await call(login, req({ method: 'POST', body: { password: PW }, ip: '10.9.9.10' }))).statusCode, 200, '다른 곳은 영향 없음');
});

test('보호된 설정 요청: 로그인·CSRF·출처 확인, 서버 저장소 없으면 거부, 있으면 메모까지 보관', async () => {
  const up = await startFakeUpstash();
  try {
    setEnv(baseEnv());
    const ok = await call(login, req({ method: 'POST', body: { password: PW } }));
    const cookie = cookieOf(ok), csrf = ok.body.csrfToken;
    const body = { format: 'tide-lab-assessment-setup', version: 1, caseId: 'khoa-multi-2022-09', stations: { DT_0005: { enabled: true, memo: '교사만 보는 메모' } } };
    assert.equal((await call(setup, req({ method: 'PUT', body, cookie, csrf }))).statusCode, 503, '저장소 없음 → 저장 거부');
    setEnv({ ...baseEnv(), UPSTASH_REDIS_REST_URL: up.url, UPSTASH_REDIS_REST_TOKEN: up.token });
    assert.equal((await call(setup, req())).statusCode, 401, '로그인 전 읽기 거부');
    assert.equal((await call(setup, req({ method: 'PUT', body }))).statusCode, 401, '로그인 전 저장 거부');
    assert.equal((await call(setup, req({ method: 'PUT', body, cookie }))).statusCode, 403, 'CSRF 토큰 없음');
    assert.equal((await call(setup, req({ method: 'PUT', body, cookie, csrf: 'x'.repeat(43) }))).statusCode, 403, 'CSRF 토큰 틀림');
    assert.equal((await call(setup, req({ method: 'PUT', body, cookie, csrf, origin: 'https://evil.example' }))).statusCode, 403, '다른 출처');
    const forgedCookie = `${COOKIE_NAME}=${signSession('another-secret-another-secret-123456', { ttlMs: 3600e3 }).token}`;
    assert.equal((await call(setup, req({ method: 'PUT', body, cookie: forgedCookie, csrf }))).statusCode, 401, '다른 키로 만든 토큰');
    assert.equal((await call(setup, req({ method: 'PUT', body: { nope: 1 }, cookie, csrf }))).statusCode, 400, '형식 검사');
    assert.equal((await call(setup, req({ method: 'PUT', body, cookie, csrf }))).statusCode, 200);
    const got = await call(setup, req({ cookie }));
    assert.equal(got.statusCode, 200);
    assert.equal(got.body.setup.stations.DT_0005.memo, '교사만 보는 메모');
    assert.equal(csrfFor(SECRET, verifySession(cookie.split('=')[1], SECRET).sid), csrf);
  } finally { await up.close(); }
});

test('로그아웃: 쿠키 삭제, 서버 저장소가 있으면 그 세션 무효화', async () => {
  const up = await startFakeUpstash();
  try {
    setEnv({ ...baseEnv(), UPSTASH_REDIS_REST_URL: up.url, UPSTASH_REDIS_REST_TOKEN: up.token });
    const ok = await call(login, req({ method: 'POST', body: { password: PW } }));
    const cookie = cookieOf(ok);
    assert.equal((await call(logout, req({ method: 'POST', cookie, origin: 'https://evil.example' }))).statusCode, 403);
    const out = await call(logout, req({ method: 'POST', cookie, csrf: ok.body.csrfToken }));
    assert.equal(out.statusCode, 200);
    assert.match(out.headers['set-cookie'], /Max-Age=0/);
    assert.equal(out.body.revoked, true);
    assert.equal((await call(session, req({ cookie }))).statusCode, 401, '지운 쿠키를 다시 보내도 거부');
  } finally { await up.close(); }
});

test('서버 저장소 장애 시 로그인 거부(허용하지 않음)', async () => {
  setEnv({ ...baseEnv(), UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:9', UPSTASH_REDIS_REST_TOKEN: 't' });
  const r = await call(login, req({ method: 'POST', body: { password: PW } }));
  assert.equal(r.statusCode, 503);
  assert.equal(r.headers['set-cookie'], undefined);
});

test('시도 제한: 서버 저장소(Redis)를 쓰면 모든 인스턴스가 같은 횟수를 공유', async () => {
  const up = await startFakeUpstash();
  try {
    setEnv({ ...baseEnv(), UPSTASH_REDIS_REST_URL: up.url, UPSTASH_REDIS_REST_TOKEN: up.token });
    const ip = '10.8.8.8';
    for (let i = 0; i < 5; i++) await call(login, req({ method: 'POST', body: { password: `wrong-${i}` }, ip }));
    _resetMemory(); // 다른 인스턴스(메모리 비어 있음)라고 가정
    assert.equal((await call(login, req({ method: 'POST', body: { password: PW }, ip }))).statusCode, 429);
    assert.equal(up.data.get(`tidelab:login:ip:${ip}`).v, '5');
  } finally { await up.close(); }
});

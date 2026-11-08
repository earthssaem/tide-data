// POST /api/teacher/login  본문(JSON): { "password": "…" }
// 성공: 만료 시각이 있는 세션 쿠키(HttpOnly·Secure·SameSite=Strict) 발급
// 실패: 401, 시도가 많으면 429(Retry-After). 서버 설정이 없으면 503(접근 거부)
// 비밀번호는 POST 본문으로만 받는다(주소의 ?password=… 는 무시). 본문·비밀번호는 로그에 남기지 않는다.
import { readConfig, verifyPassword, signSession, sessionCookie, csrfFor } from '../_lib/auth.js';
import { loginLimiter, redisConfig, StoreError } from '../_lib/store.js';
import { send, readJson, protocolOk, sameOrigin, clientIp } from '../_lib/http.js';

const MIN_FAIL_MS = 600;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res) {
  if (req.method !== 'POST') { send(res, 405, { ok: false, error: 'POST로만 로그인할 수 있습니다.' }, { Allow: 'POST' }); return; }
  const cfg = readConfig(process.env);
  if (!cfg.ok) { send(res, 503, { ok: false, error: cfg.error, code: 'not_configured' }); return; }
  if (!protocolOk(req)) { send(res, 403, { ok: false, error: 'HTTPS로 접속해야 합니다.', code: 'https_required' }); return; }
  if (!sameOrigin(req)) { send(res, 403, { ok: false, error: '다른 출처에서 온 로그인 요청은 처리하지 않습니다.', code: 'csrf' }); return; }
  const started = Date.now();
  const ip = clientIp(req);
  const limiter = loginLimiter(process.env);
  try {
    const lim = await limiter.check(ip);
    if (lim.blocked) {
      send(res, 429, { ok: false, error: `로그인 시도가 너무 많습니다. 약 ${Math.ceil(lim.retryAfter / 60)}분 뒤에 다시 시도하세요.`, code: 'rate_limited', retryAfter: lim.retryAfter }, { 'Retry-After': String(lim.retryAfter) });
      return;
    }
    const body = await readJson(req, 2048);
    if (body.error) { send(res, body.error, { ok: false, error: body.error === 415 ? 'JSON 형식으로 보내야 합니다.' : '요청 형식이 올바르지 않습니다.' }); return; }
    const password = body.value?.password;
    if (typeof password !== 'string' || !password || password.length > 256) {
      await limiter.fail(ip);
      await sleep(Math.max(0, MIN_FAIL_MS - (Date.now() - started)));
      send(res, 400, { ok: false, error: '비밀번호를 입력하세요.', code: 'bad_request' });
      return;
    }
    const good = await verifyPassword(password, cfg.hash);
    if (!good) {
      await limiter.fail(ip);
      await sleep(Math.max(0, MIN_FAIL_MS - (Date.now() - started)));
      send(res, 401, { ok: false, error: '비밀번호가 맞지 않습니다.', code: 'bad_password' });
      return;
    }
    await limiter.success(ip);
    const { token, payload } = signSession(cfg.secret, { ttlMs: cfg.ttlMs });
    send(res, 200, {
      ok: true,
      expiresAt: payload.exp * 1000,
      csrfToken: csrfFor(cfg.secret, payload.sid),
      storage: redisConfig(process.env) ? 'server' : 'none',
    }, { 'Set-Cookie': sessionCookie(token, Math.floor(cfg.ttlMs / 1000)) });
  } catch (e) {
    send(res, 503, { ok: false, error: e instanceof StoreError ? `${e.message} 지금은 로그인할 수 없습니다.` : '로그인을 처리하지 못했습니다.', code: 'store_error' });
  }
}

// 교사용 API 공통: 응답, 본문 읽기, HTTPS·같은 출처 확인, 세션·CSRF 확인
// 비밀번호나 요청 본문은 어떤 경우에도 로그에 남기지 않는다(console 출력 없음).
import { readConfig, verifySession, csrfMatches, parseCookies, COOKIE_NAME } from './auth.js';
import { isRevoked, StoreError } from './store.js';

const onVercel = (env) => !!env.VERCEL;

export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

const header = (req, k) => {
  const v = req.headers?.[k];
  return Array.isArray(v) ? v[0] : v || '';
};

function hostOf(req) {
  return String(header(req, 'x-forwarded-host') || header(req, 'host')).split(',')[0].trim().toLowerCase();
}
const isLocalHost = (host) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);

/** HTTPS만 허용(Vercel). 로컬 확인용 서버(localhost)에서만 http 허용 */
export function protocolOk(req, env = process.env) {
  const proto = String(header(req, 'x-forwarded-proto')).split(',')[0].trim();
  if (proto === 'https') return true;
  if (onVercel(env)) return false;
  return isLocalHost(hostOf(req)) && !proto.startsWith('https');
}

/** 같은 출처에서 온 요청인지(Origin, 없으면 Sec-Fetch-Site) — CSRF 1차 방어 */
export function sameOrigin(req, env = process.env) {
  const host = hostOf(req);
  if (!host) return false;
  const origin = header(req, 'origin');
  if (origin) {
    try {
      const u = new URL(origin);
      if (u.host.toLowerCase() !== host) return false;
      return u.protocol === 'https:' || (!onVercel(env) && u.protocol === 'http:' && isLocalHost(host));
    } catch { return false; }
  }
  return header(req, 'sec-fetch-site') === 'same-origin';
}

/** 접속한 곳(시도 제한용). Vercel이 붙이는 머리글만 믿고, 로컬에서는 소켓 주소 */
export function clientIp(req, env = process.env) {
  if (onVercel(env)) {
    const ip = header(req, 'x-real-ip') || String(header(req, 'x-forwarded-for')).split(',')[0].trim();
    if (ip) return ip.slice(0, 64);
  }
  return String(req.socket?.remoteAddress || 'unknown').slice(0, 64);
}

/** JSON 본문 읽기(크기 제한). 실패하면 null */
export async function readJson(req, limit = 4096) {
  const ctype = header(req, 'content-type').toLowerCase();
  if (!ctype.startsWith('application/json')) return { error: 415 };
  if (req.body !== undefined) {
    // Vercel이 미리 해석한 본문
    try {
      const b = req.body;
      if (typeof b === 'string') return b.length > limit ? { error: 413 } : { value: JSON.parse(b) };
      if (Buffer.isBuffer(b)) return b.length > limit ? { error: 413 } : { value: JSON.parse(b.toString('utf8')) };
      if (b && typeof b === 'object') return JSON.stringify(b).length > limit ? { error: 413 } : { value: b };
      return { error: 400 };
    } catch { return { error: 400 }; }
  }
  const chunks = [];
  let size = 0;
  try {
    for await (const c of req) {
      size += c.length;
      if (size > limit) return { error: 413 };
      chunks.push(c);
    }
    return { value: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch { return { error: 400 }; }
}

/**
 * 보호된 요청 확인: 서버 설정 → HTTPS → 세션 쿠키(서명·만료·무효화) → (변경 요청이면) 같은 출처·CSRF
 * @returns {{ok:true, cfg, session} | {ok:false, status, error}}
 */
export async function authorize(req, { mutate = false, env = process.env, now = Date.now() } = {}) {
  const cfg = readConfig(env);
  if (!cfg.ok) return { ok: false, status: 503, error: cfg.error, code: 'not_configured' };
  if (!protocolOk(req, env)) return { ok: false, status: 403, error: 'HTTPS로 접속해야 합니다.', code: 'https_required' };
  const token = parseCookies(header(req, 'cookie'))[COOKIE_NAME];
  const session = token ? verifySession(token, cfg.secret, { now }) : null;
  if (!session) return { ok: false, status: 401, error: '교사 로그인이 필요합니다(세션이 없거나 만료됨).', code: 'login_required' };
  try {
    if (await isRevoked(env, session.sid)) return { ok: false, status: 401, error: '로그아웃한 세션입니다. 다시 로그인하세요.', code: 'login_required' };
  } catch (e) {
    return { ok: false, status: 503, error: e instanceof StoreError ? e.message : '세션을 확인하지 못했습니다.', code: 'store_error' };
  }
  if (mutate) {
    if (!sameOrigin(req, env)) return { ok: false, status: 403, error: '다른 출처에서 온 요청은 처리하지 않습니다.', code: 'csrf' };
    if (!csrfMatches(cfg.secret, session.sid, header(req, 'x-csrf-token'))) return { ok: false, status: 403, error: 'CSRF 토큰이 없거나 올바르지 않습니다.', code: 'csrf' };
  }
  return { ok: true, cfg, session };
}

export function denied(res, a) {
  send(res, a.status, { ok: false, error: a.error, code: a.code });
}

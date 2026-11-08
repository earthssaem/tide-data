// 교사 로그인 핵심 기능(서버 전용) — 브라우저 코드에서 가져다 쓰지 않는다.
// - 비밀번호: scrypt(메모리 집약 해시, Node 내장)로 만든 검증값을 서버 환경변수 TEACHER_PASSWORD_HASH에만 둔다.
// - 세션: HMAC-SHA256으로 서명한 만료 시각 포함 토큰을 HttpOnly·Secure·SameSite=Strict 쿠키로 보낸다.
// - 설정이 없거나 잘못되면 언제나 접근을 거부한다(fail closed).
import { scrypt, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE_NAME = '__Host-tideTeacher';
const SCRYPT_KEYLEN = 32;
const MIN_SECRET_LEN = 32;

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');

function scryptAsync(password, salt, keylen, { N, r, p }) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, { N, r, p, maxmem: 256 * N * r + 32 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** 검증값 형식: scrypt$N$r$p$소금(base64url)$해시(base64url) */
export function parsePasswordHash(s) {
  const m = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9_-]{16,})\$([A-Za-z0-9_-]{40,})$/.exec(String(s || '').trim());
  if (!m) return null;
  const N = Number(m[1]), r = Number(m[2]), p = Number(m[3]);
  if (N < 16384 || (N & (N - 1)) !== 0 || N > 1048576 || r < 8 || r > 32 || p < 1 || p > 4) return null;
  const salt = fromB64u(m[4]), hash = fromB64u(m[5]);
  if (salt.length < 16 || hash.length !== SCRYPT_KEYLEN) return null;
  return { N, r, p, salt, hash };
}

/** 비밀번호 검증값 만들기(설정 도구에서 사용) */
export async function hashPassword(password, { N = 32768, r = 8, p = 1 } = {}) {
  const salt = randomBytes(16);
  const key = await scryptAsync(String(password).normalize('NFC'), salt, SCRYPT_KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${b64u(salt)}$${b64u(key)}`;
}

/** 비밀번호 확인(일정 시간 비교). 형식이 틀린 검증값이면 false */
export async function verifyPassword(password, stored) {
  const h = typeof stored === 'string' ? parsePasswordHash(stored) : stored;
  if (!h || typeof password !== 'string') return false;
  const key = await scryptAsync(password.normalize('NFC'), h.salt, SCRYPT_KEYLEN, h);
  return key.length === h.hash.length && timingSafeEqual(key, h.hash);
}

export function newSessionSecret() {
  return b64u(randomBytes(48));
}

/**
 * 서버 설정 읽기. ok:false면 로그인·보호된 요청을 모두 거부한다.
 * TEACHER_PASSWORD_HASH(필수), TEACHER_SESSION_SECRET(필수, 32자 이상), TEACHER_SESSION_HOURS(선택, 1~24, 기본 8)
 */
export function readConfig(env = process.env) {
  const hash = parsePasswordHash(env.TEACHER_PASSWORD_HASH);
  const secret = String(env.TEACHER_SESSION_SECRET || '');
  if (!hash) return { ok: false, error: '교사 로그인 서버 설정이 없거나 올바르지 않습니다(TEACHER_PASSWORD_HASH).' };
  if (secret.length < MIN_SECRET_LEN) return { ok: false, error: '교사 로그인 서버 설정이 없거나 올바르지 않습니다(TEACHER_SESSION_SECRET).' };
  let hours = Number(env.TEACHER_SESSION_HOURS || 8);
  if (!Number.isFinite(hours)) hours = 8;
  hours = Math.min(24, Math.max(1, hours));
  return { ok: true, hash, secret, ttlMs: Math.round(hours * 3600e3) };
}

function hmac(secret, data) {
  return createHmac('sha256', secret).update(data).digest();
}

/** 세션 토큰 발급: v1.<내용>.<서명> */
export function signSession(secret, { now = Date.now(), ttlMs }) {
  const payload = { v: 1, sub: 'teacher', sid: b64u(randomBytes(16)), iat: Math.floor(now / 1000), exp: Math.floor((now + ttlMs) / 1000) };
  const body = b64u(JSON.stringify(payload));
  return { token: `v1.${body}.${b64u(hmac(secret, `v1.${body}`))}`, payload };
}

/** 세션 토큰 확인. 서명이 틀리거나 만료되면 null */
export function verifySession(token, secret, { now = Date.now() } = {}) {
  if (typeof token !== 'string' || token.length > 600) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const expect = hmac(secret, `v1.${parts[1]}`);
  const got = fromB64u(parts[2]);
  if (got.length !== expect.length || !timingSafeEqual(got, expect)) return null;
  let p;
  try { p = JSON.parse(fromB64u(parts[1]).toString('utf8')); } catch { return null; }
  const t = Math.floor(now / 1000);
  if (!p || p.v !== 1 || p.sub !== 'teacher' || typeof p.sid !== 'string' || !Number.isInteger(p.exp) || !Number.isInteger(p.iat)) return null;
  if (p.exp <= t || p.iat > t + 60) return null;
  return p;
}

/** 세션마다 다른 CSRF 토큰(서버 비밀키로 계산하므로 저장할 필요 없음) */
export function csrfFor(secret, sid) {
  return b64u(hmac(secret, `csrf.${sid}`));
}

export function csrfMatches(secret, sid, given) {
  if (typeof given !== 'string' || given.length > 200) return false;
  const a = Buffer.from(csrfFor(secret, sid)), b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function sessionCookie(token, maxAgeSec) {
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; Secure; SameSite=Strict`;
}
export function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k && !(k in out)) out[k] = part.slice(i + 1).trim();
  }
  return out;
}

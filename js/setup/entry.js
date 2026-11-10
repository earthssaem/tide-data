// 학생 입장 코드: 코드 자체는 저장하지 않고 확인값(PBKDF2-SHA256)만 학생용 배포 설정(data/assessment.json)에 둔다.
// 정적 웹앱이라 화면 앞을 막는 장치일 뿐, 자료 파일까지 막지는 못한다(README '입장 코드' 참고).
export const ENTRY_ALG = 'PBKDF2-SHA256';
export const ENTRY_ITER = 200000;
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** 입력 정리: 앞뒤·사이 공백 제거 */
export const normCode = (s) => String(s ?? '').replace(/\s+/g, '');
/** 교사가 정할 수 있는 코드: 숫자·영문 4~12자 */
export const validCode = (s) => /^[0-9A-Za-z]{4,12}$/.test(normCode(s));

export function cryptoReady() { return !!globalThis.crypto?.subtle; }

async function derive(code, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(normCode(code)), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

/** 새 확인값 만들기 */
export async function makeEntry(code, iterations = ENTRY_ITER) {
  if (!validCode(code)) throw new Error('입장 코드는 숫자·영문 4~12자로 정하세요.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { alg: ENTRY_ALG, iterations, salt: b64(salt), hash: await derive(code, salt, iterations) };
}

/** 코드가 맞는지 */
export async function checkEntry(entry, code) {
  const e = sanitizeEntry(entry);
  if (!e || !normCode(code)) return false;
  const h = await derive(code, unb64(e.salt), e.iterations);
  // 길이가 같은 문자열 비교(시간 차이를 줄임)
  let diff = h.length ^ e.hash.length;
  for (let i = 0; i < Math.min(h.length, e.hash.length); i++) diff |= h.charCodeAt(i) ^ e.hash.charCodeAt(i);
  return diff === 0;
}

/** 설정 파일의 entry 정리(형식이 틀리면 null = 입장 코드 없음) */
export function sanitizeEntry(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  const B64 = /^[A-Za-z0-9+/]{16,88}={0,2}$/;
  if (e.alg !== ENTRY_ALG || !Number.isInteger(e.iterations) || e.iterations < 10000 || e.iterations > 2000000) return null;
  if (typeof e.salt !== 'string' || !B64.test(e.salt) || typeof e.hash !== 'string' || !B64.test(e.hash)) return null;
  return { alg: e.alg, iterations: e.iterations, salt: e.salt, hash: e.hash };
}

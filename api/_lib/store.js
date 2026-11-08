// 서버 저장소(선택): Upstash Redis REST — 로그인 시도 제한, 로그아웃한 세션 무효화, 교사용 설정(메모 포함) 보관
// 환경변수: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (또는 Vercel KV 이름 KV_REST_API_URL / KV_REST_API_TOKEN)
// 저장소가 없으면: 시도 제한은 서버 인스턴스 메모리로(인스턴스마다 따로, 재시작 시 초기화), 교사 설정의 서버 저장은 거부.
// 저장소 요청이 실패하면 보호된 작업을 거부한다(허용하지 않음).

export function redisConfig(env = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || '';
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || '';
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

export class StoreError extends Error {}

/** 명령 여러 개를 한 번에 실행. 실패하면 StoreError */
export async function redis(cfg, commands) {
  let res;
  try {
    res = await fetch(`${cfg.url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(5000),
    });
  } catch { throw new StoreError('서버 저장소에 연결하지 못했습니다.'); }
  if (!res.ok) throw new StoreError(`서버 저장소 오류(HTTP ${res.status})`);
  const out = await res.json().catch(() => null);
  if (!Array.isArray(out) || out.some((x) => x && x.error)) throw new StoreError('서버 저장소 응답 오류');
  return out.map((x) => x.result);
}

// ── 메모리 저장(저장소가 없을 때 시도 제한용, 인스턴스마다 따로) ──
const mem = new Map();
function memGet(k, now) { const e = mem.get(k); if (!e) return null; if (e.until <= now) { mem.delete(k); return null; } return e; }

export const LIMITS = { windowSec: 15 * 60, perIp: 5, global: 100 };

/** 로그인 실패 횟수 제한: IP마다 15분에 5번, 전체 15분에 100번 */
export function loginLimiter(env = process.env, { now = () => Date.now() } = {}) {
  const cfg = redisConfig(env);
  const W = LIMITS.windowSec;
  const kIp = (ip) => `tidelab:login:ip:${ip}`;
  const kAll = 'tidelab:login:all';
  return {
    kind: cfg ? 'redis' : 'memory',
    async check(ip) {
      if (cfg) {
        const [a, ta, g, tg] = await redis(cfg, [['GET', kIp(ip)], ['TTL', kIp(ip)], ['GET', kAll], ['TTL', kAll]]);
        if (Number(a) >= LIMITS.perIp) return { blocked: true, retryAfter: Math.max(1, Number(ta) > 0 ? Number(ta) : W) };
        if (Number(g) >= LIMITS.global) return { blocked: true, retryAfter: Math.max(1, Number(tg) > 0 ? Number(tg) : W) };
        return { blocked: false };
      }
      const t = now();
      const a = memGet(kIp(ip), t), g = memGet(kAll, t);
      if (a && a.n >= LIMITS.perIp) return { blocked: true, retryAfter: Math.ceil((a.until - t) / 1000) };
      if (g && g.n >= LIMITS.global) return { blocked: true, retryAfter: Math.ceil((g.until - t) / 1000) };
      return { blocked: false };
    },
    async fail(ip) {
      if (cfg) {
        await redis(cfg, [['INCR', kIp(ip)], ['EXPIRE', kIp(ip), W, 'NX'], ['INCR', kAll], ['EXPIRE', kAll, W, 'NX']]);
        return;
      }
      const t = now();
      for (const k of [kIp(ip), kAll]) {
        const e = memGet(k, t) || { n: 0, until: t + W * 1000 };
        e.n++;
        mem.set(k, e);
      }
    },
    async success(ip) {
      if (cfg) { await redis(cfg, [['DEL', kIp(ip)]]); return; }
      mem.delete(kIp(ip));
    },
  };
}

/** 로그아웃한 세션 무효화(저장소가 있을 때). 저장소가 없으면 쿠키 삭제만 */
export async function revokeSession(env, sid, ttlSec) {
  const cfg = redisConfig(env);
  if (!cfg || ttlSec <= 0) return false;
  await redis(cfg, [['SET', `tidelab:revoked:${sid}`, '1', 'EX', Math.ceil(ttlSec)]]);
  return true;
}
export async function isRevoked(env, sid) {
  const cfg = redisConfig(env);
  if (!cfg) return false;
  const [r] = await redis(cfg, [['EXISTS', `tidelab:revoked:${sid}`]]);
  return Number(r) === 1;
}

const SETUP_KEY = 'tidelab:teacher:setup';
export async function loadSetup(env) {
  const cfg = redisConfig(env);
  if (!cfg) return { configured: false };
  const [v] = await redis(cfg, [['GET', SETUP_KEY]]);
  return { configured: true, value: v ? JSON.parse(v) : null };
}
export async function saveSetup(env, value) {
  const cfg = redisConfig(env);
  if (!cfg) return { configured: false };
  await redis(cfg, [['SET', SETUP_KEY, JSON.stringify(value)]]);
  return { configured: true };
}

/** 시험용: 메모리 제한 기록 비우기 */
export function _resetMemory() { mem.clear(); }

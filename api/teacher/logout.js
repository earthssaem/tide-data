// POST /api/teacher/logout — 세션 쿠키를 지우고(서버 저장소가 있으면 남은 시간 동안 그 세션을 무효화)
// 같은 출처 요청만 받는다. 세션이 이미 없거나 만료되었어도 쿠키는 지운다.
import { readConfig, verifySession, parseCookies, clearCookie, csrfMatches, COOKIE_NAME } from '../_lib/auth.js';
import { revokeSession } from '../_lib/store.js';
import { send, sameOrigin } from '../_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { send(res, 405, { ok: false, error: 'POST만 허용합니다.' }, { Allow: 'POST' }); return; }
  if (!sameOrigin(req)) { send(res, 403, { ok: false, error: '다른 출처에서 온 요청은 처리하지 않습니다.', code: 'csrf' }); return; }
  const cfg = readConfig(process.env);
  let revoked = false;
  if (cfg.ok) {
    const token = parseCookies(req.headers?.cookie)[COOKIE_NAME];
    const s = token ? verifySession(token, cfg.secret) : null;
    if (s && csrfMatches(cfg.secret, s.sid, req.headers?.['x-csrf-token'])) {
      try { revoked = await revokeSession(process.env, s.sid, s.exp - Math.floor(Date.now() / 1000)); } catch { revoked = false; }
    }
  }
  send(res, 200, { ok: true, revoked }, { 'Set-Cookie': clearCookie() });
}

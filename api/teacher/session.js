// GET /api/teacher/session — 지금 교사로 로그인되어 있는지, 만료 시각, CSRF 토큰
import { csrfFor } from '../_lib/auth.js';
import { redisConfig } from '../_lib/store.js';
import { send, authorize } from '../_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') { send(res, 405, { ok: false, error: 'GET만 허용합니다.' }, { Allow: 'GET' }); return; }
  const a = await authorize(req);
  if (!a.ok) { send(res, a.status, { ok: false, authenticated: false, error: a.error, code: a.code }); return; }
  send(res, 200, {
    ok: true,
    authenticated: true,
    expiresAt: a.session.exp * 1000,
    csrfToken: csrfFor(a.cfg.secret, a.session.sid),
    storage: redisConfig(process.env) ? 'server' : 'none',
  });
}

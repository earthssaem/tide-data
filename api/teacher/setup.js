// /api/teacher/setup — 교사용 평가 설정(교사용 메모 포함) 서버 보관
//   GET: 저장된 설정 읽기(로그인 필요)
//   PUT: 설정 저장(로그인 + 같은 출처 + CSRF 토큰 필요, 형식 검사)
// 서버 저장소(Upstash Redis)가 설정되지 않았으면 503으로 거부한다(교사 화면은 이 브라우저에만 저장).
// 학생용 앱은 이 API를 쓰지 않는다. 학생에게 적용할 설정은 data/assessment.json(공개 파일, 메모 없음)이다.
import { parseSetup } from '../../js/setup/setup.js';
import { loadSetup, saveSetup, StoreError } from '../_lib/store.js';
import { send, authorize, denied, readJson } from '../_lib/http.js';

const MAX_BYTES = 256 * 1024;

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PUT') { send(res, 405, { ok: false, error: 'GET, PUT만 허용합니다.' }, { Allow: 'GET, PUT' }); return; }
  const a = await authorize(req, { mutate: req.method === 'PUT' });
  if (!a.ok) { denied(res, a); return; }
  try {
    if (req.method === 'GET') {
      const r = await loadSetup(process.env);
      if (!r.configured) { send(res, 503, { ok: false, error: '서버 저장소가 설정되지 않았습니다. 교사 설정은 이 브라우저에만 저장됩니다.', code: 'no_storage' }); return; }
      send(res, 200, { ok: true, setup: r.value });
      return;
    }
    const body = await readJson(req, MAX_BYTES);
    if (body.error) { send(res, body.error, { ok: false, error: body.error === 413 ? '설정이 너무 큽니다.' : body.error === 415 ? 'JSON 형식으로 보내야 합니다.' : '요청 형식이 올바르지 않습니다.' }); return; }
    let setup;
    try { setup = parseSetup(body.value); } catch (e) { send(res, 400, { ok: false, error: e.message, code: 'invalid_setup' }); return; }
    setup.savedAt = new Date().toISOString();
    const r = await saveSetup(process.env, setup);
    if (!r.configured) { send(res, 503, { ok: false, error: '서버 저장소가 설정되지 않았습니다. 교사 설정은 이 브라우저에만 저장됩니다.', code: 'no_storage' }); return; }
    send(res, 200, { ok: true, savedAt: setup.savedAt });
  } catch (e) {
    send(res, 503, { ok: false, error: e instanceof StoreError ? e.message : '설정을 처리하지 못했습니다.', code: 'store_error' });
  }
}

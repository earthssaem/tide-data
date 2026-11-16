// 교사 로그인(브라우저 쪽): 로그인 화면, 세션 확인, 로그아웃, 인증이 필요한 요청
// - 비밀번호의 정답 여부는 서버(/api/teacher/login)만 판단한다. 이 파일에는 비밀번호·검증값이 없다.
// - 세션은 HttpOnly 쿠키라 자바스크립트로 읽을 수 없다. 변경 요청에는 서버가 준 CSRF 토큰을 머리글로 붙인다.
// - 학생 정보·답안은 이 기능과 관계없이 학생 브라우저에만 저장되며 서버로 보내지 않는다.
import { h } from './util/dom.js';

let session = null; // { expiresAt, csrfToken, storage }

/** @returns {Promise<{authenticated:boolean, expiresAt?, csrfToken?, storage?, error?, code?}>} */
export async function checkSession() {
  try {
    const res = await fetch('/api/teacher/session', { credentials: 'same-origin', cache: 'no-store' });
    const j = await res.json().catch(() => null);
    if (res.ok && j?.authenticated) { session = j; return j; }
    session = null;
    if (!j) return { authenticated: false, code: 'unavailable', error: '교사 로그인 서버에 연결할 수 없습니다. 이 주소에서는 교사 화면을 쓸 수 없습니다(정적 호스팅만 있는 경우).' };
    return { authenticated: false, ...j };
  } catch {
    session = null;
    return { authenticated: false, code: 'unavailable', error: '교사 로그인 서버에 연결할 수 없습니다.' };
  }
}

export const currentSession = () => session;

/** 인증이 필요한 요청(쿠키 + CSRF). 401이면 세션 만료로 보고 onExpired 호출 */
export async function teacherFetch(path, { method = 'GET', body, onExpired } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && session?.csrfToken) headers['X-CSRF-Token'] = session.csrfToken;
  let res;
  try {
    res = await fetch(path, { method, headers, credentials: 'same-origin', cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body) });
  } catch { return { ok: false, status: 0, error: '서버에 연결하지 못했습니다.' }; }
  const j = await res.json().catch(() => ({}));
  if (res.status === 401) { session = null; onExpired?.(); }
  return { ok: res.ok, status: res.status, ...j };
}

export async function logout() {
  await fetch('/api/teacher/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': session?.csrfToken || '' } }).catch(() => {});
  session = null;
}

/**
 * 로그인 화면. 성공하면 onSuccess(session)
 * @param {HTMLElement} container
 * @param {{title?:string, message?:string, onSuccess:(s)=>void, purpose?:string}} o
 */
export function renderLogin(container, { title = '교사용 로그인', message = '', onSuccess, purpose = '교사용 평가 설정과 미리보기' }) {
  container.innerHTML = '';
  const card = h('section', { class: 'card login-card', id: 't-login', 'aria-labelledby': 't-login-h' });
  const err = h('p', { class: 'form-error', id: 't-login-error', role: 'alert', hidden: !message }, message || '');
  const pw = h('input', { type: 'password', id: 't-password', name: 'password', autocomplete: 'current-password', required: true, maxlength: 256, 'aria-describedby': 't-login-error' });
  const btn = h('button', { type: 'submit', class: 'btn btn-primary', id: 't-login-btn' }, '로그인');
  const form = h('form', { id: 't-login-form', novalidate: true },
    h('label', { for: 't-password' }, h('b', {}, '교사 비밀번호')), pw, btn);
  card.append(
    h('h1', { id: 't-login-h' }, title),
    h('p', {}, `이 화면(${purpose})은 선생님만 쓸 수 있습니다. 비밀번호는 서버에서만 확인하며, 로그인은 일정 시간이 지나면 끝납니다.`),
    form, err,
    h('p', { class: 'muted small' }, '학생은 로그인하지 않습니다. 학생 화면은 처음 주소(/)에서 그대로 쓰며, 학생 답안은 학생 브라우저에만 저장됩니다.'),
    h('p', { class: 'small' }, h('a', { href: './' }, '← 학생 화면으로')));
  container.append(card);
  pw.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!pw.value) { err.hidden = false; err.textContent = '비밀번호를 입력하세요.'; pw.focus(); return; }
    btn.disabled = true;
    btn.textContent = '확인 중…';
    let res, j;
    try {
      res = await fetch('/api/teacher/login', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ password: pw.value }),
      });
      j = await res.json().catch(() => ({}));
    } catch { j = { error: '로그인 서버에 연결하지 못했습니다.' }; }
    pw.value = '';
    btn.disabled = false;
    btn.textContent = '로그인';
    if (res?.ok && j.ok) {
      session = j;
      onSuccess?.(j);
      return;
    }
    err.hidden = false;
    err.textContent = j.error || '로그인하지 못했습니다.';
    pw.focus();
  });
}

/** 남은 시간 표시 "오후 3:20까지" */
export function expiryText(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}까지`;
}

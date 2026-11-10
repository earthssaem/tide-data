// 학생 화면 첫 관문: 입장 코드를 넣어야 앱(평가 시작 안내 포함)이 열린다.
// - 학생용 배포 설정(data/assessment.json)의 entry(확인값)가 있을 때만 묻는다. 교사 화면·교사용 미리보기는 묻지 않는다.
// - 한 번 통과하면 이 탭(sessionStorage)에서는 다시 묻지 않는다(새로고침 포함). 탭·브라우저를 새로 열면 다시 묻는다.
// - 코드는 서버로 보내지 않고 브라우저 안에서 확인한다(정적 웹앱이라 화면 앞을 막는 장치 — 자료 파일까지 막지는 못함).
import { checkEntry, sanitizeEntry, cryptoReady } from '../setup/entry.js';
import { SETUP_URL } from '../setup/setup.js';

export const ENTRY_OK_KEY = 'tideLab.entryOk';
let resolveReady;
/** 입장 코드를 통과했거나(또는 묻지 않는 경우) 풀리는 약속 — main.js와 평가 모드가 이것을 기다린다 */
export const entryReady = new Promise((r) => { resolveReady = r; });

const gateMode = () => { try { const m = new URLSearchParams(location.search).get('mode'); return m !== 'teacher' && m !== 'preview'; } catch { return true; } };
const ss = () => { try { return window.sessionStorage; } catch { return null; } };

async function run() {
  if (!gateMode()) return resolveReady();
  let entry = null;
  try {
    const r = await fetch(SETUP_URL, { cache: 'no-cache' });
    if (r.ok) entry = sanitizeEntry((await r.json())?.entry);
  } catch { /* 설정을 못 읽으면 앱이 오류를 보여 줌 */ }
  if (!entry || ss()?.getItem(ENTRY_OK_KEY) === entry.hash) return resolveReady();
  if (document.readyState === 'loading') await new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true }));
  show(entry);
}

function show(entry) {
  const wrap = document.createElement('div');
  wrap.id = 'entry-gate';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-labelledby', 'entry-title');
  wrap.innerHTML = `
    <form class="entry-card" novalidate>
      <p class="entry-kicker">조석 데이터 탐구실</p>
      <h1 id="entry-title">입장 코드</h1>
      <p class="entry-lead">선생님이 알려 준 입장 코드를 입력하세요.</p>
      <input id="entry-code" name="code" type="password" inputmode="numeric" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="12" aria-describedby="entry-msg" required>
      <p id="entry-msg" class="entry-msg" role="alert" hidden></p>
      <button type="submit" class="entry-btn" id="entry-submit">입장</button>
    </form>`;
  document.body.append(wrap);
  for (const el of document.body.children) if (el !== wrap && el.tagName !== 'SCRIPT') el.setAttribute('inert', '');
  const form = wrap.querySelector('form');
  const input = wrap.querySelector('#entry-code');
  const msg = wrap.querySelector('#entry-msg');
  const btn = wrap.querySelector('#entry-submit');
  const say = (t) => { msg.textContent = t; msg.hidden = !t; };
  if (!cryptoReady()) { say('이 주소에서는 입장 코드를 확인할 수 없습니다. 선생님께 알려 주세요(보안 연결 https 필요).'); btn.disabled = true; input.disabled = true; return; }
  let fails = 0;
  input.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (btn.disabled) return;
    if (!input.value.trim()) { say('입장 코드를 입력하세요.'); input.focus(); return; }
    btn.disabled = true; say('확인 중…');
    const ok = await checkEntry(entry, input.value);
    if (ok) {
      try { ss()?.setItem(ENTRY_OK_KEY, entry.hash); } catch { /* 저장 못 해도 이번에는 통과 */ }
      for (const el of document.body.children) if (el !== wrap) el.removeAttribute('inert');
      wrap.remove();
      resolveReady();
      return;
    }
    fails++;
    input.value = '';
    // 여러 번 틀리면 잠깐 기다리게 해 마구 넣어 보기를 줄인다
    const wait = fails >= 3 ? Math.min(30, 2 ** (fails - 2)) : 0;
    say(wait ? `입장 코드가 맞지 않습니다. ${wait}초 뒤에 다시 입력하세요.` : '입장 코드가 맞지 않습니다.');
    setTimeout(() => { btn.disabled = false; input.focus(); if (wait) say('입장 코드가 맞지 않습니다. 다시 입력하세요.'); }, wait * 1000);
  });
}

run();

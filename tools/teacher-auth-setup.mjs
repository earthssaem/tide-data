#!/usr/bin/env node
// 교사 로그인 환경변수 값 만들기 — 선생님 컴퓨터에서 직접 실행한다(비밀번호는 화면에 보이지 않음).
//   npm run teacher:setup               → 비밀번호를 두 번 입력받아 TEACHER_PASSWORD_HASH와 TEACHER_SESSION_SECRET 값을 출력
//   npm run teacher:setup -- --write-local → 같은 값을 .env.local(git 제외)에 써서 로컬 확인 서버에서 쓴다
// 비밀번호는 명령줄 인자로 받지 않는다(셸 기록에 남지 않게). 출력한 값은 Vercel 환경변수에 붙여 넣고, 저장소에는 넣지 않는다.
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, newSessionSecret, verifyPassword } from '../api/_lib/auth.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const writeLocal = process.argv.includes('--write-local');

function askHidden(prompt) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      // 자동화(파이프) 입력: 첫 줄
      let buf = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (d) => { buf += d; });
      stdin.on('end', () => resolve(buf.split(/\r?\n/)[0]));
      stdin.on('error', reject);
      return;
    }
    process.stderr.write(prompt);
    let s = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); process.stderr.write('\n'); resolve(s); return; }
        if (c === '\u0003') { stdin.setRawMode(false); process.stderr.write('\n취소했습니다.\n'); process.exit(1); }
        if (c === '\u007f' || c === '\b') { s = s.slice(0, -1); continue; }
        s += c;
      }
    };
    stdin.on('data', onData);
  });
}

const pw = await askHidden('교사 비밀번호(12자 이상, 화면에 보이지 않음): ');
if (process.stdin.isTTY) {
  const pw2 = await askHidden('한 번 더 입력: ');
  if (pw !== pw2) { console.error('두 비밀번호가 다릅니다. 다시 실행하세요.'); process.exit(1); }
}
if (!pw || pw.length < 12) { console.error('비밀번호는 12자 이상으로 정하세요(학생이 짐작하기 어려운 문장 권장).'); process.exit(1); }
if (pw.length > 256) { console.error('비밀번호가 너무 깁니다(256자 이하).'); process.exit(1); }

const hash = await hashPassword(pw);
if (!(await verifyPassword(pw, hash))) { console.error('검증값을 만들지 못했습니다.'); process.exit(1); }
const secret = newSessionSecret();

if (writeLocal) {
  const file = join(ROOT, '.env.local');
  const keep = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l && !/^(TEACHER_PASSWORD_HASH|TEACHER_SESSION_SECRET)=/.test(l)) : [];
  writeFileSync(file, [...keep, `TEACHER_PASSWORD_HASH=${hash}`, `TEACHER_SESSION_SECRET=${secret}`, ''].join('\n'), { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* 무시 */ }
  console.error('.env.local에 저장했습니다(git에 올라가지 않음). npm start로 로컬에서 교사 로그인을 확인하세요.');
} else {
  console.error('\n아래 두 값을 Vercel → Project → Settings → Environment Variables에 각각 넣으세요(Sensitive 권장).');
  console.error('비밀번호 자체는 어디에도 넣지 않습니다. 이 값들도 저장소·채팅에 붙여 넣지 마세요.\n');
  console.log(`TEACHER_PASSWORD_HASH=${hash}`);
  console.log(`TEACHER_SESSION_SECRET=${secret}`);
}

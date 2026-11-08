#!/usr/bin/env node
// 로컬 확인용 서버: node tools/serve.mjs [포트]
// - 정적 파일(학생용 앱)은 학교 웹 서버·GitHub Pages·Vercel 등 어떤 정적 호스팅에서도 동작한다.
// - /api/teacher/* (교사 로그인)는 Vercel 서버 기능과 같은 코드(api/)를 여기서도 실행한다.
//   로컬에서는 .env.local(git 제외)의 TEACHER_* 값을 쓰며, 없으면 교사 로그인은 거부된다.
// - 점(.)으로 시작하는 파일·폴더(.env.local, .secrets 등)는 절대 내보내지 않는다.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, dirname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};

// .env.local 읽기(이미 정해진 환경변수는 덮어쓰지 않음). 값은 화면·로그에 출력하지 않는다.
const envFile = join(ROOT, '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (!(m[1] in process.env) && v) process.env[m[1]] = v;
  }
}

const API = /^\/api\/teacher\/([a-z]+)$/;

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const api = API.exec(path);
  if (api) {
    const file = join(ROOT, 'api', 'teacher', `${api[1]}.js`);
    if (!existsSync(file)) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"ok":false}'); return; }
    try {
      const mod = await import(pathToFileURL(file).href);
      await mod.default(req, res);
    } catch {
      if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"ok":false,"error":"server error"}'); }
    }
    return;
  }
  try {
    let p = decodeURIComponent(path);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(ROOT, p));
    const rel = file.slice(ROOT.length);
    if (!file.startsWith(ROOT + sep) || rel.split(sep).some((seg) => seg.startsWith('.'))) { res.writeHead(404); res.end('Not found'); return; }
    const s = await stat(file);
    if (!s.isFile()) throw new Error('not file');
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}).listen(PORT, () => console.log(`조석 데이터 탐구실: http://localhost:${PORT}/  (교사 로그인 설정: ${process.env.TEACHER_PASSWORD_HASH && process.env.TEACHER_SESSION_SECRET ? '있음' : '없음 — 교사 화면 접근 거부'})`));

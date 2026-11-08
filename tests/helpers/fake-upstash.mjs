// 시험용 가짜 Upstash Redis REST 서버(메모리). /pipeline만 지원: GET SET(EX) INCR EXPIRE(NX) TTL DEL EXISTS
import { createServer } from 'node:http';

export function startFakeUpstash({ token = 'test-token', port = 0 } = {}) {
  const data = new Map(); // key → { v, exp(ms|null) }
  const live = (k) => { const e = data.get(k); if (!e) return null; if (e.exp && e.exp <= Date.now()) { data.delete(k); return null; } return e; };
  const run = ([cmd, ...a]) => {
    switch (String(cmd).toUpperCase()) {
      case 'GET': return live(a[0])?.v ?? null;
      case 'SET': { const i = a.findIndex((x) => String(x).toUpperCase() === 'EX'); data.set(a[0], { v: String(a[1]), exp: i > 0 ? Date.now() + Number(a[i + 1]) * 1000 : null }); return 'OK'; }
      case 'INCR': { const e = live(a[0]) || { v: '0', exp: null }; e.v = String(Number(e.v) + 1); data.set(a[0], e); return Number(e.v); }
      case 'EXPIRE': { const e = live(a[0]); if (!e) return 0; if (String(a[2] || '').toUpperCase() === 'NX' && e.exp) return 0; e.exp = Date.now() + Number(a[1]) * 1000; return 1; }
      case 'TTL': { const e = live(a[0]); if (!e) return -2; return e.exp ? Math.ceil((e.exp - Date.now()) / 1000) : -1; }
      case 'DEL': return data.delete(a[0]) ? 1 : 0;
      case 'EXISTS': return live(a[0]) ? 1 : 0;
      default: return { error: `unknown ${cmd}` };
    }
  };
  const server = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}` || req.url !== '/pipeline' || req.method !== 'POST') { res.writeHead(401); res.end('{"error":"unauthorized"}'); return; }
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const out = JSON.parse(b).map((c) => { const r = run(c); return r && r.error ? r : { result: r }; });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`, token, data, close: () => new Promise((r) => server.close(r)),
  })));
}

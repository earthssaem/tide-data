// 수집 원본 응답 보관: 낱개 파일(<자료>/<관측소>/<YYYYMMDD>/page-N.json)을
// 자료·관측소·월별 묶음(packs/<자료>-<관측소>-<YYYY-MM>.json.gz)으로 압축해 저장소에 둔다.
// 읽을 때는 낱개 파일이 있으면 그것을, 없으면 묶음에서 같은 경로를 찾는다(내용은 원본 그대로).
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

const cache = new Map();

/** 'hourly/DT_0005/20251001/page-1.json' → 'packs/hourly-DT_0005-2025-10.json.gz' */
export function packPathFor(rel) {
  const m = /^([^/]+)\/([^/]+)\/(\d{4})(\d{2})\d{2}\/[^/]+$/.exec(rel.replace(/\\/g, '/'));
  if (!m) return null;
  return `packs/${m[1]}-${m[2]}-${m[3]}-${m[4]}.json.gz`;
}

function loadPack(rawDir, pack) {
  const key = join(rawDir, pack);
  if (!cache.has(key)) {
    if (!existsSync(key)) cache.set(key, null);
    else cache.set(key, JSON.parse(gunzipSync(readFileSync(key)).toString('utf8')).files);
  }
  return cache.get(key);
}

/** 원본 응답 한 쪽(JSON 객체) 읽기 */
export function readRawPage(rawDir, rel) {
  const p = join(rawDir, rel);
  if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  const pack = packPathFor(rel);
  const files = pack ? loadPack(rawDir, pack) : null;
  if (!files || !files[rel]) throw new Error(`원본 응답을 찾을 수 없습니다: ${rel}`);
  return files[rel];
}

function walk(dir, base = dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, base, out);
    else if (e.endsWith('.json')) out.push(p.slice(base.length + 1).replace(/\\/g, '/'));
  }
  return out;
}

/**
 * 낱개 원본 폴더들 → 하나의 보관 폴더(manifest.json + packs/)
 * @param {string[]} srcDirs 각 폴더에 manifest.json과 <자료>/<관측소>/<날짜>/page-N.json
 */
export function packRaw(srcDirs, outDir) {
  const manifest = { format: 'khoa-raw-manifest', version: 1, packed: true, requests: {}, updatedAt: null, sources: [] };
  const packs = new Map();
  for (const src of srcDirs) {
    const m = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'));
    for (const [k, v] of Object.entries(m.requests)) manifest.requests[k] = v;
    if (!manifest.updatedAt || (m.updatedAt && m.updatedAt > manifest.updatedAt)) manifest.updatedAt = m.updatedAt;
    for (const rel of walk(src)) {
      if (!rel.includes('/')) continue; // manifest.json 등
      const pack = packPathFor(rel);
      if (!pack) continue;
      if (!packs.has(pack)) packs.set(pack, {});
      packs.get(pack)[rel] = JSON.parse(readFileSync(join(src, rel), 'utf8'));
    }
    const f = join(src, 'failures.jsonl');
    if (existsSync(f)) manifest.sources.push({ dir: src.split('/').slice(-1)[0], failures: readFileSync(f, 'utf8').split('\n').filter(Boolean).length });
  }
  mkdirSync(join(outDir, 'packs'), { recursive: true });
  let bytes = 0;
  for (const [pack, files] of [...packs].sort()) {
    const sorted = Object.fromEntries(Object.entries(files).sort());
    const buf = gzipSync(JSON.stringify({ format: 'khoa-raw-pack', version: 1, files: sorted }), { level: 9 });
    mkdirSync(dirname(join(outDir, pack)), { recursive: true });
    writeFileSync(join(outDir, pack), buf);
    bytes += buf.length;
  }
  manifest.requests = Object.fromEntries(Object.entries(manifest.requests).sort());
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  return { packs: packs.size, bytes, requests: Object.keys(manifest.requests).length };
}

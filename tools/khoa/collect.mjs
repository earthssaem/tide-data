#!/usr/bin/env node
// 국립해양조사원 조위 자료 자동 수집기 (공공데이터포털 오픈API)
//
// 사용 예
//   하루 시험:   node tools/khoa/collect.mjs --test-day 2022-09-01
//   한 달 수집:  node tools/khoa/collect.mjs --start 2022-09-01 --end 2022-09-30
//   실패만 재시도: 같은 명령을 다시 실행(성공한 날은 건너뜀). --retry-failed도 같은 뜻
//   전부 다시:   --force
//
// 인증키(공공데이터포털 '일반 인증키')는 코드·저장소에 넣지 않는다. 아래 중 하나로 넘긴다.
//   1) 환경 변수 DATA_GO_KR_SERVICE_KEY
//   2) 환경 변수 DATA_GO_KR_SERVICE_KEY_FILE = 키가 한 줄 들어 있는 파일 경로
//   3) 저장소 안의 .secrets/data-go-kr.key (.gitignore로 제외됨)
// Encoding 키와 Decoding 키 어느 쪽을 넣어도 된다.
//
// 결과
//   data/raw/khoa/<자료>/<관측소>/<YYYYMMDD>/page-<n>.json  원본 응답(인증키 제거한 요청 정보 포함)
//   data/raw/khoa/manifest.json                            요청별 상태(ok / nodata / failed)
//   data/raw/khoa/failures.jsonl                           실패한 시도 기록(시각, 오류)

import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  DATASETS, MAX_ROWS, DAILY_TRAFFIC_DEV, RETRYABLE, FATAL, normalizeServiceKey, redactUrl, buildUrl, parseResponse, dateRange,
} from './khoa-api.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// 프록시 환경(학교망·클라우드)에서는 Node fetch가 HTTPS_PROXY를 쓰도록 다시 실행
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, ['--no-warnings', ...process.execArgv, fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
  });
  process.exit(r.status ?? 1);
}

// ───────── 옵션 ─────────
function parseArgs(argv) {
  const o = {
    station: 'DT_0005', stationName: '부산', asosStation: '159', datasets: ['hourly', 'forecast', 'realtime'],
    out: join(ROOT, 'data', 'raw', 'khoa'), delayMs: 300, retries: 4, backoffMs: 2000, timeoutMs: 30000,
    retryFailed: false, force: false, baseUrl: null, testDay: null, start: null, end: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === '--station') o.station = v();
    else if (a === '--asos-station') o.asosStation = v(); // 기상청 ASOS 지점번호(부산 159)
    else if (a === '--station-name') o.stationName = v();
    else if (a === '--datasets') o.datasets = v().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--start') o.start = v();
    else if (a === '--end') o.end = v();
    else if (a === '--test-day') o.testDay = v();
    else if (a === '--out') o.out = v();
    else if (a === '--delay-ms') o.delayMs = Number(v());
    else if (a === '--retries') o.retries = Number(v());
    else if (a === '--backoff-ms') o.backoffMs = Number(v());
    else if (a === '--retry-failed') o.retryFailed = true;
    else if (a === '--force') o.force = true;
    else if (a === '--base-url') o.baseUrl = v(); // 검증용(가짜 서버) — 실제 수집에는 쓰지 않음
    else if (a === '--help' || a === '-h') { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 22).join('\n')); process.exit(0); }
    else throw new Error(`알 수 없는 옵션: ${a}`);
  }
  for (const d of o.datasets) if (!DATASETS[d]) throw new Error(`알 수 없는 자료: ${d} (가능: ${Object.keys(DATASETS).join(', ')})`);
  if (o.testDay) { o.start = o.testDay; o.end = o.testDay; }
  if (!o.start || !o.end) throw new Error('--test-day 또는 --start/--end가 필요합니다.');
  return o;
}

function loadKey() {
  if (process.env.DATA_GO_KR_SERVICE_KEY) return { key: normalizeServiceKey(process.env.DATA_GO_KR_SERVICE_KEY), from: '환경 변수 DATA_GO_KR_SERVICE_KEY' };
  const f = process.env.DATA_GO_KR_SERVICE_KEY_FILE || join(ROOT, '.secrets', 'data-go-kr.key');
  if (existsSync(f)) return { key: normalizeServiceKey(readFileSync(f, 'utf8')), from: `파일 ${process.env.DATA_GO_KR_SERVICE_KEY_FILE ? '(DATA_GO_KR_SERVICE_KEY_FILE)' : '.secrets/data-go-kr.key'}` };
  return { key: '', from: null };
}

/** 자료별 관측소 코드(조위관측소 DT_xxxx / 기상청 ASOS 지점번호) */
const stationFor = (o, ds) => (ds.stationOption ? o[ds.stationOption] : o.station);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class FatalError extends Error {}

// ───────── 상태 기록 ─────────
function loadManifest(out) {
  const p = join(out, 'manifest.json');
  if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  return { format: 'khoa-collect-manifest', version: 1, requests: {} };
}
function saveManifest(out, m) {
  m.updatedAt = new Date().toISOString();
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(m, null, 1));
}
function logFailure(out, entry) {
  appendFileSync(join(out, 'failures.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
}

// ───────── 요청 ─────────
async function fetchOnce(url, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { Accept: 'application/json' } });
    const text = await res.text();
    return { status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

/** 한 페이지 요청(재시도 포함) */
async function fetchPage(o, ds, key, date, pageNo, ctx) {
  const reqDate = date.replace(/-/g, '');
  const url = buildUrl(ds, { serviceKey: key, obsCode: stationFor(o, ds), reqDate, pageNo, numOfRows: MAX_ROWS, baseUrl: o.baseUrl });
  let last = null;
  for (let attempt = 1; attempt <= o.retries; attempt++) {
    ctx.calls++;
    let status = null, text = '', r;
    try {
      ({ status, text } = await fetchOnce(url, o.timeoutMs));
      r = parseResponse(text);
      if (status >= 500) r = { ...r, ok: false, codeName: r.ok ? 'HTTP_5XX' : r.codeName };
    } catch (e) {
      r = { ok: false, code: '', codeName: 'NETWORK', message: e.cause?.code || e.name || e.message, items: [] };
    }
    last = { status, text, r, attempt, url: redactUrl(url) };
    if (r.ok || r.codeName === 'NODATA_ERROR') return last;
    logFailure(o.out, { dataset: ds.key, station: stationFor(o, ds), date, pageNo, attempt, httpStatus: status, code: r.code, codeName: r.codeName, message: r.message, url: redactUrl(url) });
    if (FATAL.has(r.codeName)) { const err = new FatalError(r.message || r.codeName); err.res = last; throw err; }
    if (!RETRYABLE.has(r.codeName) || attempt === o.retries) return last;
    await sleep(o.backoffMs * 2 ** (attempt - 1));
  }
  return last;
}

function savePage(o, ds, date, pageNo, res) {
  const dir = join(o.out, ds.key, stationFor(o, ds), date.replace(/-/g, ''));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `page-${pageNo}.json`);
  writeFileSync(file, JSON.stringify({
    request: {
      dataset: ds.key, datasetTitle: ds.title, datasetId: ds.datasetId, endpoint: ds.endpoint,
      url: res.url, station: stationFor(o, ds), reqDate: date.replace(/-/g, ''), pageNo, numOfRows: MAX_ROWS, attempt: res.attempt,
      fetchedAt: new Date().toISOString(),
    },
    http: { status: res.status },
    result: { code: res.r.code, codeName: res.r.codeName, message: res.r.message, totalCount: res.r.totalCount ?? null, pageNo: res.r.pageNo ?? null, numOfRows: res.r.numOfRows ?? null, itemCount: res.r.items.length },
    rawText: res.text, // 원본 응답 그대로
  }, null, 1));
  return relative(o.out, file); // 수집 폴더 기준 상대 경로
}

/** 하루치(여러 페이지) 수집 */
async function collectDay(o, ds, key, date, ctx) {
  const files = [];
  let items = 0, total = null, pageNo = 1;
  for (; pageNo <= 50; pageNo++) {
    if (ctx.calls > 0) await sleep(o.delayMs);
    let res;
    try {
      res = await fetchPage(o, ds, key, date, pageNo, ctx);
    } catch (e) {
      if (e.res) savePage(o, ds, date, pageNo, e.res); // 인증·트래픽 오류 응답도 원본 보관
      throw e;
    }
    files.push(savePage(o, ds, date, pageNo, res));
    if (!res.r.ok) {
      if (res.r.codeName === 'NODATA_ERROR') return { status: pageNo === 1 ? 'nodata' : 'ok', pages: pageNo, items, totalCount: total, files, lastError: null };
      return { status: 'failed', pages: pageNo, items, totalCount: total, files, lastError: `${res.r.codeName} ${res.r.message}`.trim() };
    }
    items += res.r.items.length;
    total = res.r.totalCount;
    if (res.r.items.length === 0) break;
    if (total != null ? items >= total : res.r.items.length < MAX_ROWS) break;
  }
  return { status: 'ok', pages: pageNo, items, totalCount: total, files, lastError: null };
}

function summarizeTestDay(o, ds, date) {
  const dir = join(o.out, ds.key, stationFor(o, ds), date.replace(/-/g, ''));
  const page = JSON.parse(readFileSync(join(dir, 'page-1.json'), 'utf8'));
  const r = parseResponse(page.rawText);
  const items = r.items;
  const times = items.map((it) => it[ds.timeField]).filter(Boolean).sort();
  const names = [...new Set(items.map((it) => it.obsvtrNm ?? it.stnNm))];
  const sample = items.slice(0, 3).map((it) => Object.fromEntries(Object.entries(it).filter(([k]) => ['obsvtrNm', 'stnNm', ds.timeField, ...Object.values(ds.valueFields), ...Object.values(ds.qcFields || {})].includes(k))));
  return { resultCode: r.code, resultMsg: r.message, totalCount: r.totalCount, rows: items.length, stationNames: names, firstTime: times[0] || null, lastTime: times[times.length - 1] || null, sameDay: times.length ? times.every((t) => t.startsWith(date)) : null, sample };
}

// ───────── 실행 ─────────
async function main() {
  const o = parseArgs(process.argv.slice(2));
  const { key, from } = loadKey();
  if (!key) {
    console.error('인증키가 없습니다. 공공데이터포털에서 발급받은 일반 인증키를 환경 변수 DATA_GO_KR_SERVICE_KEY로 설정하세요.\n(자세한 방법: tools/khoa/README.md)');
    process.exit(2);
  }
  mkdirSync(o.out, { recursive: true });
  const dates = dateRange(o.start, o.end);
  const manifest = loadManifest(o.out);
  manifest.station = o.station;
  manifest.stationName = o.stationName;
  const ctx = { calls: 0 };
  console.log(`인증키: ${from}에서 읽음(값은 출력하지 않음)`);
  console.log(`관측소 ${o.station}(${o.stationName})${o.datasets.includes('asos') ? `, ASOS 지점 ${o.asosStation}` : ''}, 기간 ${o.start} ~ ${o.end} (${dates.length}일), 자료: ${o.datasets.join(', ')}`);
  const plannedCalls = dates.length * o.datasets.length;
  if (plannedCalls > DAILY_TRAFFIC_DEV) console.warn(`⚠ 예상 호출 ${plannedCalls}건이 개발계정 일일 트래픽(${DAILY_TRAFFIC_DEV})을 넘습니다. 기간을 나눠 실행하세요.`);
  const fatals = {}; // 자료별 중단 사유(인증키 미등록·트래픽 초과는 서비스마다 따로 적용됨)
  let anyKeyMissing = false;
  for (const dsKey of o.datasets) {
    const ds = DATASETS[dsKey];
    const st = stationFor(o, ds);
    for (const date of dates) {
      const id = `${dsKey}|${st}|${date}`;
      const prev = manifest.requests[id];
      if (fatals[dsKey]) {
        // 같은 서비스는 나머지 날짜도 실패할 것이므로 요청하지 않고 대기로 둔다
        if (!prev || (prev.status !== 'ok' && prev.status !== 'nodata')) manifest.requests[id] = { dataset: dsKey, station: st, date, status: 'pending', lastError: fatals[dsKey], attempts: prev?.attempts || 0 };
        continue;
      }
      // 기본: 이미 성공(ok)했거나 자료없음(nodata)으로 확인된 날은 건너뛰고, 실패·대기·미수집만 요청(이어서 수집)
      if (prev && !o.force && (prev.status === 'ok' || prev.status === 'nodata')) continue;
      try {
        const r = await collectDay(o, ds, key, date, ctx);
        manifest.requests[id] = { dataset: dsKey, station: st, date, ...r, attempts: (prev?.attempts || 0) + 1, at: new Date().toISOString() };
        console.log(`${dsKey.padEnd(8)} ${date}  ${r.status.padEnd(6)} 행 ${String(r.items).padStart(4)}${r.totalCount != null ? `/${r.totalCount}` : ''}${r.lastError ? `  (${r.lastError})` : ''}`);
      } catch (e) {
        if (!(e instanceof FatalError)) throw e;
        manifest.requests[id] = { dataset: dsKey, station: st, date, status: 'failed', lastError: e.message, attempts: (prev?.attempts || 0) + 1, at: new Date().toISOString() };
        fatals[dsKey] = e.message;
        if (/SERVICE_KEY_IS_NULL/.test(e.message)) anyKeyMissing = true;
        console.error(`${dsKey.padEnd(8)} ${date}  중단: ${e.message} — 이 자료의 나머지 날짜는 '대기'로 둡니다.`);
      }
      saveManifest(o.out, manifest);
    }
    saveManifest(o.out, manifest);
    if (anyKeyMissing) break;
  }
  const fatal = Object.keys(fatals).length ? Object.entries(fatals).map(([k, m]) => `${k}: ${m}`).join(' / ') : null;
  if (fatal) console.error(`\n일부 자료 수집을 멈췄습니다 — ${fatal}\n해당 서비스의 활용신청·승인, 인증키, 일일 트래픽을 확인한 뒤 같은 명령을 다시 실행하세요.`);
  const reqs = Object.values(manifest.requests).filter((r) => r.station === stationFor(o, DATASETS[r.dataset] || {}) && dates.includes(r.date) && o.datasets.includes(r.dataset));
  const count = (s) => reqs.filter((r) => r.status === s).length;
  console.log(`\n요청 ${reqs.length}건: 성공 ${count('ok')}, 자료없음 ${count('nodata')}, 실패 ${count('failed')}, 대기 ${count('pending')} · 이번 실행 API 호출 ${ctx.calls}회`);
  if (o.testDay) {
    console.log('\n── 하루 시험 결과 ──');
    for (const dsKey of o.datasets) {
      const st = manifest.requests[`${dsKey}|${stationFor(o, DATASETS[dsKey])}|${o.testDay}`];
      if (!st || st.status === 'failed') { console.log(`${dsKey}: 실패 ${st?.lastError || ''}`); continue; }
      console.log(`${dsKey}:`, JSON.stringify(summarizeTestDay(o, DATASETS[dsKey], o.testDay), null, 1));
    }
  }
  process.exit(fatal || count('failed') ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

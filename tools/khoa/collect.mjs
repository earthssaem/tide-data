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
    else if (a === '--plan') o.plan = v(); // data/stations/plan.json: 여러 관측소와 짝지은 ASOS
    else if (a === '--stations') o.onlyStations = v().split(',').map((x) => x.trim()); // 계획 중 일부만
    else if (a === '--station-name') o.stationName = v();
    else if (a === '--datasets') o.datasets = v().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--start') { o.start = v(); o.startGiven = true; }
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
  if (o.testDay) { o.start = o.testDay; o.end = o.testDay; o.startGiven = true; }
  if (!o.plan && (!o.start || !o.end)) throw new Error('--test-day 또는 --start/--end(또는 --plan)가 필요합니다.');
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
/** 수집할 관측소 목록: --plan(여러 관측소) 또는 --station(한 곳) */
function stationList(o) {
  if (!o.plan) return [{ code: o.station, name: o.stationName, asosStn: o.asosStation }];
  const plan = JSON.parse(readFileSync(o.plan, 'utf8'));
  let list = plan.stations.map((s) => ({ code: s.code, name: s.name, asosStn: s.asos?.stn || null }));
  if (o.onlyStations) list = list.filter((s) => o.onlyStations.includes(s.code));
  if (!o.startGiven && plan.period) { o.start = plan.period.start; o.end = plan.period.end; }
  return list;
}

async function collectStation(o, st, dates, key, manifest, ctx, fatals) {
  o.station = st.code;
  o.stationName = st.name;
  o.asosStation = st.asosStn;
  console.log(`\n■ ${st.code} ${st.name}${o.datasets.includes('asos') ? ` · ASOS ${st.asosStn || '없음'}` : ''}`);
  for (const dsKey of o.datasets) {
    const ds = DATASETS[dsKey];
    if (ds.stationOption && !o[ds.stationOption]) { console.log(`${dsKey.padEnd(8)} 건너뜀: 짝지은 지점 없음`); continue; }
    const stc = stationFor(o, ds);
    for (const date of dates) {
      const id = `${dsKey}|${stc}|${date}`;
      const prev = manifest.requests[id];
      // 이미 성공(ok)했거나 자료없음(nodata)으로 확인된 요청은 다시 보내지 않는다(부산 등 기존 자료 재사용)
      if (prev && !o.force && (prev.status === 'ok' || prev.status === 'nodata')) continue;
      if (fatals[dsKey]) {
        manifest.requests[id] = { dataset: dsKey, station: stc, date, status: 'pending', lastError: fatals[dsKey], attempts: prev?.attempts || 0 };
        continue;
      }
      try {
        const r = await collectDay(o, ds, key, date, ctx);
        manifest.requests[id] = { dataset: dsKey, station: stc, date, ...r, attempts: (prev?.attempts || 0) + 1, at: new Date().toISOString() };
        console.log(`${dsKey.padEnd(8)} ${date}  ${r.status.padEnd(6)} 행 ${String(r.items).padStart(4)}${r.totalCount != null ? `/${r.totalCount}` : ''}${r.lastError ? `  (${r.lastError})` : ''}`);
      } catch (e) {
        if (!(e instanceof FatalError)) throw e;
        manifest.requests[id] = { dataset: dsKey, station: stc, date, status: 'failed', lastError: e.message, attempts: (prev?.attempts || 0) + 1, at: new Date().toISOString() };
        // 인증키 미등록·트래픽 초과는 서비스 단위 → 다른 관측소에서도 같은 서비스는 요청하지 않음
        fatals[dsKey] = e.message;
        console.error(`${dsKey.padEnd(8)} ${date}  중단: ${e.message} — 이 서비스의 나머지 요청은 '대기'로 둡니다.`);
      }
      saveManifest(o.out, manifest);
    }
    saveManifest(o.out, manifest);
  }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const { key, from } = loadKey();
  if (!key) {
    console.error('인증키가 없습니다. 공공데이터포털에서 발급받은 일반 인증키를 환경 변수 DATA_GO_KR_SERVICE_KEY로 설정하세요.\n(자세한 방법: tools/khoa/README.md)');
    process.exit(2);
  }
  mkdirSync(o.out, { recursive: true });
  const stations = stationList(o);
  const dates = dateRange(o.start, o.end);
  const manifest = loadManifest(o.out);
  const ctx = { calls: 0 };
  console.log(`인증키: ${from}에서 읽음(값은 출력하지 않음)`);
  console.log(`관측소 ${stations.length}곳, 기간 ${o.start} ~ ${o.end} (${dates.length}일), 자료: ${o.datasets.join(', ')}`);
  const plannedCalls = dates.length * o.datasets.length * stations.length;
  if (plannedCalls > DAILY_TRAFFIC_DEV) console.warn(`⚠ 최대 예상 호출 ${plannedCalls}건이 서비스별 개발계정 일일 트래픽(${DAILY_TRAFFIC_DEV})을 넘을 수 있습니다. 넘으면 그 서비스만 멈추고, 다음 날 같은 명령으로 이어서 받습니다.`);
  const fatals = {};
  const stationErrors = [];
  for (const st of stations) {
    try {
      await collectStation(o, st, dates, key, manifest, ctx, fatals);
    } catch (e) {
      // 한 관측소에서 예기치 않은 오류가 나도 다른 관측소는 계속
      stationErrors.push(`${st.code}: ${e.message}`);
      console.error(`${st.code} 수집 중 오류: ${e.message} — 다음 관측소로 넘어갑니다.`);
    }
    if (Object.values(fatals).some((m) => /SERVICE_KEY_IS_NULL/.test(m))) break;
  }
  saveManifest(o.out, manifest);
  const fatal = Object.keys(fatals).length ? Object.entries(fatals).map(([k, m]) => `${k}: ${m}`).join(' / ') : null;
  if (fatal) console.error(`\n일부 서비스 수집을 멈췄습니다 — ${fatal}\n해당 서비스의 활용신청·승인, 인증키, 일일 트래픽을 확인한 뒤 같은 명령을 다시 실행하세요.`);
  // 요약(관측소 × 자료)
  console.log('\n── 관측소별 요약 (성공/자료없음/실패/대기, 일 단위) ──');
  let failed = 0;
  for (const st of stations) {
    const cells = o.datasets.map((dsKey) => {
      const ds = DATASETS[dsKey];
      const stc = ds.stationOption ? st.asosStn : st.code;
      if (!stc) return `${dsKey} -`;
      const rs = dates.map((d) => manifest.requests[`${dsKey}|${stc}|${d}`]?.status || 'none');
      const c = (s) => rs.filter((x) => x === s).length;
      failed += c('failed');
      return `${dsKey} ${c('ok')}/${c('nodata')}/${c('failed')}/${c('pending') + c('none')}`;
    });
    console.log(`${st.code} ${st.name.padEnd(4)} ${cells.join('  ')}`);
  }
  console.log(`이번 실행 API 호출 ${ctx.calls}회${stationErrors.length ? ` · 관측소 오류 ${stationErrors.length}건` : ''}`);
  if (o.testDay) {
    console.log('\n── 하루 시험 결과 ──');
    for (const st of stations) {
      o.station = st.code; o.stationName = st.name; o.asosStation = st.asosStn;
      for (const dsKey of o.datasets) {
        const ds = DATASETS[dsKey];
        if (ds.stationOption && !st.asosStn) continue;
        const r = manifest.requests[`${dsKey}|${stationFor(o, ds)}|${o.testDay}`];
        if (!r || r.status === 'failed' || r.status === 'pending') { console.log(`${st.code} ${dsKey}: ${r?.status || '없음'} ${r?.lastError || ''}`); continue; }
        if (r.status === 'nodata') { console.log(`${st.code} ${dsKey}: 자료 없음(NODATA)`); continue; }
        console.log(`${st.code} ${dsKey}:`, JSON.stringify(summarizeTestDay(o, ds, o.testDay)));
      }
    }
  }
  process.exit(fatal || failed || stationErrors.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

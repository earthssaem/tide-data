#!/usr/bin/env node
// 여러 관측소 사례 만들기: 수집 원본(data/raw/khoa) + 관측소 계획(data/stations/plan.json)
//   → data/cases/<사례>/case.json (stations 목록) + stations/<코드>/*.csv + 자료 확보 현황 보고서
//
//   node tools/khoa/build-multi.mjs --plan data/stations/plan.json --case-id khoa-multi-2022-09
//   (--set-default: 학생 앱 기본 사례로 지정, --default-station DT_0005: 처음 선택 관측소)
//
// 원칙: 없는 값은 만들지 않는다 / 관측 조위가 있으면 예측·기상이 없어도 관측소를 제공한다 /
// 기상은 관측소 자체 관측 우선, 없으면 그 관측소와 짝지은 ASOS / 기준면·시간대는 미확인으로 표시

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATASETS, dateRange } from './khoa-api.mjs';
import { loadDataset, buildSeries, hourlyCompleteness, addDays, pickRange, fmtNum } from './build-case.mjs';
import { buildWeather, buildTyphoon } from './weather-build.mjs';
import { moonPhasesBetween } from '../lib/moon.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function args(argv) {
  const o = {
    raw: join(ROOT, 'data', 'raw', 'khoa'), casesDir: join(ROOT, 'data', 'cases'), plan: join(ROOT, 'data', 'stations', 'plan.json'),
    caseId: null, setDefault: false, defaultStation: null, typhoon: '힌남노(HINNAMNOR)', typhoonYear: 2022,
    typhoonDir: join(ROOT, 'data', 'raw', 'kma', 'typhoon', '2022-11'), minCm: -300, maxCm: 1500, weather: 'auto',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => argv[++i];
    if (a === '--plan') o.plan = v();
    else if (a === '--raw') o.raw = v();
    else if (a === '--cases-dir') o.casesDir = v();
    else if (a === '--case-id') o.caseId = v();
    else if (a === '--set-default') o.setDefault = true;
    else if (a === '--default-station') o.defaultStation = v();
    else if (a === '--typhoon-dir') o.typhoonDir = v();
    else if (a === '--no-typhoon') o.typhoonDir = null;
    else if (a === '--inq1') o.inq1 = v();
    else if (a === '--inq3') o.inq3 = v();
    else throw new Error(`알 수 없는 옵션: ${a}`);
  }
  return o;
}

const haversine = (a, b, c, d) => {
  const R = 6371.0088, t = (x) => (x * Math.PI) / 180;
  const h = Math.sin(t(c - a) / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(t(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

function seriesCsv(src, code, name, field, series) {
  return [
    `# 출처: 국립해양조사원, ${DATASETS[src].title} (data.go.kr ${DATASETS[src].datasetId})`,
    `# 관측소 ${code}(${name}), 단위 cm(문서 명시), 시각: 응답 그대로(시간대 미확인 — KST로 해석), 높이 기준면: 미확인`,
    '# qc: 1 응답값 / 3 오류·충돌(값 비움) / 9 응답에 값 없음. 응답에 없는 시각은 행을 만들지 않음',
    `time,${field},qc`,
    ...series.map((p) => `${p.time},${fmtNum(p.value)},${p.flag === 'ok' ? 1 : p.flag === 'missing' ? 9 : 3}`),
  ].join('\n') + '\n';
}

function tideSpec(file, kind, label, code, src, field) {
  return {
    file, adapter: 'csv-tide', kind, label, stationId: code,
    datum: 'UNCONFIRMED', datumLabel: '미확인', datumConfirmed: false,
    unit: 'cm', intervalMinutes: 60, time: { column: 'time', offset: '+09:00' }, value: { column: field },
    quality: { column: 'qc', ok: ['1'], bad: ['3'], missing: ['9'], labels: { 1: '응답값', 3: '오류·충돌', 9: '값 없음' } },
    missingValues: [''],
    meta: { provider: '국립해양조사원', title: `${DATASETS[src].title}`, identifier: `data.go.kr ${DATASETS[src].datasetId}` },
  };
}

const rangeText = (r) => `${r.from.slice(5)}~${r.to.slice(r.from.slice(0, 10) === r.to.slice(0, 10) ? 11 : 5)}(${r.hours}h)`;

function main() {
  const o = args(process.argv.slice(2));
  const plan = JSON.parse(readFileSync(o.plan, 'utf8'));
  const manifestPath = join(o.raw, 'manifest.json');
  if (!existsSync(manifestPath)) { console.error('수집 기록(manifest.json)이 없습니다. 먼저 수집하세요.'); process.exit(2); }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const { start, end } = plan.period;
  const dates = dateRange(start, end);
  o.caseId = o.caseId || `khoa-multi-${start.slice(0, 7)}`;
  const outDir = join(o.casesDir, o.caseId);
  mkdirSync(outDir, { recursive: true });

  const typhoon = o.typhoonDir ? buildTyphoon({ ...o, typhoonDir: o.typhoonDir }, outDir) : null;
  const tyAnalysis = typhoon ? readFileSync(join(outDir, 'typhoon_track.csv'), 'utf8').split('\n').filter((l) => /^\d{4}-/.test(l)).map((l) => l.split(',')).map((r) => ({ t: r[0], lat: Number(r[1]), lon: Number(r[2]) })) : [];

  const stations = [];
  const report = [];
  for (const ps of plan.stations) {
    const so = { ...o, station: ps.code, stationName: ps.name, asosStation: ps.asos?.stn || null };
    const loaded = {};
    for (const k of ['hourly', 'forecast', 'realtime']) loaded[k] = loadDataset(so, manifest, k, dates);
    const has = (k) => loaded[k].rows.length > 0;
    const obsSrc = has('hourly') ? 'hourly' : has('realtime') ? 'realtime' : null;
    const predSrc = has('forecast') ? 'forecast' : has('realtime') ? 'realtime' : null;
    const statusCount = (k) => Object.values(loaded[k].days).reduce((a, s) => { a[s] = (a[s] || 0) + 1; return a; }, {});
    const rep = { code: ps.code, name: ps.name, sea: ps.sea, status: { hourly: statusCount('hourly'), forecast: statusCount('forecast'), realtime: statusCount('realtime') } };
    report.push(rep);
    if (!obsSrc) { rep.ready = false; rep.reason = '관측 조위 원본 없음'; continue; }

    const sdir = join(outDir, 'stations', ps.code);
    mkdirSync(sdir, { recursive: true });
    const obs = buildSeries(so, loaded[obsSrc], DATASETS[obsSrc].valueFields.tide_cm, '관측 조위');
    const obsComp = hourlyCompleteness(obs.series, dates, loaded[obsSrc].days);
    writeFileSync(join(sdir, 'observed.csv'), seriesCsv(obsSrc, ps.code, ps.name, 'tide_cm', obs.series));
    let pred = null, predComp = null;
    if (predSrc) {
      pred = buildSeries(so, loaded[predSrc], DATASETS[predSrc].valueFields.pred_cm, '예측 조위');
      predComp = hourlyCompleteness(pred.series, dates, loaded[predSrc].days);
      writeFileSync(join(sdir, 'predicted.csv'), seriesCsv(predSrc, ps.code, ps.name, 'pred_cm', pred.series));
    }
    const names = Object.keys(obs.names);
    const coords = Object.keys(obs.coords);
    const asosInfo = ps.asos ? { name: ps.asos.name, lat: ps.asos.lat, lon: ps.asos.lon, elevation_m: ps.asos.elevation_m, address: ps.asos.address, source: plan.sources.asosStations } : null;
    const weather = buildWeather(so, manifest, dates, { tideStation: { lat: ps.lat, lon: ps.lon }, asosStationInfo: asosInfo });
    if (weather.source) {
      writeFileSync(join(sdir, 'weather.csv'), weather.csv);
      weather.spec.file = `stations/${ps.code}/weather.csv`;
      if (weather.source === 'asos' && ps.asos) {
        weather.spec.station.note = `조위관측소에서 ${ps.asos.distKm} km · 해발 ${ps.asos.elevation_m} m · 기압계 지상높이 ${ps.asos.barometerHeight_m ?? '미확인'} m · ${ps.asos.address} · 가장 가까운 ASOS로 선정`;
      }
    }
    // 관측소별 태풍 최근접 실황 분석 위치
    let closest = null;
    for (const p of tyAnalysis) {
      const d = haversine(ps.lat, ps.lon, p.lat, p.lon);
      if (!closest || d < closest.d) closest = { ...p, d };
    }
    const stationKeyTimes = closest && dates.includes(closest.t.slice(0, 10)) ? [{ time: closest.t, label: `최근접 분석 위치(${closest.d.toFixed(0)} km)`, note: `기상청 태풍정보 실황 분석 위치 중 ${ps.name} 조위관측소에 가장 가까운 시각(분석 간격 사이에 실제 최근접이 있을 수 있음)` }] : [];

    const unconfirmed = ['높이 기준면', '시간대(KST로 해석)'];
    if (weather.source === 'khoa') unconfirmed.push('조위관측소 기상 자료 단위·기압 종류');
    if (weather.source) unconfirmed.push('기상 자료 시간대');
    stations.push({
      id: ps.code, name: ps.name, nameEn: ps.nameEn, sea: ps.sea, lat: ps.lat, lon: ps.lon, note: ps.note,
      responseNames: names, responseCoords: coords,
      datasets: {
        observed: tideSpec(`stations/${ps.code}/observed.csv`, 'observed', '관측 조위', ps.code, obsSrc, 'tide_cm'),
        predicted: pred ? tideSpec(`stations/${ps.code}/predicted.csv`, 'predicted', '천문조 예측 조위', ps.code, predSrc, 'pred_cm') : { provided: false },
        weather: weather.source ? weather.spec : { provided: false },
      },
      weatherSource: weather.source ? { type: weather.source, station: weather.station, distKm: weather.source === 'asos' ? ps.asos?.distKm ?? null : 0 } : null,
      keyTimes: stationKeyTimes,
      unconfirmed,
    });
    Object.assign(rep, {
      ready: true, obsSrc, predSrc, names, obs: obsComp, obsIssues: obs.issues.length, pred: predComp,
      weather: weather.source ? { source: weather.source, station: weather.station.name, distKm: weather.source === 'asos' ? ps.asos?.distKm : 0, completeness: weather.completeness } : null,
      weatherStatus: weather.status, asos: ps.asos, unconfirmed,
    });
  }
  if (!stations.length) { console.error('관측 조위가 있는 관측소가 없습니다. 사례 파일을 만들지 않습니다.'); process.exit(3); }

  // 달의 위상(계산값)
  const KST = 9 * 3600e3;
  const t0 = Date.parse(`${start}T00:00:00Z`) - KST - 20 * 86400e3, t1 = Date.parse(`${end}T00:00:00Z`) - KST + 20 * 86400e3;
  const NAMES = { new: '삭', first: '상현', full: '망', last: '하현' };
  const iso = (t) => new Date(Math.round(t / 60000) * 60000 + KST).toISOString().slice(0, 16).replace('T', ' ');
  writeFileSync(join(outDir, 'moon.csv'), ['# 달의 위상 시각(KST): Meeus 계산식으로 계산한 값(오차 약 1~2분). 공식 자료(한국천문연구원)로 확인·교체 권장', 'time,phase,lunar',
    ...moonPhasesBetween(t0, t1).map((p) => `${iso(p.t)},${NAMES[p.phase]},`)].join('\n') + '\n');

  const builtAt = new Date().toISOString();
  const defaultStation = o.defaultStation && stations.some((s) => s.id === o.defaultStation) ? o.defaultStation : (stations.find((s) => s.id === 'DT_0005') || stations[0]).id;
  const ref = stations.find((s) => s.id === defaultStation);
  const sharedKeys = (typhoon?.keyTimes || []).filter((k) => !/최근접/.test(k.label) && dates.includes(k.time.slice(0, 10)));
  const caseJson = {
    formatVersion: 2,
    id: o.caseId,
    dataVersion: `${o.caseId}-${builtAt.slice(0, 10)}`,
    isSample: false,
    title: `우리나라 조위관측소 비교 · ${start.slice(0, 4)}년 ${Number(start.slice(5, 7))}월`,
    timezone: { label: 'KST', name: '한국 표준시(UTC+9) — API 문서에 시간대 미기재(미확인), KST로 해석', offsetMinutes: 540 },
    station: { id: ref.id, name: ref.name, lat: ref.lat, lon: ref.lon },
    defaultStation,
    stations,
    description: {
      provider: '국립해양조사원(KHOA)·기상청(KMA), 공공데이터포털 오픈API 및 기상자료개방포털',
      title: '조위관측소별 1시간 조위(조석성과)와 기상 관측',
      period: `${start} ~ ${end}`,
      interval: '1시간',
      datumLabel: '미확인(관측소마다 각자의 기준면 — 관측소끼리 절대 높이 비교 불가)',
      datumSource: '',
      identifier: `${o.caseId} (변환 ${builtAt.slice(0, 10)})`,
      stationList: plan.sources.tideStations,
      weatherRule: plan.rule,
    },
    datasets: {
      observed: ref.datasets.observed, predicted: ref.datasets.predicted, weather: ref.datasets.weather,
      moonPhases: { file: 'moon.csv', adapter: 'csv-moon', time: { column: 'time', offset: '+09:00' }, phaseColumn: 'phase', lunarColumn: 'lunar', meta: { provider: 'Meeus 계산식으로 계산한 값(공식 자료 아님)', title: '달의 위상 시각(계산값)', identifier: 'moon-calc-meeus' } },
      typhoon: typhoon ? typhoon.spec : { provided: false },
    },
    inquiry1: pickRange(o.inq1, ['2022-09-13', '2022-09-16'], dates, 3),
    inquiry2: { start: `${start} 00:00`, end: `${addDays(end, 1)} 00:00` },
    inquiry3: { ...pickRange(o.inq3, ['2022-09-04', '2022-09-08'], dates, 5), keyTimes: sharedKeys },
  };
  writeFileSync(join(outDir, 'case.json'), JSON.stringify(caseJson, null, 2) + '\n');

  // 자료 확보 현황 보고서
  const pct = (c) => (c ? `${c.valid}/${c.expected}` : '—');
  const wxCell = (r, kinds) => {
    if (!r.weather) return '없음';
    const vals = kinds.map((k) => r.weather.completeness[k]).filter(Boolean);
    return vals.length ? vals.map((c) => `${c.label} ${c.valid}/${c.expected}`).join(', ') : '없음';
  };
  const rows = report.map((r) => r.ready
    ? `| ${r.code} ${r.name} | ${r.sea} | ${pct(r.obs)}${r.obs.ranges.length ? `<br>결측 ${r.obs.ranges.map(rangeText).slice(0, 4).join(', ')}${r.obs.ranges.length > 4 ? ' …' : ''}` : ''} | ${r.pred ? pct(r.pred) : `없음 (${Object.entries(r.status.forecast).map(([k, v]) => `${k} ${v}`).join(', ')})`} | ${wxCell(r, ['pressureSea', 'pressureStation', 'pressure'])} | ${wxCell(r, ['windSpeed', 'windDir'])} | ${r.weather ? `${r.weather.station}${r.weather.distKm ? ` (${r.weather.distKm} km)` : ' (같은 관측소)'}` : r.asos ? `미수집 — 짝 ASOS ${r.asos.stn} ${r.asos.name} (${r.asos.distKm} km)` : '—'} | ${r.unconfirmed.join(', ')} |`
    : `| ${r.code} ${r.name} | ${r.sea} | 없음 (${Object.entries(r.status.hourly).map(([k, v]) => `${k} ${v}`).join(', ')}) | — | — | — | — | 관측 조위 원본 없음 → 제공 안 함 |`);
  const md = `# 관측소별 자료 확보 현황 — ${o.caseId}

- 기간: ${start} ~ ${end} (${dates.length}일, 시간 자료 기대값 ${dates.length * 24}개)
- 관측소 목록 출처: ${plan.sources.tideStations}
- 기상 연결 규칙: ${plan.rule}
- 만든 시각: ${builtAt}

| 관측소 | 해역 | 관측 조위 | 예측 조위 | 기압 | 풍속·풍향 | 기상 관측 지점 | 확인되지 않은 정보 |
|---|---|---|---|---|---|---|---|
${rows.join('\n')}

- 숫자는 \`값이 있는 시간 수/기대 시간 수\`. 결측은 채우지 않았습니다.
- 예측 조위 '없음'의 괄호는 일별 수집 상태(ok·nodata·failed·pending·not-collected).
- 관측소마다 조위의 높이 기준면이 다를 수 있고 아직 확인되지 않았으므로, 관측소끼리 조위 숫자를 직접 비교해 어느 지역 해수면이 더 높다고 해석할 수 없습니다. 비교할 수 있는 것은 같은 관측소 안에서의 변동 폭·주기·시각입니다.
${typhoon ? `- 태풍: ${typhoon.meta.typhoon} 실황 분석 위치 ${typhoon.meta.analysisPoints}개(관측소별 최근접 분석 위치는 각 관측소 주요 시각에 표시), 예보 위치는 typhoon_forecast.csv에 따로 보관` : ''}
`;
  writeFileSync(join(outDir, 'availability.md'), md);
  writeFileSync(join(outDir, 'availability.json'), JSON.stringify({ builtAt, period: plan.period, stations: report }, null, 1));

  const regPath = join(o.casesDir, 'index.json');
  const reg = existsSync(regPath) ? JSON.parse(readFileSync(regPath, 'utf8')) : { formatVersion: 1, defaultCase: o.caseId, cases: [] };
  reg.cases = reg.cases.filter((c) => c.id !== o.caseId);
  reg.cases.push({ id: o.caseId, path: o.caseId, label: `${caseJson.title} (국립해양조사원·기상청 자료)`, enabled: true });
  if (o.setDefault) reg.defaultCase = o.caseId;
  writeFileSync(regPath, JSON.stringify(reg, null, 2) + '\n');

  console.log(`사례: ${relative(ROOT, outDir)}/ · 관측소 ${stations.length}곳 제공 (${report.filter((r) => !r.ready).map((r) => `${r.code} 제외`).join(', ') || '제외 없음'})`);
  console.log(md.split('\n').filter((l) => l.startsWith('|')).join('\n'));
}

main();

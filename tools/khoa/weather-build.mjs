// 기상·태풍 자료 → 웹앱 사례 파일
// - 기상: 같은 조위관측소(국립해양조사원 실측 기압·풍향/풍속)를 우선 사용하고, 없으면 기상청 ASOS(부산 159)를 쓴다.
// - 해면기압과 현지기압은 서로 다른 열·항목으로 두고 섞지 않는다.
// - 결측·오류(품질 플래그 1·9)는 채우지 않는다.
// - 태풍: 기상청 태풍정보의 실황 분석 위치(예보시간 0)만 경로로 쓰고, 예보 위치는 별도 파일로 둔다.

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATASETS, parseResponse } from './khoa-api.mjs';
import { readRawPage } from '../lib/rawpack.mjs';

const stationFor = (o, ds) => (ds.stationOption ? o[ds.stationOption] : o.station);

export function loadRaw(o, manifest, dsKey, dates) {
  const ds = DATASETS[dsKey];
  const st = stationFor(o, ds);
  const days = {};
  const items = [];
  for (const date of dates) {
    const r = manifest.requests[`${dsKey}|${st}|${date}`];
    days[date] = r ? r.status : 'not-collected';
    if (!r || r.status !== 'ok') continue;
    for (const f of r.files || []) {
      const page = readRawPage(o.raw, f);
      const p = parseResponse(page.rawText);
      if (p.ok) for (const it of p.items) items.push({ date, it });
    }
  }
  return { ds, days, items };
}

export function canonicalHour(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2})(?::(\d{2}))?(?::(\d{2}))?$/.exec(String(s || '').trim());
  if (!m) return null;
  return { key: `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5] || '00'}`, onHour: (m[5] || '00') === '00' && (m[6] || '00') === '00' };
}

function num(v) {
  const s = String(v ?? '').trim();
  if (s === '' || s === '-' || s.toLowerCase() === 'null') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function hoursOf(dates) {
  const out = [];
  for (const d of dates) for (let h = 0; h < 24; h++) out.push(`${d} ${String(h).padStart(2, '0')}:00`);
  return out;
}

function ranges(times) {
  const out = [];
  for (const t of times) {
    const last = out[out.length - 1];
    const cur = Date.parse(`${t.replace(' ', 'T')}:00Z`);
    if (last && cur - Date.parse(`${last.to.replace(' ', 'T')}:00Z`) === 3600e3) { last.to = t; last.hours++; } else out.push({ from: t, to: t, hours: 1 });
  }
  return out;
}

const COLS = {
  pressure: 'pressure_hpa', pressureSea: 'pressure_sea_hpa', pressureStation: 'pressure_station_hpa', windSpeed: 'wind_ms', windDir: 'wind_dir_deg',
};
const RANGE = { pressure: [850, 1100], pressureSea: [850, 1100], pressureStation: [800, 1100], windSpeed: [0, 75], windDir: [0, 360] };
const LABEL = { pressure: '기압', pressureSea: '해면기압', pressureStation: '현지기압', windSpeed: '풍속', windDir: '풍향' };

/**
 * @returns {null | {source, sourceTitles, station, fields, rows, completeness, issues, notes, spec, csv}}
 */
export function buildWeather(o, manifest, dates, { tideStation, asosStationInfo }) {
  const khoaP = loadRaw(o, manifest, 'airpress', dates);
  const khoaW = loadRaw(o, manifest, 'wind', dates);
  const asos = loadRaw(o, manifest, 'asos', dates);
  let source = o.weather;
  if (source === 'auto') source = khoaP.items.length && khoaW.items.length ? 'khoa' : asos.items.length ? 'asos' : khoaP.items.length || khoaW.items.length ? 'khoa' : null;
  if (!source || source === 'none') return { source: null, status: { airpress: khoaP.days, wind: khoaW.days, asos: asos.days } };

  const issues = [];
  const notes = [];
  const byTime = new Map();
  const qcByTime = new Map();
  const put = (time, kind, v, qc) => {
    const row = byTime.get(time) || {};
    if (kind in row && row[kind] !== v) { issues.push({ type: '중복(값 충돌, 결측 처리)', detail: `${time} ${LABEL[kind]}: ${row[kind]} / ${v}` }); row[kind] = null; }
    else if (kind in row) issues.push({ type: '중복(같은 값)', detail: `${time} ${LABEL[kind]}` });
    else row[kind] = v;
    byTime.set(time, row);
    if (qc != null) { const q = qcByTime.get(time) || {}; q[kind] = qc; qcByTime.set(time, q); }
  };
  const take = (items, map, qcMap) => {
    for (const { date, it } of items) {
      const ct = canonicalHour(it[DATASETS[items.dsKey]?.timeField] ?? it.obsrvnDt ?? it.tm);
      if (!ct) { issues.push({ type: '시각 형식 오류', detail: `${date}: ${JSON.stringify(it.obsrvnDt ?? it.tm)}` }); continue; }
      if (!ct.onHour) { issues.push({ type: '정시가 아닌 시각(제외)', detail: ct.key }); continue; }
      if (!ct.key.startsWith(date)) issues.push({ type: '요청일과 다른 날짜', detail: `${date} → ${ct.key}` });
      for (const [kind, field] of Object.entries(map)) {
        let v = num(it[field]);
        if (v === undefined) { issues.push({ type: '숫자가 아닌 값(결측 처리)', detail: `${ct.key} ${LABEL[kind]}: ${it[field]}` }); v = null; }
        if (v != null && (v < RANGE[kind][0] || v > RANGE[kind][1])) { issues.push({ type: '허용 범위 밖(오류값으로 결측 처리)', detail: `${ct.key} ${LABEL[kind]}: ${v}` }); v = null; }
        const qc = qcMap ? String(it[qcMap[kind]] ?? '').trim() : null;
        put(ct.key, kind, v, qc);
      }
    }
  };

  let station, fields, sourceTitles;
  if (source === 'khoa') {
    sourceTitles = [khoaP.items.length && DATASETS.airpress, khoaW.items.length && DATASETS.wind].filter(Boolean).map((d) => `${d.title} (data.go.kr ${d.datasetId})`);
    take(Object.assign(khoaP.items, { dsKey: 'airpress' }), { pressure: 'atmpr' });
    take(Object.assign(khoaW.items, { dsKey: 'wind' }), { windSpeed: 'wspd', windDir: 'wndrct' });
    const coords = [...khoaP.items, ...khoaW.items].map(({ it }) => `${it.lat},${it.lot}`);
    const [la, lo] = (coords[0] || ',').split(',');
    station = { id: o.station, name: `${o.stationName} 조위관측소(${o.station})`, lat: la ? Number(la) : tideStation.lat, lon: lo ? Number(lo) : tideStation.lon, note: '조위 관측과 같은 관측소의 자동기상관측장비' };
    // 기압 단위는 문서에 없음 → 값 범위로만 판단
    const pv = [...byTime.values()].map((r) => r.pressure).filter((v) => v != null).sort((a, b) => a - b);
    const med = pv.length ? pv[Math.floor(pv.length / 2)] : null;
    fields = {};
    if (khoaP.items.length) {
      if (med != null && med > 900 && med < 1100) {
        fields.pressure = { column: COLS.pressure, unit: 'hPa', label: '기압(종류 미확인)', range: RANGE.pressure, note: `국립해양조사원 조위관측소 기압 — 단위·기압 종류(현지/해면)가 문서에 없음. 값의 중앙값 ${med}로 보아 hPa로 해석` };
        notes.push(`조위관측소 기압: 단위·종류 문서 미기재. 중앙값 ${med} → hPa로 해석, 현지기압인지 해면기압인지는 미확인`);
      } else {
        notes.push(`조위관측소 기압: 값 범위(중앙값 ${med})로 단위를 판단할 수 없어 사용하지 않음`);
      }
    }
    if (khoaW.items.length) {
      fields.windSpeed = { column: COLS.windSpeed, unit: 'm/s', label: '풍속', range: RANGE.windSpeed, note: '국립해양조사원 조위관측소 풍속 — 단위 문서 미기재(m/s로 해석)' };
      fields.windDir = { column: COLS.windDir, unit: 'deg', label: '풍향', range: RANGE.windDir, note: '국립해양조사원 조위관측소 풍향 — 단위 문서 미기재(도, 불어오는 방향으로 해석)' };
      notes.push('조위관측소 풍속·풍향: 단위 문서 미기재(m/s, 도로 해석)');
    }
  } else {
    sourceTitles = [`${DATASETS.asos.title} (data.go.kr ${DATASETS.asos.datasetId})`];
    take(Object.assign(asos.items, { dsKey: 'asos' }), { pressureSea: 'ps', pressureStation: 'pa', windSpeed: 'ws', windDir: 'wd' }, { pressureSea: 'psQcflg', pressureStation: 'paQcflg', windSpeed: 'wsQcflg', windDir: 'wdQcflg' });
    const si = asosStationInfo;
    station = {
      id: `ASOS-${o.asosStation}`, name: `기상청 ${si?.name || ''} ASOS(${o.asosStation})`, lat: si?.lat ?? null, lon: si?.lon ?? null,
      elevation_m: si?.elevation_m ?? null, note: si ? `해발 ${si.elevation_m} m · ${si.address} · 지점정보: ${si.source}` : '지점정보 미확인',
    };
    const qc = (col) => ({ column: col, bad: ['1'], missing: ['9'] });
    fields = {
      pressureSea: { column: COLS.pressureSea, unit: 'hPa', label: '해면기압', range: RANGE.pressureSea, qc: qc('ps_qc'), note: '기상청 ASOS 해면기압(ps) — 해수면 높이로 환산한 기압' },
      pressureStation: { column: COLS.pressureStation, unit: 'hPa', label: '현지기압', range: RANGE.pressureStation, qc: qc('pa_qc'), note: `기상청 ASOS 현지기압(pa) — 관측소 높이(해발 ${si?.elevation_m ?? '미확인'} m)의 기압, 해면기압과 섞지 않음` },
      windSpeed: { column: COLS.windSpeed, unit: 'm/s', label: '풍속', range: RANGE.windSpeed, qc: qc('ws_qc'), note: '기상청 ASOS 풍속(ws, m/s)' },
      windDir: { column: COLS.windDir, unit: 'deg', label: '풍향', range: RANGE.windDir, qc: qc('wd_qc'), note: '기상청 ASOS 풍향(wd) — 활용가이드 표기 "16방위", 불어오는 방향' },
    };
    notes.push('기상청 ASOS: 현지기압(pa)과 해면기압(ps)을 별도 항목으로 저장. 품질 플래그 1(오류)·9(결측)는 앱에서 결측 처리');
    const calm = [...byTime.values()].filter((r) => r.windSpeed === 0 && r.windDir === 0).length;
    if (calm) notes.push(`풍속 0 m/s이면서 풍향 0인 시각 ${calm}개 — 무풍일 수 있으나 문서로 확인하지 못해 값은 그대로 둠`);
  }

  // 완전성
  const hours = hoursOf(dates);
  const completeness = {};
  for (const kind of Object.keys(fields)) {
    const missing = [];
    let flagged = 0;
    for (const t of hours) {
      const v = byTime.get(t)?.[kind];
      const q = qcByTime.get(t)?.[kind];
      const bad = q != null && (q === '1' || q === '9');
      if (bad) flagged++;
      if (v == null || bad) missing.push(t);
    }
    completeness[kind] = { label: fields[kind].label, expected: hours.length, valid: hours.length - missing.length, qcFlagged: flagged, missingRanges: ranges(missing) };
  }

  const qcCol = { pressureSea: 'ps_qc', pressureStation: 'pa_qc', windSpeed: 'ws_qc', windDir: 'wd_qc' };
  const kinds = Object.keys(fields);
  const header = ['time', ...kinds.map((k) => COLS[k]), ...(source === 'asos' ? kinds.map((k) => qcCol[k]) : [])];
  const times = [...byTime.keys()].filter((t) => dates.includes(t.slice(0, 10))).sort();
  const csv = [
    `# 출처: ${sourceTitles.join(' / ')}`,
    `# 관측 지점: ${station.name}${station.note ? ` — ${station.note}` : ''}`,
    `# 시각: 응답 그대로(문서에 시간대 미기재 — KST로 해석). 결측·오류는 빈 칸 또는 품질 플래그로 남기고 채우지 않음`,
    header.join(','),
    ...times.map((t) => {
      const r = byTime.get(t), q = qcByTime.get(t) || {};
      return [t, ...kinds.map((k) => (r[k] == null ? '' : r[k])), ...(source === 'asos' ? kinds.map((k) => q[k] ?? '') : [])].join(',');
    }),
  ].join('\n') + '\n';

  const spec = {
    file: 'weather.csv', adapter: 'csv-weather', intervalMinutes: 60, station,
    time: { column: 'time', offset: '+09:00' },
    fields: Object.fromEntries(kinds.map((k) => [k, fields[k]])),
    missingValues: [''],
    meta: { provider: source === 'asos' ? '기상청' : '국립해양조사원', title: sourceTitles.join(' / '), identifier: source === 'asos' ? `data.go.kr ${DATASETS.asos.datasetId}, ASOS ${o.asosStation}` : `data.go.kr ${DATASETS.airpress.datasetId}/${DATASETS.wind.datasetId}` },
  };
  return { source, sourceTitles, station, fields, completeness, issues, notes, spec, csv, rows: byTime, qc: qcByTime, status: { airpress: khoaP.days, wind: khoaW.days, asos: asos.days } };
}

/** 태풍 실황 분석 경로·예보 파일 복사 및 주요 시각 */
export function buildTyphoon(o, outDir) {
  const dir = o.typhoonDir;
  if (!dir || !existsSync(join(dir, 'typhoon_analysis_kst.csv'))) return null;
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  copyFileSync(join(dir, 'typhoon_analysis_kst.csv'), join(outDir, 'typhoon_track.csv'));
  copyFileSync(join(dir, 'typhoon_forecast_kst.csv'), join(outDir, 'typhoon_forecast.csv'));
  const c = meta.closestAnalysisToStation;
  const keyTimes = [];
  // 상륙·진출 시각: 기상청 발표를 인용한 언론 보도(원 보도자료 미확인) — 교사가 기상청 태풍 보고서로 확인 권장
  if (meta.year === 2022 && meta.no === 11) {
    keyTimes.push({ time: '2022-09-06 04:50', label: '거제 부근 상륙', note: '기상청 발표를 인용한 언론 보도(뉴시스 등). 기상청 원 보도자료로 확인 권장' });
  }
  if (c) keyTimes.push({ time: c.time_kst, label: `최근접 분석 위치(${c.dist_km} km)`, note: `기상청 태풍정보 실황 분석 위치 중 부산 조위관측소에 가장 가까운 시각. ${c.note}` });
  if (meta.year === 2022 && meta.no === 11) {
    keyTimes.push({ time: '2022-09-06 07:10', label: '울산 앞바다 진출', note: '기상청 발표를 인용한 언론 보도(뉴시스 등). 기상청 원 보도자료로 확인 권장' });
  }
  keyTimes.sort((a, b) => (a.time < b.time ? -1 : 1));
  return {
    meta,
    keyTimes,
    spec: {
      name: o.typhoon, year: o.typhoonYear,
      note: `${meta.typhoon}. 경로는 기상청 태풍정보의 실황 분석 위치(예보 아님). 예보 위치는 typhoon_forecast.csv에 따로 보관.`,
      track: {
        file: 'typhoon_track.csv', kind: '실황 분석 위치(기상청 태풍정보)',
        note: '기상청이 발표 때마다 분석한 태풍 중심 위치(예보시간 0)입니다. 예보 경로가 아니며, 사후 재분석한 베스트트랙도 아닙니다.',
        time: { column: 'time', offset: '+09:00' }, latColumn: 'lat', lonColumn: 'lon', pressureColumn: 'pressure_hpa', windColumn: 'max_wind_ms',
      },
      meta: { provider: '기상청 기상자료개방포털(data.kma.go.kr) 태풍정보', title: `${meta.typhoon} 태풍정보(실황 분석·예보)`, identifier: `KMA typhoon ${meta.year}-${String(meta.no).padStart(2, '0')}, 수집 ${meta.fetchedAt.slice(0, 10)}` },
    },
  };
}

/** 시간대 정황 확인: 기압 최저 시각과 태풍 최근접 분석 시각 비교(참고) */
export function pressureMinCheck(weather, typhoon) {
  if (!weather?.source || !typhoon?.meta?.closestAnalysisToStation) return null;
  const kind = ['pressureSea', 'pressure', 'pressureStation'].find((k) => weather.fields[k]);
  if (!kind) return null;
  let min = null;
  for (const [t, r] of weather.rows) {
    const q = weather.qc.get(t)?.[kind];
    if (r[kind] == null || q === '1' || q === '9') continue;
    if (!min || r[kind] < min.v) min = { t, v: r[kind] };
  }
  if (!min) return null;
  const c = typhoon.meta.closestAnalysisToStation.time_kst;
  const diffH = (Date.parse(`${min.t.replace(' ', 'T')}:00Z`) - Date.parse(`${c.replace(' ', 'T')}:00Z`)) / 3600e3;
  return { pressureKind: weather.fields[kind].label, minTime: min.t, minValue: min.v, closestAnalysisKst: c, diffHours: diffH, note: '기압 최저 시각이 최근접 분석 시각(KST)과 몇 시간 차이인지 — 시간대 해석의 정황 자료일 뿐 증명은 아님' };
}

export function writeWeather(outDir, w) {
  writeFileSync(join(outDir, 'weather.csv'), w.csv);
}

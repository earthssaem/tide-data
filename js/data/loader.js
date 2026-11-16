// 사례(case) 불러오기
// data/cases/index.json : 사례 목록
// data/cases/<사례폴더>/case.json : 사례 설정 (관측소, 기간, 태풍, 데이터셋 정의)
// 화면 코드는 이 파일이 돌려주는 CaseData만 사용한다.

import {
  normalizeTideSeries, normalizeWeather, normalizeMoonPhases, normalizeTyphoonTrack,
} from './normalize.js';
import { haversineKm } from '../analysis/geo.js';

export const CASES_BASE = 'data/cases/';

/** 기본 fetch 기반 텍스트 읽기 (Node 테스트에서는 파일 읽기 함수로 대체) */
async function defaultReadText(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path} 파일을 불러오지 못했습니다 (HTTP ${res.status}).`);
  return res.text();
}

export async function loadRegistry(readText = defaultReadText, base = CASES_BASE) {
  const reg = JSON.parse(await readText(base + 'index.json'));
  if (!Array.isArray(reg.cases)) throw new Error('사례 목록(index.json) 형식이 올바르지 않습니다.');
  return reg;
}

/**
 * 사례 하나를 불러온다(형식 3: 수행평가 사례).
 * 관측 조위는 필수, 나머지 자료는 없으면 availability=false로 표시하고 값을 만들어 넣지 않는다.
 */
export async function loadCase(entry, readText = defaultReadText, base = CASES_BASE) {
  const dir = base + entry.path.replace(/\/?$/, '/');
  const config = JSON.parse(await readText(dir + 'case.json'));
  return buildAssessData(config, (file) => readText(dir + file));
}

/**
 * 수행평가 사례 자료: 관측소별 CaseData(예측·관측 조위, 대표 관측소는 기상) + 과거 비교 기간(관측·기상·태풍)
 * @returns {{config,id,dataVersion,isSample,sampleNotice,tz,timeBasis,months,rep,stationList,st,past,moon,defaults,description,typhoonTracks}}
 */
export async function buildAssessData(config, readFile) {
  if (config.formatVersion !== 3 || config.kind !== 'tide-assessment') throw new Error('이 앱에서 읽을 수 없는 사례 형식입니다(형식 3 수행평가 사례가 필요합니다).');
  const tz = config.timezone;
  const cache = new Map();
  const read = (f) => { if (!cache.has(f)) cache.set(f, readFile(f)); return cache.get(f); };
  const st = {};
  const stationList = [];
  for (const s of config.stations || []) {
    const cd = await buildSingleCase({
      ...config, station: { id: s.id, name: s.name, lat: s.lat, lon: s.lon, note: s.note || '' },
      datasets: { ...s.datasets, moonPhases: config.moonPhases },
    }, read);
    if (!cd.predicted) throw new Error(`${s.name} 예측 조위 자료를 불러오지 못했습니다.`);
    st[s.id] = cd;
    stationList.push({ id: s.id, name: s.name, nameEn: s.nameEn || '', sea: s.sea || '', lat: s.lat, lon: s.lon, timeShiftFlags: s.timeShiftFlags || [] });
  }
  if (!st[config.representative]) throw new Error('대표 관측소 자료가 없습니다.');
  const p = config.past;
  const ps = stationList.find((s) => s.id === p?.stationId) || stationList.find((s) => s.id === config.representative);
  const past = p ? await buildSingleCase({ ...config, station: { id: ps.id, name: ps.name, lat: ps.lat, lon: ps.lon }, datasets: { ...p.datasets, moonPhases: config.moonPhases } }, read) : null;
  if (past) past.label = p.label;
  return {
    config,
    id: config.id,
    dataVersion: config.dataVersion,
    isSample: !!config.isSample,
    sampleNotice: config.sampleNotice || '기능 확인용 예시 데이터',
    title: config.title || '',
    tz,
    timeBasis: config.timeBasis || { confirmed: false },
    months: config.months || [],
    rep: config.representative,
    stationList,
    st,
    past,
    moon: st[config.representative].moon,
    defaults: config.defaults,
    description: config.description || {},
    typhoonTracks: (config.typhoonTracks?.tracks || []).map((t) => ({ name: t.name, source: t.source, points: t.points.map(([k, lat, lon]) => ({ t: Date.parse(`${k.replace(' ', 'T')}:00Z`) - tz.offsetMinutes * 60000, lat, lon })) })),
    typhoonTracksNote: config.typhoonTracks?.note || '',
    weatherSite: config.weatherSite || null,
  };
}

async function buildSingleCase(config, readFile) {
  const tz = config.timezone;
  if (!tz || typeof tz.offsetMinutes !== 'number') throw new Error('사례 설정에 시간대(timezone.offsetMinutes)가 없습니다.');
  const ds = config.datasets || {};
  const issues = [];
  const availability = {};

  async function tryLoad(key, fn) {
    const spec = ds[key];
    if (!spec || spec.provided === false) { availability[key] = false; return null; }
    try {
      const result = await fn(spec);
      availability[key] = true;
      return result;
    } catch (e) {
      availability[key] = false;
      issues.push({ dataset: key, message: e.message });
      return null;
    }
  }

  const observed = await tryLoad('observed', async (s) => normalizeTideSeries(await readFile(s.file), s));
  if (!observed) {
    throw new Error('관측 조위 자료를 불러오지 못했습니다. ' + issues.map((i) => i.message).join(' '));
  }
  const predicted = await tryLoad('predicted', async (s) => normalizeTideSeries(await readFile(s.file), s));
  const predicted10 = await tryLoad('predicted10', async (s) => ({ ...normalizeTideSeries(await readFile(s.file), s), months: s.months || [] }));
  const weather = await tryLoad('weather', async (s) => normalizeWeather(await readFile(s.file), s));
  const moon = await tryLoad('moonPhases', async (s) => normalizeMoonPhases(await readFile(s.file), s));
  const typhoon = await tryLoad('typhoon', async (s) => {
    const track = s.track?.file ? normalizeTyphoonTrack(await readFile(s.track.file), s.track) : { track: [], issues: [] };
    return { name: s.name, year: s.year, note: s.note || '', meta: s.meta || {}, trackKind: s.track?.kind || '', trackNote: s.track?.note || '', track: track.track, issues: track.issues };
  });


  const station = config.station;
  let weatherDistanceKm = null;
  if (weather?.station && station) {
    weatherDistanceKm = haversineKm(station.lat, station.lon, weather.station.lat, weather.station.lon);
  }


  return {
    config,
    id: config.id,
    dataVersion: config.dataVersion,
    isSample: !!config.isSample,
    sampleNotice: config.sampleNotice || '기능 확인용 예시 데이터',
    tz,
    unit: 'cm',
    station,
    observed,
    predicted,
    predicted10,
    weather,
    moon,
    typhoon,
    weatherDistanceKm,
    availability: {
      observed: true,
      predicted: !!predicted,
      weather: !!weather,
      moonPhases: !!moon && moon.phases.length > 0,
      typhoon: !!typhoon,
    },
    issues,
  };
}

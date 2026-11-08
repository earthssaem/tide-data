// 사례(case) 불러오기
// data/cases/index.json : 사례 목록
// data/cases/<사례폴더>/case.json : 사례 설정 (관측소, 기간, 태풍, 데이터셋 정의)
// 화면 코드는 이 파일이 돌려주는 CaseData만 사용한다.

import {
  normalizeTideSeries, normalizeWeather, normalizeMoonPhases, normalizeTyphoonTrack,
} from './normalize.js';
import { computeResidual } from '../analysis/residual.js';
import { parseDateTime } from '../util/time.js';
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

function parseCaseTime(str, tz, what) {
  const t = parseDateTime(str, tz.offsetMinutes);
  if (Number.isNaN(t)) throw new Error(`사례 설정의 ${what} 시각 형식 오류: "${str}"`);
  return t;
}

function parseRange(r, tz, what) {
  if (!r) return null;
  const t0 = parseCaseTime(r.start, tz, what + ' 시작');
  const t1 = parseCaseTime(r.end, tz, what + ' 끝');
  if (!(t1 > t0)) throw new Error(`사례 설정의 ${what} 기간이 올바르지 않습니다.`);
  return [t0, t1];
}

/**
 * 사례 하나를 불러와 CaseData로 만든다.
 * 관측 조위는 필수, 나머지 자료는 없으면 availability=false로 표시하고 값을 만들어 넣지 않는다.
 */
export async function loadCase(entry, readText = defaultReadText, base = CASES_BASE) {
  const dir = base + entry.path.replace(/\/?$/, '/');
  const config = JSON.parse(await readText(dir + 'case.json'));
  return buildCaseData(config, (file) => readText(dir + file));
}

/**
 * 사례 자료 만들기. config.stations가 있으면 여러 관측소 사례:
 * 관측소마다 같은 구조의 CaseData를 만들고, 각 CaseData에 stations 목록(전체)을 붙여 돌려준다.
 * 화면은 지금 고른 관측소의 CaseData만 쓰며, 관측소를 바꾸면 다른 CaseData로 바꿔 끼운다.
 */
export async function buildCaseData(config, readFile) {
  if (!Array.isArray(config.stations)) return buildSingleCase(config, readFile);
  const cache = new Map();
  const cachedRead = (f) => { if (!cache.has(f)) cache.set(f, readFile(f)); return cache.get(f); };
  const list = [];
  const failed = [];
  for (const st of config.stations) {
    const sub = {
      ...config,
      station: { id: st.id, name: st.name, lat: st.lat, lon: st.lon, note: st.note || '' },
      datasets: { ...config.datasets, ...st.datasets },
      inquiry3: config.inquiry3 ? { ...config.inquiry3, keyTimes: [...(config.inquiry3.keyTimes || []), ...(st.keyTimes || [])] } : config.inquiry3,
    };
    try {
      const cd = await buildSingleCase(sub, cachedRead);
      cd.keyTimes.sort((a, b) => a.t - b.t);
      list.push({
        id: st.id, name: st.name, nameEn: st.nameEn || '', sea: st.sea || '', lat: st.lat, lon: st.lon, note: st.note || '',
        weatherSource: st.weatherSource || null, unconfirmed: st.unconfirmed || [], cd,
      });
    } catch (e) {
      failed.push({ id: st.id, name: st.name, error: e.message });
    }
  }
  if (!list.length) throw new Error(`불러올 수 있는 관측소가 없습니다. ${failed.map((f) => `${f.name}: ${f.error}`).join(' / ')}`);
  for (const s of list) {
    s.cd.multi = true;
    s.cd.stations = list;
    s.cd.stationEntry = s;
    s.cd.failedStations = failed;
  }
  return (list.find((s) => s.id === config.defaultStation) || list[0]).cd;
}

/** 여러 관측소 사례에서 관측소 id로 CaseData 찾기(없으면 null) */
export function stationCaseData(cd, id) {
  if (!id || !cd?.stations) return id && cd?.station?.id !== id ? null : cd;
  return cd.stations.find((s) => s.id === id)?.cd || null;
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
  const weather = await tryLoad('weather', async (s) => normalizeWeather(await readFile(s.file), s));
  const moon = await tryLoad('moonPhases', async (s) => normalizeMoonPhases(await readFile(s.file), s));
  const typhoon = await tryLoad('typhoon', async (s) => {
    const track = s.track?.file ? normalizeTyphoonTrack(await readFile(s.track.file), s.track) : { track: [], issues: [] };
    return { name: s.name, year: s.year, note: s.note || '', meta: s.meta || {}, trackKind: s.track?.kind || '', trackNote: s.track?.note || '', track: track.track, issues: track.issues };
  });

  const residual = predicted ? computeResidual(observed, predicted) : { ok: false, problems: ['예측 조위 자료가 제공되지 않았습니다.'], points: [] };

  const station = config.station;
  let weatherDistanceKm = null;
  if (weather?.station && station) {
    weatherDistanceKm = haversineKm(station.lat, station.lon, weather.station.lat, weather.station.lon);
  }

  const ranges = {
    inq1: parseRange(config.inquiry1, tz, '탐구 1'),
    inq2: parseRange(config.inquiry2, tz, '탐구 2'),
    inq3: parseRange(config.inquiry3, tz, '탐구 3'),
  };
  const keyTimes = (config.inquiry3?.keyTimes || []).map((k) => ({
    t: parseCaseTime(k.time, tz, '주요 시각'), label: k.label, note: k.note || '',
  }));

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
    weather,
    moon,
    typhoon,
    residual,
    weatherDistanceKm,
    availability: {
      observed: true,
      predicted: !!predicted,
      residual: residual.ok,
      weather: !!weather,
      moonPhases: !!moon && moon.phases.length > 0,
      typhoon: !!typhoon,
    },
    ranges,
    keyTimes,
    issues,
  };
}

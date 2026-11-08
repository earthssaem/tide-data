// 국립해양조사원(KHOA) 오픈API 정의 — 공공데이터포털(data.go.kr) 게이트웨이
//
// 근거(2026-11-08 확인)
//  - 바다누리 해양정보 서비스 '활용 가이드라인'(https://www.khoa.go.kr/oceandata/openapi/odmi/apiGuideline.do):
//    해양정보 오픈API는 공공데이터포털(data.go.kr)에서 제공받을 수 있다고 안내.
//  - 각 데이터셋 페이지의 Swagger 명세와 '오픈API 활용가이드'(참고문서, HWP)
//    · 15156017 「해양수산부 국립해양조사원_1시간 조위(조석성과)」  https://www.data.go.kr/data/15156017/openapi.do
//    · 15156022 「해양수산부 국립해양조사원_조석예보(시계열)」      https://www.data.go.kr/data/15156022/openapi.do
//    · 15142507 「해양수산부 국립해양조사원_조위관측소 실측·예측 조위 조회」 https://www.data.go.kr/data/15142507/openapi.do
//  - 활용가이드의 관측소 코드표: DT_0005 = 부산
//  - 문서에 명시된 단위: cm. 문서에 명시되지 않은 것: 높이 기준면, 시간대, 과거 자료 제공 범위.

export const DATASETS = {
  hourly: {
    key: 'hourly',
    title: '해양수산부 국립해양조사원_1시간 조위(조석성과)',
    datasetId: '15156017',
    pageUrl: 'https://www.data.go.kr/data/15156017/openapi.do',
    kind: 'observed',
    description: '조위관측소 관측 자료를 품질처리(QC)·가공한 시간별 조위 성과(실측)',
    endpoint: 'https://apis.data.go.kr/1192136/hourlyTide/GetHourlyTideApiService',
    extraParams: {},
    timeField: 'obsrvnDt',
    valueFields: { tide_cm: 'tdlvVl' },
    unitStated: 'cm',
  },
  forecast: {
    key: 'forecast',
    title: '해양수산부 국립해양조사원_조석예보(시계열)',
    datasetId: '15156022',
    pageUrl: 'https://www.data.go.kr/data/15156022/openapi.do',
    kind: 'predicted',
    description: '조석 예보지점의 시계열 조석 예측(천문조 예측 조위)',
    endpoint: 'https://apis.data.go.kr/1192136/tideFcstTime/GetTideFcstTimeApiService',
    extraParams: { min: '60' },
    timeField: 'predcDt',
    valueFields: { pred_cm: 'tdlvHgt' },
    unitStated: 'cm',
  },
  // 같은 조석예보(시계열) API의 10분 간격(min=10). 만조·간조가 정시 사이에 있어 탐구 1에서 사용
  forecast10: {
    key: 'forecast10',
    title: '해양수산부 국립해양조사원_조석예보(시계열) 10분 간격',
    datasetId: '15156022',
    pageUrl: 'https://www.data.go.kr/data/15156022/openapi.do',
    kind: 'predicted',
    description: '조석 예보지점의 시계열 조석 예측(10분 간격, min=10)',
    endpoint: 'https://apis.data.go.kr/1192136/tideFcstTime/GetTideFcstTimeApiService',
    extraParams: { min: '10' },
    timeField: 'predcDt',
    valueFields: { pred_cm: 'tdlvHgt' },
    unitStated: 'cm',
  },
  realtime: {
    key: 'realtime',
    title: '해양수산부 국립해양조사원_조위관측소 실측·예측 조위 조회',
    datasetId: '15142507',
    pageUrl: 'https://www.data.go.kr/data/15142507/openapi.do',
    kind: 'observed+predicted',
    description: '조위관측소 실시간 관측자료(실측 조위와 예측 조위를 같은 행에 제공, 품질처리 전)',
    endpoint: 'https://apis.data.go.kr/1192136/surveyTideLevel/GetSurveyTideLevelApiService',
    extraParams: { min: '60' },
    timeField: 'obsrvnDt',
    valueFields: { tide_cm: 'bscTdlvHgt', pred_cm: 'tdlvHgt' },
    unitStated: 'cm',
  },
  // ── 기상(같은 조위관측소) ── 문서에 단위가 적혀 있지 않음(미확인)
  airpress: {
    key: 'airpress',
    group: 'weather',
    title: '해양수산부 국립해양조사원_조위관측소 실측 기압 조회',
    datasetId: '15142509',
    pageUrl: 'https://www.data.go.kr/data/15142509/openapi.do',
    kind: 'weather',
    description: '조위관측소 자동기상관측장비 기반 실시간 기압(단위·기압 종류 문서 미기재)',
    endpoint: 'https://apis.data.go.kr/1192136/surveyAirPress/GetSurveyAirPressApiService',
    extraParams: { min: '60' },
    timeField: 'obsrvnDt',
    valueFields: { pressure: 'atmpr' },
    unitStated: null,
  },
  wind: {
    key: 'wind',
    group: 'weather',
    title: '해양수산부 국립해양조사원_조위관측소 실측 풍향/풍속 조회',
    datasetId: '15142518',
    pageUrl: 'https://www.data.go.kr/data/15142518/openapi.do',
    kind: 'weather',
    description: '조위관측소 자동기상관측장비 기반 실시간 풍향·풍속(단위 문서 미기재)',
    endpoint: 'https://apis.data.go.kr/1192136/surveyWind/GetSurveyWindApiService',
    extraParams: { min: '60' },
    timeField: 'obsrvnDt',
    valueFields: { wind_speed: 'wspd', wind_dir: 'wndrct' },
    unitStated: null,
  },
  // ── 기상청 ASOS(대안) ── 활용가이드: 현지기압 pa(hPa), 해면기압 ps(hPa), 풍속 ws(m/s), 풍향 wd(16방위), QC 0/1/9
  asos: {
    key: 'asos',
    group: 'weather',
    provider: '기상청',
    title: '기상청_지상(종관, ASOS) 시간자료 조회서비스',
    datasetId: '15057210',
    pageUrl: 'https://www.data.go.kr/data/15057210/openapi.do',
    kind: 'weather',
    description: '종관기상관측(ASOS) 시간자료',
    endpoint: 'https://apis.data.go.kr/1360000/AsosHourlyInfoService/getWthrDataList',
    stationOption: 'asosStation',
    params: (ymd, station) => ({ dataType: 'JSON', dataCd: 'ASOS', dateCd: 'HR', startDt: ymd, startHh: '00', endDt: ymd, endHh: '23', stnIds: station }),
    timeField: 'tm',
    valueFields: { pressure_station: 'pa', pressure_sea: 'ps', wind_speed: 'ws', wind_dir: 'wd' },
    qcFields: { pressure_station: 'paQcflg', pressure_sea: 'psQcflg', wind_speed: 'wsQcflg', wind_dir: 'wdQcflg' },
    unitStated: 'hPa, m/s, 16방위',
  },
};

export const MAX_ROWS = 300; // 문서: numOfRows 최댓값 300
export const DAILY_TRAFFIC_DEV = 10000; // 문서: 개발계정 트래픽 10,000

// 활용가이드의 에러 코드표
export const RESULT_CODES = {
  '00': 'NORMAL_SERVICE', '0': 'NORMAL_SERVICE',
  '01': 'APPLICATION_ERROR', '1': 'APPLICATION_ERROR',
  '02': 'DB_ERROR', '2': 'DB_ERROR',
  '03': 'NODATA_ERROR', '3': 'NODATA_ERROR',
  '04': 'HTTP_ERROR', '4': 'HTTP_ERROR',
  '05': 'SERVICETIMEOUT_ERROR', '5': 'SERVICETIMEOUT_ERROR',
  '10': 'INVALID_REQUEST_PARAMETER_ERROR',
  '11': 'NO_MANDATORY_REQUEST_PARAMETERS_ERROR',
  '12': 'NO_OPENAPI_SERVICE_ERROR',
  '20': 'SERVICE_ACCESS_DENIED_ERROR',
  '21': 'TEMPORARILY_DISABLE_THE_SERVICEKEY_ERROR',
  '22': 'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR',
  '30': 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR',
  '31': 'DEADLINE_HAS_EXPIRED_ERROR',
  '32': 'UNREGISTERED_IP_ERROR',
  '33': 'UNSIGNED_CALL_ERROR',
  '99': 'UNKNOWN_ERROR',
};

/** 다시 시도하면 나아질 수 있는 오류 */
export const RETRYABLE = new Set(['APPLICATION_ERROR', 'DB_ERROR', 'HTTP_ERROR', 'SERVICETIMEOUT_ERROR', 'UNKNOWN_ERROR', 'NETWORK', 'HTTP_5XX', 'PARSE']);
/** 계속해도 모두 실패하므로 수집을 멈춰야 하는 오류(인증·트래픽) */
export const FATAL = new Set([
  'SERVICE_ACCESS_DENIED_ERROR', 'TEMPORARILY_DISABLE_THE_SERVICEKEY_ERROR', 'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR',
  'SERVICE_KEY_IS_NOT_REGISTERED_ERROR', 'DEADLINE_HAS_EXPIRED_ERROR', 'UNREGISTERED_IP_ERROR', 'UNSIGNED_CALL_ERROR',
  'SERVICE_KEY_IS_NULL', 'NO_OPENAPI_SERVICE_ERROR',
]);

/**
 * 공공데이터포털 인증키 정리.
 * 포털은 Encoding 키(%2B 등 이미 인코딩됨)와 Decoding 키를 함께 보여 준다. 어느 쪽을 넣어도 되게 한다.
 */
export function normalizeServiceKey(raw) {
  const k = String(raw || '').trim();
  if (!k) return '';
  if (/%[0-9A-Fa-f]{2}/.test(k)) {
    try { return decodeURIComponent(k); } catch { return k; }
  }
  return k;
}

/** 로그·원본 파일에 남길 URL(인증키 제거) */
export function redactUrl(url) {
  return String(url).replace(/([?&]serviceKey=)[^&]*/i, '$1***');
}

export function buildUrl(ds, { serviceKey, obsCode, reqDate, pageNo, numOfRows = MAX_ROWS, baseUrl }) {
  const u = new URL(baseUrl ? baseUrl.replace(/\/$/, '') + new URL(ds.endpoint).pathname : ds.endpoint);
  const own = ds.params ? ds.params(reqDate, obsCode) : { type: 'json', obsCode, reqDate, ...ds.extraParams };
  const p = new URLSearchParams({ serviceKey, ...own, pageNo: String(pageNo), numOfRows: String(numOfRows) });
  u.search = p.toString();
  return u.toString();
}

/**
 * 응답 해석. 공공데이터포털 응답은 { response: { header, body } } 또는 { header, body } 형태이며,
 * 게이트웨이 단계의 인증·트래픽 오류는 OpenAPI_ServiceResponse(XML 또는 JSON)로 온다.
 * @returns {{ok:boolean, code:string, codeName:string, message:string, items:object[], totalCount:number|null, pageNo:number|null, numOfRows:number|null}}
 */
export function parseResponse(text) {
  const t = String(text || '').trim();
  const tag = (name) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(t)?.[1];
  if (t.startsWith('<')) {
    if (t.includes('OpenAPI_ServiceResponse') || tag('returnReasonCode')) {
      return gatewayError(tag('returnReasonCode'), tag('errMsg'), tag('returnAuthMsg'));
    }
    const code = tag('resultCode');
    if (code != null) {
      const items = [];
      for (const m of t.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
        const o = {};
        for (const f of m[1].matchAll(/<(\w+)>([^<]*)<\/\1>/g)) o[f[1]] = f[2];
        items.push(o);
      }
      return result(code, tag('resultMsg'), items, tag('totalCount'), tag('pageNo'), tag('numOfRows'));
    }
    return { ok: false, code: '', codeName: 'PARSE', message: 'XML 응답을 해석하지 못함', items: [], totalCount: null, pageNo: null, numOfRows: null };
  }
  let j;
  try { j = JSON.parse(t); } catch {
    return { ok: false, code: '', codeName: 'PARSE', message: 'JSON이 아닌 응답', items: [], totalCount: null, pageNo: null, numOfRows: null };
  }
  if (j.OpenAPI_ServiceResponse) {
    const h = j.OpenAPI_ServiceResponse.cmmMsgHeader || {};
    return gatewayError(h.returnReasonCode, h.errMsg, h.returnAuthMsg);
  }
  const root = j.response || j;
  const header = root.header || {};
  const body = root.body || {};
  let items = body.items?.item ?? body.items ?? [];
  if (items === '' || items == null) items = [];
  if (!Array.isArray(items)) items = [items];
  return result(header.resultCode, header.resultMsg, items, body.totalCount, body.pageNo, body.numOfRows);
}

function result(code, msg, items, totalCount, pageNo, numOfRows) {
  const c = String(code ?? '');
  const codeName = RESULT_CODES[c] || (c ? 'UNKNOWN_ERROR' : 'PARSE');
  const num = (v) => (v == null || v === '' ? null : Number(v));
  return { ok: codeName === 'NORMAL_SERVICE', code: c, codeName, message: String(msg ?? ''), items, totalCount: num(totalCount), pageNo: num(pageNo), numOfRows: num(numOfRows) };
}

function gatewayError(reasonCode, errMsg, authMsg) {
  const em = String(errMsg ?? '').trim();
  // errMsg가 SERVICE_KEY_IS_NULL 같은 코드 이름이면 그대로 쓴다
  const codeName = /^[A-Z_]+$/.test(em) ? em : (RESULT_CODES[String(reasonCode ?? '')] || 'GATEWAY_ERROR');
  return { ok: false, code: String(reasonCode ?? ''), codeName, message: [em, authMsg].filter(Boolean).join(' / '), items: [], totalCount: null, pageNo: null, numOfRows: null };
}

/** YYYY-MM-DD 문자열 목록 */
export function dateRange(start, end) {
  const out = [];
  const d = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || Number.isNaN(e.getTime()) || e < d) throw new Error(`기간이 올바르지 않습니다: ${start} ~ ${end}`);
  for (; d <= e; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

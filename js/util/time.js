// 시간 처리 유틸리티
// 내부 기준: 모든 시각은 UTC 기준 epoch 밀리초(number)로 다룬다.
// 화면 표시는 사례 설정의 시간대(고정 오프셋, 분 단위)로 변환한다.

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** "+09:00" / "-03:30" / "Z" → 분 단위 오프셋. 형식이 틀리면 NaN */
export function parseOffset(str) {
  if (str === 'Z' || str === 'z') return 0;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(String(str).trim());
  if (!m) return NaN;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * 날짜·시각 문자열을 epoch ms로 변환한다.
 * 허용: "YYYY-MM-DD HH:mm[:ss]", "YYYY-MM-DDTHH:mm[:ss][±HH:MM|Z]", "YYYY/MM/DD HH:mm", "YYYY-MM-DD"
 * 문자열에 오프셋이 없으면 defaultOffsetMinutes를 사용한다. 없거나 잘못된 값이면 NaN.
 * (브라우저마다 다른 Date.parse 해석을 피하기 위해 직접 파싱한다.)
 */
export function parseDateTime(str, defaultOffsetMinutes) {
  if (str == null) return NaN;
  const s = String(str).trim();
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (!m) return NaN;
  const [, y, mo, d, hh = '0', mi = '0', ss = '0', off] = m;
  const Y = +y, M = +mo, D = +d, H = +hh, MI = +mi, S = +ss;
  if (M < 1 || M > 12 || D < 1 || D > 31 || H > 24 || MI > 59 || S > 59) return NaN;
  if (H === 24 && (MI !== 0 || S !== 0)) return NaN;
  const offset = off != null ? parseOffset(off) : defaultOffsetMinutes;
  if (offset == null || Number.isNaN(offset)) return NaN;
  const utc = Date.UTC(Y, M - 1, D, H, MI, S);
  // 존재하지 않는 날짜(예: 2월 30일) 거부
  const check = new Date(Date.UTC(Y, M - 1, D));
  if (check.getUTCMonth() !== M - 1 || check.getUTCDate() !== D) return NaN;
  return utc - offset * MINUTE;
}

/** tz: { offsetMinutes, label } */
function shifted(t, tz) {
  return new Date(t + (tz?.offsetMinutes || 0) * MINUTE);
}
const p2 = (n) => String(n).padStart(2, '0');

export function parts(t, tz) {
  const d = shifted(t, tz);
  return {
    year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
    hour: d.getUTCHours(), minute: d.getUTCMinutes(), weekday: d.getUTCDay(),
  };
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

/** "2099-09-08 13:00" */
export function fmtDateTime(t, tz, { year = true, seconds = false } = {}) {
  if (t == null || Number.isNaN(t)) return '—';
  const d = shifted(t, tz);
  const date = `${year ? d.getUTCFullYear() + '-' : ''}${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
  const time = `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}${seconds ? ':' + p2(d.getUTCSeconds()) : ''}`;
  return `${date} ${time}`;
}

/** "2099-09-08" */
export function fmtDate(t, tz, { year = true } = {}) {
  if (t == null || Number.isNaN(t)) return '—';
  const d = shifted(t, tz);
  return `${year ? d.getUTCFullYear() + '-' : ''}${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}

/** "9월 8일(화)" */
export function fmtDateKo(t, tz, { weekday = true } = {}) {
  const d = shifted(t, tz);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일${weekday ? `(${WEEK[d.getUTCDay()]})` : ''}`;
}

export function fmtTime(t, tz) {
  const d = shifted(t, tz);
  return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

/** 표시 시간대 기준 날짜 키 "YYYY-MM-DD" */
export function dayKey(t, tz) {
  return fmtDate(t, tz);
}

/** 표시 시간대 기준 해당 날짜 00:00의 epoch ms */
export function dayStartFromKey(key, tz) {
  return parseDateTime(key + ' 00:00', tz?.offsetMinutes || 0);
}

export function startOfDay(t, tz) {
  const off = (tz?.offsetMinutes || 0) * MINUTE;
  return Math.floor((t + off) / DAY) * DAY - off;
}

/** 기간 표시 "2099-09-08 00:00 ~ 2099-09-11 00:00 (KST)" */
export function fmtRange(t0, t1, tz, { withTz = true } = {}) {
  const a = fmtDateTime(t0, tz);
  const sameYear = parts(t0, tz).year === parts(t1, tz).year;
  const b = fmtDateTime(t1, tz, { year: !sameYear });
  return `${a} ~ ${b}${withTz && tz?.label ? ` (${tz.label})` : ''}`;
}

/** 시간 차이 → "12시간 25분" */
export function fmtDuration(ms) {
  if (ms == null || Number.isNaN(ms)) return '—';
  const sign = ms < 0 ? '−' : '';
  const totalMin = Math.round(Math.abs(ms) / MINUTE);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  const out = [];
  if (d) out.push(`${d}일`);
  if (h || (d && m)) out.push(`${h}시간`);
  if (m || out.length === 0) out.push(`${m}분`);
  return sign + out.join(' ');
}

/** 시간 차이 → 소수 시간 "12.42" */
export function hoursDecimal(ms, digits = 2) {
  return (ms / HOUR).toFixed(digits);
}

export function tzLabel(tz) {
  return tz?.label || 'UTC';
}

// 숫자·단위 표시 유틸리티
// 음수 부호는 하이픈(-) 대신 수학 기호 마이너스(−, U+2212)로 표시해 잘 보이게 한다.

export const MINUS = '−';

export function fmtNum(v, digits = 0) {
  if (v == null || Number.isNaN(v)) return '—';
  const r = Number(v).toFixed(digits);
  // -0 처리
  if (Number(r) === 0) return (0).toFixed(digits);
  return r.startsWith('-') ? MINUS + r.slice(1) : r;
}

/** 부호를 항상 붙인다: +12, −5, 0 */
export function fmtSigned(v, digits = 0) {
  if (v == null || Number.isNaN(v)) return '—';
  const r = Number(v).toFixed(digits);
  if (Number(r) === 0) return (0).toFixed(digits);
  return r.startsWith('-') ? MINUS + r.slice(1) : '+' + r;
}

export function fmtValue(v, unit, digits = 0) {
  if (v == null || Number.isNaN(v)) return '자료 없음';
  return `${fmtNum(v, digits)} ${unit}`;
}

export function fmtSignedValue(v, unit, digits = 0) {
  if (v == null || Number.isNaN(v)) return '자료 없음';
  return `${fmtSigned(v, digits)} ${unit}`;
}

/** 16방위 한국어 이름 (풍향: 바람이 불어오는 방향) */
const DIRS16 = ['북', '북북동', '북동', '동북동', '동', '동남동', '남동', '남남동',
  '남', '남남서', '남서', '서남서', '서', '서북서', '북서', '북북서'];
export function compass16(deg) {
  if (deg == null || Number.isNaN(deg)) return null;
  const i = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
  return DIRS16[i];
}

export function fmtWindDir(deg) {
  if (deg == null || Number.isNaN(deg)) return '자료 없음';
  return `${fmtNum(deg, 0)}° (${compass16(deg)}풍)`;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

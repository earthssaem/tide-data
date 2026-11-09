// 그리기 목록 → SVG 문자열

import { escapeHtml } from '../util/format.js';

export const SCREEN_FONT = '"Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", "Noto Sans KR", "Nanum Gothic", sans-serif';

const n = (v) => (Math.round(v * 10) / 10).toString();

function dashAttr(d) {
  return d && d.length ? ` stroke-dasharray="${d.join(' ')}"` : '';
}

export function itemsToSVG(items) {
  const out = [];
  for (const it of items) {
    switch (it.type) {
      case 'rect':
        out.push(`<rect x="${n(it.x)}" y="${n(it.y)}" width="${n(Math.max(0, it.w))}" height="${n(Math.max(0, it.h))}" fill="${it.fill || 'none'}"${it.opacity != null ? ` fill-opacity="${it.opacity}"` : ''} stroke="${it.stroke || 'none'}"${it.strokeWidth ? ` stroke-width="${it.strokeWidth}"` : ''}${dashAttr(it.dash)}/>`);
        break;
      case 'line':
        out.push(`<line x1="${n(it.x1)}" y1="${n(it.y1)}" x2="${n(it.x2)}" y2="${n(it.y2)}" stroke="${it.stroke}" stroke-width="${it.width || 1}"${dashAttr(it.dash)}/>`);
        break;
      case 'polyline':
        out.push(`<polyline points="${it.pts.map((p) => n(p[0]) + ',' + n(p[1])).join(' ')}" fill="none" stroke="${it.stroke}" stroke-width="${it.width || 1}" stroke-linejoin="round"${dashAttr(it.dash)}/>`);
        break;
      case 'polygon':
        out.push(`<polygon points="${it.pts.map((p) => n(p[0]) + ',' + n(p[1])).join(' ')}" fill="${it.fill || 'none'}" stroke="${it.stroke || 'none'}"${it.strokeWidth ? ` stroke-width="${it.strokeWidth}"` : ''}${it.dash ? ` stroke-dasharray="${it.dash.map(n).join(' ')}"` : ''}/>`);
        break;
      case 'circle':
        out.push(`<circle cx="${n(it.cx)}" cy="${n(it.cy)}" r="${n(it.r)}" fill="${it.fill || 'none'}" stroke="${it.stroke || 'none'}"${it.strokeWidth ? ` stroke-width="${it.strokeWidth}"` : ''}${it.dash ? ` stroke-dasharray="${it.dash.map(n).join(' ')}"` : ''}/>`);
        break;
      case 'text': {
        const anchor = it.anchor && it.anchor !== 'start' ? ` text-anchor="${it.anchor}"` : '';
        const rot = it.rotate ? ` transform="rotate(${it.rotate} ${n(it.x)} ${n(it.y)})"` : '';
        out.push(`<text x="${n(it.x)}" y="${n(it.y)}" font-size="${it.size}"${it.bold ? ' font-weight="700"' : ''} fill="${it.fill || '#000'}"${anchor}${rot}>${escapeHtml(it.text)}</text>`);
        break;
      }
      default:
        break;
    }
  }
  return out.join('');
}

export function layoutToSVG(layout, { className = '', title = '' } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${className}" viewBox="0 0 ${n(layout.width)} ${n(layout.height)}" width="${n(layout.width)}" height="${n(layout.height)}" font-family='${SCREEN_FONT}' role="img"${title ? ` aria-label="${escapeHtml(title)}"` : ''}>${itemsToSVG(layout.items)}</svg>`;
}

let canvas = null;
/** 화면용 글자 폭 측정 (캔버스) */
export function screenMeasure(text, size, bold) {
  if (typeof document === 'undefined') return String(text).length * size * 0.6;
  canvas = canvas || document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `${bold ? '700 ' : ''}${size}px ${SCREEN_FONT}`;
  return ctx.measureText(String(text)).width;
}

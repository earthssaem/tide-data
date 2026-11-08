// 화면용 그래프 패널: 그리기 + 마우스 올리기 정보 + 누르기(선택) + 끌어서 구간 고르기 + 여러 그래프가 함께 쓰는 커서
// 키보드: ←/→ 자료점 이동, Enter 선택, (구간 고르기 그래프) Shift+←/→ 구간 넓히기
import { layoutChart } from './layout.js';
import { layoutToSVG, screenMeasure } from './svg.js';
import { HOUR } from '../util/time.js';
import { escapeHtml } from '../util/format.js';

/** 여러 그래프가 함께 쓰는 커서(마우스 올린 시각) */
export class SharedCursor {
  constructor() { this.t = null; this.fns = new Set(); }
  set(t) { if (t === this.t) return; this.t = t; for (const f of this.fns) f(t); }
  on(f) { this.fns.add(f); return () => this.fns.delete(f); }
}

/**
 * @param {object} o
 * @param {HTMLElement} o.host
 * @param {number} o.height
 * @param {(ctx)=>object} o.build spec(또는 {layout}) 만들기. ctx: {width,height,measure,fontSize}
 * @param {string} o.ariaLabel
 * @param {(t:number)=>({t,v?}|null)} [o.pick] 시각 t에 가장 가까운 대상
 * @param {(target)=>string} [o.describe] 마우스 올리기 정보(HTML)
 * @param {(target)=>void} [o.onClick]
 * @param {{snap?:number, domain:[number,number], onChange:(r:[number,number]|null, done:boolean)=>void}} [o.brush]
 * @param {SharedCursor} [o.cursor]
 * @param {number} [o.step] 키보드 이동 간격(ms)
 */
export function createPanel(o) {
  const el = o.host;
  el.classList.add('chart-view');
  el.innerHTML = '<div class="chart-svg"></div><svg class="chart-overlay" aria-hidden="true"></svg><div class="chart-tip" hidden></div>';
  const svgHost = el.querySelector('.chart-svg');
  const overlay = el.querySelector('.chart-overlay');
  const tip = el.querySelector('.chart-tip');
  const interactive = !!(o.pick || o.brush || o.onClick);
  if (interactive) {
    el.tabIndex = 0;
    el.setAttribute('role', 'application');
    el.setAttribute('aria-roledescription', '대화형 그래프');
    el.setAttribute('aria-label', `${o.ariaLabel || '그래프'}. 왼쪽·오른쪽 화살표로 자료점 이동${o.onClick ? ', Enter로 선택' : ''}${o.brush ? ', Shift와 화살표로 구간 고르기' : ''}`);
  }
  let layout = null;
  let lastW = 0;
  let kb = null; // 키보드로 가리킨 대상
  let anchor = null; // 구간 고르기 시작점
  const step = o.step || HOUR;
  const fontSize = o.fontSize || 13;

  function render() {
    const width = Math.max(300, Math.round(el.clientWidth || 700));
    lastW = width;
    const out = o.build({ width, height: o.height, measure: screenMeasure, fontSize });
    layout = out.layout || layoutChart(out);
    svgHost.innerHTML = layoutToSVG(layout, { title: o.ariaLabel });
    overlay.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
    overlay.setAttribute('width', layout.width);
    overlay.setAttribute('height', layout.height);
    drawOverlay();
  }

  const local = (e) => {
    const r = svgHost.firstElementChild.getBoundingClientRect();
    const s = layout.width / r.width;
    return { x: (e.clientX - r.left) * s, y: (e.clientY - r.top) * s };
  };
  const inPlot = (x, y) => layout?.plot && x >= layout.plot.x - 6 && x <= layout.plot.x + layout.plot.w + 6 && y >= layout.plot.y - 4 && y <= layout.plot.y + layout.plot.h + 4;
  const clampT = (t) => {
    const [a, b] = o.brush?.domain || [-Infinity, Infinity];
    const sn = o.brush?.snap || HOUR;
    return Math.min(b, Math.max(a, Math.round(t / sn) * sn));
  };

  function showTip(target, x) {
    if (!target || !o.describe) { tip.hidden = true; return; }
    tip.innerHTML = o.describe(target);
    tip.hidden = false;
    const r = svgHost.firstElementChild.getBoundingClientRect();
    const sc = r.width / layout.width;
    const px = x * sc;
    const tw = tip.offsetWidth;
    let left = px + 14;
    if (left + tw > r.width - 4) left = px - tw - 14;
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${(layout.plot?.y || 0) * sc + 6}px`;
  }

  function drawOverlay() {
    if (!layout?.plot) { overlay.innerHTML = ''; return; }
    const L = layout;
    const parts = [];
    const t = o.cursor ? o.cursor.t : hoverT;
    if (t != null && L.tToX) {
      const x = L.tToX(t);
      if (x >= L.plot.x - 0.5 && x <= L.plot.x + L.plot.w + 0.5) {
        parts.push(`<line x1="${x}" y1="${L.plot.y}" x2="${x}" y2="${L.plot.y + L.plot.h}" stroke="#0b1f3a" stroke-width="1" stroke-dasharray="3 3"/>`);
        const tg = o.pick ? o.pick(t) : null;
        if (tg && tg.v != null && Number.isFinite(tg.v) && tg.t === t) {
          const y = L.vToY(tg.v);
          if (y >= L.plot.y && y <= L.plot.y + L.plot.h) parts.push(`<circle cx="${x}" cy="${y}" r="7" fill="none" stroke="#0b1f3a" stroke-width="2"/>`);
        }
      }
    }
    if (kbActive && kb && L.tToX) {
      const x = L.tToX(kb.t);
      const y = kb.v != null ? L.vToY(kb.v) : L.plot.y + L.plot.h / 2;
      parts.push(`<rect x="${x - 9}" y="${y - 9}" width="18" height="18" fill="none" stroke="#d9480f" stroke-width="2" stroke-dasharray="3 2"/>`);
    }
    overlay.innerHTML = parts.join('');
  }

  let hoverT = null;
  let kbActive = false;
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    if (!layout?.plot || e.button !== 0) return;
    const { x, y } = local(e);
    if (!inPlot(x, y)) return;
    drag = { x0: x, t0: layout.xToT(x), moved: false, id: e.pointerId };
  });
  el.addEventListener('pointermove', (e) => {
    if (!layout?.plot) return;
    const { x, y } = local(e);
    if (drag && (e.buttons & 1) && o.brush) {
      if (Math.abs(x - drag.x0) > 5) {
        drag.moved = true;
        el.setPointerCapture?.(drag.id);
        el.classList.add('dragging');
        const a = clampT(drag.t0), b = clampT(layout.xToT(Math.min(layout.plot.x + layout.plot.w, Math.max(layout.plot.x, x))));
        o.brush.onChange(a <= b ? [a, Math.max(b, a + (o.brush.snap || HOUR))] : [b, a], false);
        tip.hidden = true;
        return;
      }
    }
    if (!inPlot(x, y)) { setHover(null); tip.hidden = true; return; }
    const t = layout.xToT(x);
    const tg = o.pick ? o.pick(t) : null;
    setHover(tg ? tg.t : t);
    showTip(tg, x);
  });
  const end = (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    el.classList.remove('dragging');
    if (!layout?.plot) return;
    if (d.moved && o.brush) {
      const { x } = local(e);
      const a = clampT(d.t0), b = clampT(layout.xToT(Math.min(layout.plot.x + layout.plot.w, Math.max(layout.plot.x, x))));
      o.brush.onChange(a <= b ? [a, Math.max(b, a + (o.brush.snap || HOUR))] : [b, a], true);
      return;
    }
    const { x, y } = local(e);
    if (!inPlot(x, y) || !o.onClick) return;
    const tg = o.pick ? o.pick(layout.xToT(x)) : { t: layout.xToT(x) };
    if (tg) { kb = tg; o.onClick(tg); }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', () => { drag = null; el.classList.remove('dragging'); });
  el.addEventListener('pointerleave', () => { if (!drag) { setHover(null); tip.hidden = true; } });
  el.addEventListener('blur', () => { kbActive = false; drawOverlay(); });
  el.addEventListener('keydown', (e) => {
    if (!layout?.plot || !o.pick) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const [d0, d1] = layout.domain || [layout.xToT(layout.plot.x), layout.xToT(layout.plot.x + layout.plot.w)];
      const from = kb ? kb.t + dir * step : dir > 0 ? d0 : d1;
      const next = o.pick(Math.min(d1, Math.max(d0, from)));
      if (!next) return;
      if (e.shiftKey && o.brush) {
        if (anchor == null) anchor = kb ? kb.t : next.t;
        const a = Math.min(anchor, next.t), b = Math.max(anchor, next.t);
        o.brush.onChange([clampT(a), clampT(Math.max(b, a + (o.brush.snap || HOUR)))], true);
      } else anchor = null;
      kb = next;
      kbActive = true;
      setHover(next.t);
      showTip(next, layout.tToX(next.t));
      drawOverlay();
    } else if ((e.key === 'Enter' || e.key === ' ') && kb && o.onClick) {
      e.preventDefault();
      o.onClick(kb);
    } else if (e.key === 'Escape' && o.brush) {
      anchor = null;
    }
  });
  function setHover(t) {
    hoverT = t;
    if (o.cursor) o.cursor.set(t); else drawOverlay();
  }
  const off = o.cursor ? o.cursor.on(() => drawOverlay()) : null;
  const ro = new ResizeObserver(() => { const w = Math.round(el.clientWidth); if (w && w !== lastW) render(); });
  ro.observe(el);
  render();
  return { render, destroy() { ro.disconnect(); off?.(); }, get layout() { return layout; } };
}

/** 정적 그리기 목록(지도 등)을 화면에 넣기 */
export function staticLayoutHTML(layout, title) {
  return layoutToSVG(layout, { title });
}

export function tipRow(label, value) {
  return `<div class="tip-row"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
}

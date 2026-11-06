// 화면용 상호작용 그래프
// ViewController: 표시 범위(확대·축소·이동) 상태 — 여러 그래프가 공유할 수 있다(탐구 3).
// ChartView: SVG 그리기 + 마우스/키보드 조작(지점 선택, 끌어서 이동, 마우스 올리기 정보)

import { layoutChart } from './layout.js';
import { layoutToSVG, screenMeasure } from './svg.js';
import { HOUR } from '../util/time.js';
import { escapeHtml } from '../util/format.js';

export class ViewController {
  constructor({ domain, initial, minSpan = 6 * HOUR, onChange }) {
    this.domain = domain;
    this.initial = initial;
    this.minSpan = minSpan;
    this.onChange = onChange;
    this.view = [...initial];
    this.hoverT = null;
    this.listeners = new Set();
  }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(kind) { for (const fn of this.listeners) fn(kind); }
  set(t0, t1, silent = false) {
    const [d0, d1] = this.domain;
    let span = Math.max(this.minSpan, Math.min(t1 - t0, d1 - d0));
    let a = t0, b = t0 + span;
    if (a < d0) { a = d0; b = a + span; }
    if (b > d1) { b = d1; a = b - span; }
    a = Math.round(a / 60000) * 60000; b = Math.round(b / 60000) * 60000;
    if (a === this.view[0] && b === this.view[1]) return;
    this.view = [a, b];
    this.emit('view');
    if (!silent) this.onChange?.(this.view);
  }
  zoom(factor, center) {
    const [a, b] = this.view;
    const c = center ?? (a + b) / 2;
    const f = (c - a) / (b - a);
    const span = (b - a) * factor;
    this.set(c - span * f, c - span * f + span);
  }
  pan(fraction) {
    const [a, b] = this.view;
    const d = (b - a) * fraction;
    this.set(a + d, b + d);
  }
  reset() { this.set(this.initial[0], this.initial[1]); }
  setHover(t) {
    if (this.hoverT === t) return;
    this.hoverT = t;
    this.emit('hover');
  }
}

/** 확대·축소·이동 도구 막대 */
export function createToolbar(controller, { label = '그래프', extra = '' } = {}) {
  const el = document.createElement('div');
  el.className = 'chart-toolbar';
  el.setAttribute('role', 'toolbar');
  el.setAttribute('aria-label', `${label} 보기 도구`);
  el.innerHTML = `
    <button type="button" class="tool" data-act="zoomin" title="확대 (키보드 +)">＋ 확대</button>
    <button type="button" class="tool" data-act="zoomout" title="축소 (키보드 −)">－ 축소</button>
    <button type="button" class="tool" data-act="left" title="왼쪽으로 이동">◀ 이전 시각</button>
    <button type="button" class="tool" data-act="right" title="오른쪽으로 이동">다음 시각 ▶</button>
    <button type="button" class="tool" data-act="reset" title="교사가 지정한 처음 범위로 되돌리기">처음 범위</button>
    ${extra}`;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'zoomin') controller.zoom(0.6);
    else if (act === 'zoomout') controller.zoom(1 / 0.6);
    else if (act === 'left') controller.pan(-0.35);
    else if (act === 'right') controller.pan(0.35);
    else if (act === 'reset') controller.reset();
  });
  return el;
}

export class ChartView {
  /**
   * @param {object} o
   * @param {HTMLElement} o.el 그래프를 넣을 요소
   * @param {ViewController} o.controller
   * @param {number} o.height
   * @param {(ctx)=>object} o.build spec 만들기 (ctx: {width,height,measure,fontSize})
   * @param {(t:number)=>object|null} o.pick 시각 t에 가장 가까운 선택 대상 {t, v?, ...}
   * @param {(target, dir)=>object|null} o.step 키보드 이동
   * @param {(target)=>void} o.onSelect
   * @param {(target)=>string} o.describe 마우스 올리기 정보(HTML)
   * @param {string} o.ariaLabel
   */
  constructor(o) {
    Object.assign(this, o);
    this.fontSize = o.fontSize || 14;
    this.el.classList.add('chart-view');
    this.el.innerHTML = '<div class="chart-svg"></div><svg class="chart-overlay" aria-hidden="true"></svg><div class="chart-tip" hidden></div>';
    this.svgHost = this.el.querySelector('.chart-svg');
    this.overlay = this.el.querySelector('.chart-overlay');
    this.tip = this.el.querySelector('.chart-tip');
    this.el.tabIndex = 0;
    this.el.setAttribute('role', 'application');
    this.el.setAttribute('aria-roledescription', '대화형 그래프');
    this.el.setAttribute('aria-label', `${o.ariaLabel || '그래프'}. 왼쪽·오른쪽 화살표로 자료점 이동, Enter로 선택, +와 −로 확대·축소`);
    this.kbTarget = null;
    this.layout = null;
    this.unsub = this.controller.subscribe((kind) => {
      if (kind === 'view') this.render();
      else if (kind === 'hover') this.drawOverlay();
    });
    this.bind();
    this.ro = new ResizeObserver(() => {
      const w = Math.round(this.el.clientWidth);
      if (w && w !== this.lastWidth) this.render();
    });
    this.ro.observe(this.el);
  }

  destroy() {
    this.unsub?.();
    this.ro?.disconnect();
  }

  render() {
    const width = Math.max(320, Math.round(this.el.clientWidth || 700));
    this.lastWidth = width;
    const spec = this.build({ width, height: this.height, measure: screenMeasure, fontSize: this.fontSize, view: this.controller.view });
    this.layout = layoutChart(spec);
    this.svgHost.innerHTML = layoutToSVG(this.layout, { title: this.ariaLabel });
    this.overlay.setAttribute('viewBox', `0 0 ${width} ${this.height}`);
    this.overlay.setAttribute('width', width);
    this.overlay.setAttribute('height', this.height);
    this.drawOverlay();
  }

  localPoint(e) {
    const r = this.svgHost.firstElementChild.getBoundingClientRect();
    const sx = this.layout.width / r.width;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sx };
  }

  inPlot(x, y) {
    const p = this.layout.plot;
    return x >= p.x - 6 && x <= p.x + p.w + 6 && y >= p.y - 4 && y <= p.y + p.h + 4;
  }

  bind() {
    let drag = null;
    this.el.addEventListener('pointerdown', (e) => {
      if (!this.layout || e.button !== 0) return;
      const { x } = this.localPoint(e);
      drag = { x0: x, view0: [...this.controller.view], moved: false, id: e.pointerId };
    });
    this.el.addEventListener('pointermove', (e) => {
      if (!this.layout) return;
      const { x, y } = this.localPoint(e);
      if (drag && e.buttons & 1) {
        const dx = x - drag.x0;
        if (Math.abs(dx) > 4) {
          drag.moved = true;
          this.el.setPointerCapture?.(drag.id);
          this.el.classList.add('dragging');
          const per = (drag.view0[1] - drag.view0[0]) / this.layout.plot.w;
          this.controller.set(drag.view0[0] - dx * per, drag.view0[1] - dx * per);
          this.tip.hidden = true;
          return;
        }
      }
      if (!this.inPlot(x, y)) { this.controller.setHover(null); this.hoverTarget = null; this.tip.hidden = true; return; }
      const t = this.layout.xToT(x);
      const target = this.pick(t, this.layout.yToV(y));
      this.hoverTarget = target;
      this.controller.setHover(target ? target.t : t);
      this.showTip(target, x);
    });
    const end = (e) => {
      if (!drag) return;
      const wasDrag = drag.moved;
      drag = null;
      this.el.classList.remove('dragging');
      if (wasDrag || !this.layout) return;
      const { x, y } = this.localPoint(e);
      if (!this.inPlot(x, y)) return;
      const target = this.pick(this.layout.xToT(x), this.layout.yToV(y));
      if (target) { this.kbTarget = target; this.onSelect?.(target); }
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', () => { drag = null; this.el.classList.remove('dragging'); });
    this.el.addEventListener('pointerleave', () => { this.controller.setHover(null); this.tip.hidden = true; });
    this.el.addEventListener('keydown', (e) => this.onKey(e));
    this.el.addEventListener('blur', () => { this.kbActive = false; this.drawOverlay(); });
  }

  onKey(e) {
    const c = this.controller;
    const [a, b] = c.view;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      let next;
      if (!this.kbTarget || this.kbTarget.t < a || this.kbTarget.t > b) next = this.pick(dir > 0 ? a : b);
      else next = this.step(this.kbTarget, dir);
      if (next) {
        this.kbTarget = next;
        this.kbActive = true;
        if (next.t < a || next.t > b) c.pan(dir * 0.3);
        c.setHover(next.t);
        this.showTip(next, this.layout.tToX(next.t));
        this.drawOverlay();
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (this.kbTarget) { e.preventDefault(); this.onSelect?.(this.kbTarget); }
    } else if (e.key === '+' || e.key === '=') { e.preventDefault(); c.zoom(0.6, this.kbTarget?.t); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); c.zoom(1 / 0.6, this.kbTarget?.t); }
    else if (e.key === 'Home') { e.preventDefault(); c.reset(); }
    else if (e.key === 'PageUp') { e.preventDefault(); c.pan(-0.35); }
    else if (e.key === 'PageDown') { e.preventDefault(); c.pan(0.35); }
  }

  showTip(target, x) {
    if (!target || !this.describe) { this.tip.hidden = true; return; }
    this.tip.innerHTML = this.describe(target);
    this.tip.hidden = false;
    const r = this.svgHost.firstElementChild.getBoundingClientRect();
    const scale = r.width / this.layout.width;
    const px = x * scale;
    const tw = this.tip.offsetWidth;
    let left = px + 14;
    if (left + tw > r.width - 4) left = px - tw - 14;
    this.tip.style.left = `${Math.max(4, left)}px`;
    this.tip.style.top = `${this.layout.plot.y * scale + 6}px`;
  }

  drawOverlay() {
    if (!this.layout) return;
    const L = this.layout;
    const t = this.controller.hoverT;
    const parts = [];
    if (t != null && t >= this.controller.view[0] && t <= this.controller.view[1]) {
      const x = L.tToX(t);
      parts.push(`<line x1="${x}" y1="${L.plot.y}" x2="${x}" y2="${L.plot.y + L.plot.h}" stroke="#0b1f3a" stroke-width="1" stroke-dasharray="3 3"/>`);
      const tg = this.hoverValue ? this.hoverValue(t) : (this.hoverTarget && this.hoverTarget.t === t ? this.hoverTarget : null);
      if (tg && tg.v != null && Number.isFinite(tg.v)) {
        const y = L.vToY(tg.v);
        if (y >= L.plot.y && y <= L.plot.y + L.plot.h) parts.push(`<circle cx="${x}" cy="${y}" r="7" fill="none" stroke="#0b1f3a" stroke-width="2"/>`);
      }
    }
    if (this.kbActive && this.kbTarget) {
      const x = L.tToX(this.kbTarget.t);
      if (this.kbTarget.v != null) {
        const y = L.vToY(this.kbTarget.v);
        parts.push(`<rect x="${x - 9}" y="${y - 9}" width="18" height="18" fill="none" stroke="#d9480f" stroke-width="2" stroke-dasharray="3 2"/>`);
      }
    }
    this.overlay.innerHTML = parts.join('');
  }
}

export function tipRow(label, value) {
  return `<div class="tip-row"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
}

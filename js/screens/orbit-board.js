// 태양·지구·달 끌어 놓기 판(문항 ④). 마우스·펜·손가락으로 끌거나, 천체를 Tab으로 고른 뒤 화살표로 옮긴다.
import { h } from '../util/dom.js';
import { SCREEN_FONT, itemsToSVG } from '../chart/svg.js';
import { orbitLayout, emptyOrbit, isEmptyOrbit, BODIES, BODY_KEYS, TRAY, ORBIT_W, ORBIT_H } from '../chart/orbit.js';

/**
 * @param {{value:object|null, onChange:(v)=>void, locked?:boolean, label:string, id:string}} o
 */
export function createOrbitBoard({ value, onChange, locked = false, label = '배치판', id = 'orbit' }) {
  let v = value ? JSON.parse(JSON.stringify(value)) : emptyOrbit();
  for (const k of BODY_KEYS) if (!v[k]) v[k] = { ...TRAY[k], placed: false };
  const wrap = h('div', { class: `orbit-board${locked ? ' locked' : ''}`, id });
  const host = h('div', { class: 'orbit-surface' });
  const status = h('p', { class: 'muted small orbit-status', 'aria-live': 'polite' });
  wrap.append(host);
  if (!locked) {
    wrap.append(h('div', { class: 'orbit-bar' },
      h('span', { class: 'small muted' }, '천체를 끌어다 놓으세요(키보드: Tab으로 천체 고르기 → 화살표로 옮기기).'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-xs', id: `${id}-reset`, onclick: () => { v = emptyOrbit(); commit(); } }, '처음 위치로')));
  }
  wrap.append(status);

  const render = () => {
    const L = orbitLayout(v, ORBIT_W);
    const handles = locked ? '' : BODY_KEYS.map((k) => {
      const b = BODIES[k];
      return `<circle class="orbit-handle" data-body="${k}" cx="${v[k].x}" cy="${v[k].y}" r="${b.r + 6}" fill="transparent" tabindex="0" role="button" aria-label="${b.label}. 화살표로 옮기기 (지금 위치 가로 ${Math.round(v[k].x)}, 세로 ${Math.round(v[k].y)})"/>`;
    }).join('');
    host.innerHTML = `<svg viewBox="0 0 ${ORBIT_W} ${ORBIT_H}" font-family='${SCREEN_FONT}' preserveAspectRatio="xMidYMid meet" aria-label="${label}" role="group">${itemsToSVG(L.items)}${handles}</svg>`;
    const placed = BODY_KEYS.filter((k) => v[k].placed).map((k) => BODIES[k].label);
    status.textContent = placed.length ? `옮긴 천체: ${placed.join(', ')}` : (locked ? '배치하지 않음' : '아직 옮긴 천체가 없습니다.');
  };
  const commit = () => { onChange?.(isEmptyOrbit(v) ? null : JSON.parse(JSON.stringify(v))); render(); };
  const clamp = (k, x, y) => {
    const r = BODIES[k].r;
    return { x: Math.round(Math.min(ORBIT_W - r, Math.max(r, x))), y: Math.round(Math.min(ORBIT_H - r, Math.max(r, y))) };
  };

  if (!locked) {
    let drag = null;
    const pt = (e) => {
      const svg = host.firstElementChild;
      const r = svg.getBoundingClientRect();
      const s = Math.min(r.width / ORBIT_W, r.height / ORBIT_H);
      const ox = (r.width - ORBIT_W * s) / 2, oy = (r.height - ORBIT_H * s) / 2;
      return { x: (e.clientX - r.left - ox) / s, y: (e.clientY - r.top - oy) / s };
    };
    host.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('[data-body]');
      if (!el) return;
      e.preventDefault();
      const k = el.dataset.body;
      const p = pt(e);
      drag = { k, dx: v[k].x - p.x, dy: v[k].y - p.y, id: e.pointerId };
      host.setPointerCapture?.(e.pointerId);
    });
    host.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = pt(e);
      v[drag.k] = { ...clamp(drag.k, p.x + drag.dx, p.y + drag.dy), placed: true };
      render();
    });
    const end = () => { if (drag) { const k = drag.k; drag = null; commit(); host.querySelector(`[data-body="${k}"]`)?.focus?.(); } };
    host.addEventListener('pointerup', end);
    host.addEventListener('pointercancel', end);
    host.addEventListener('keydown', (e) => {
      const el = e.target.closest?.('[data-body]');
      if (!el) return;
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!d) return;
      e.preventDefault();
      const k = el.dataset.body;
      const step = e.shiftKey ? 2 : 10;
      v[k] = { ...clamp(k, v[k].x + d[0] * step, v[k].y + d[1] * step), placed: true };
      commit();
      host.querySelector(`[data-body="${k}"]`)?.focus();
    });
  }
  render();
  return { el: wrap };
}

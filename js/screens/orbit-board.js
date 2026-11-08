// 태양·지구·달 배치판(문항 ④): 태양·지구는 고정, 달만 공전 궤도 위에서 끌어 옮긴다.
// 키보드: 달을 Tab으로 고른 뒤 ←/→(또는 ↑/↓)로 궤도를 따라 15°씩(Shift는 5°) 옮긴다.
import { h } from '../util/dom.js';
import { SCREEN_FONT, itemsToSVG } from '../chart/svg.js';
import { orbitLayout, emptyOrbit, isEmptyOrbit, moonXY, angleAt, MOON_R, ORBIT_W, ORBIT_H } from '../chart/orbit.js';

/**
 * @param {{value:object|null, onChange:(v)=>void, locked?:boolean, label:string, id:string}} o
 */
export function createOrbitBoard({ value, onChange, locked = false, label = '배치판', id = 'orbit' }) {
  let v = value?.moon ? JSON.parse(JSON.stringify(value)) : emptyOrbit();
  const wrap = h('div', { class: `orbit-board${locked ? ' locked' : ''}`, id });
  const host = h('div', { class: 'orbit-surface' });
  const status = h('p', { class: 'muted small orbit-status', 'aria-live': 'polite' });
  wrap.append(host);
  if (!locked) {
    wrap.append(h('div', { class: 'orbit-bar' },
      h('span', { class: 'small muted' }, '달을 끌어 공전 궤도를 따라 옮기세요(키보드: Tab으로 달 고르기 → 화살표).'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-xs', id: `${id}-reset`, onclick: () => { v = emptyOrbit(); commit(); } }, '처음 위치로')));
  }
  wrap.append(status);

  const render = () => {
    const L = orbitLayout(v, ORBIT_W);
    const m = moonXY(v.moon.angle);
    const handle = locked ? '' : `<circle class="orbit-handle" data-body="moon" cx="${m.x}" cy="${m.y}" r="${MOON_R + 9}" fill="transparent" tabindex="0" role="slider" aria-label="달의 위치(공전 궤도 위)" aria-valuemin="0" aria-valuemax="359" aria-valuenow="${Math.round(v.moon.angle)}" aria-valuetext="${v.moon.placed ? '옮김' : '처음 위치'}"/>`;
    host.innerHTML = `<svg viewBox="0 0 ${ORBIT_W} ${ORBIT_H}" font-family='${SCREEN_FONT}' preserveAspectRatio="xMidYMid meet" aria-label="${label}" role="group">${itemsToSVG(L.items)}${handle}</svg>`;
    status.textContent = v.moon.placed ? '달을 옮겼습니다.' : (locked ? '배치하지 않음' : '아직 달을 옮기지 않았습니다.');
  };
  const commit = () => { onChange?.(isEmptyOrbit(v) ? null : JSON.parse(JSON.stringify(v))); render(); };

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
      if (!e.target.closest('[data-body="moon"]')) return;
      e.preventDefault();
      drag = { id: e.pointerId };
      host.setPointerCapture?.(e.pointerId);
    });
    host.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = pt(e);
      v.moon = { angle: angleAt(p.x, p.y), placed: true };
      render();
    });
    const end = () => { if (drag) { drag = null; commit(); host.querySelector('[data-body="moon"]')?.focus?.(); } };
    host.addEventListener('pointerup', end);
    host.addEventListener('pointercancel', end);
    host.addEventListener('keydown', (e) => {
      if (!e.target.closest?.('[data-body="moon"]')) return;
      const dir = { ArrowRight: -1, ArrowDown: -1, ArrowLeft: 1, ArrowUp: 1 }[e.key];
      if (!dir) return;
      e.preventDefault();
      const step = e.shiftKey ? 5 : 15;
      v.moon = { angle: (((v.moon.angle + dir * step) % 360) + 360) % 360, placed: true };
      commit();
      host.querySelector('[data-body="moon"]')?.focus();
    });
  }
  render();
  return { el: wrap };
}

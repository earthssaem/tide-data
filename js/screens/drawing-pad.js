// 간단한 자유 그림판: 펜(색 4가지), 글자 넣기, 되돌리기, 모두 지우기
// 그림은 선의 좌표와 글자만 저장한다(이미지 파일이 아니라 PDF에서도 선명하게 그림).
// 그림 대신 글로만 설명해도 된다(키보드만 쓰는 학생도 답안 작성 가능).

import { h, confirmDialog } from '../util/dom.js';
import { itemsToSVG, SCREEN_FONT } from '../chart/svg.js';
import { drawingLayout, DRAW_W, DRAW_H, isEmptyDrawing } from '../chart/drawing.js';

const COLORS = [['#1d2733', '검정'], ['#1f5fbf', '파랑'], ['#c92a2a', '빨강'], ['#e67700', '주황']];
const empty = () => ({ w: DRAW_W, h: DRAW_H, strokes: [], texts: [] });
const r1 = (v) => Math.round(v * 10) / 10;

/**
 * @param {{value:object|null, onChange:(d)=>void, locked?:boolean, label:string, id:string}} o
 */
export function createDrawingPad({ value, onChange, locked = false, label = '그림판', id = 'pad' }) {
  let d = value ? JSON.parse(JSON.stringify(value)) : empty();
  let color = COLORS[0][0];
  let tool = 'pen';
  const history = [];
  const wrap = h('div', { class: `draw-pad${locked ? ' locked' : ''}`, id });
  const bar = h('div', { class: 'draw-bar', role: 'toolbar', 'aria-label': `${label} 도구` });
  const svgHost = h('div', { class: 'draw-surface', 'aria-label': `${label}. 마우스·펜·손가락으로 그립니다. 그림 대신 위 입력란에 글로 설명해도 됩니다.`, role: 'img' });
  const status = h('p', { class: 'muted small draw-status' });

  const render = () => {
    const L = drawingLayout(d, DRAW_W);
    svgHost.innerHTML = `<svg viewBox="0 0 ${DRAW_W} ${DRAW_H}" font-family='${SCREEN_FONT}' preserveAspectRatio="xMidYMid meet">${itemsToSVG(L.items)}</svg>`;
    status.textContent = isEmptyDrawing(d) ? (locked ? '그림 없음' : '아직 그린 내용이 없습니다.') : `선 ${d.strokes.length}개 · 글자 ${d.texts.length}개`;
  };
  const commit = () => { onChange?.(isEmptyDrawing(d) ? null : JSON.parse(JSON.stringify(d))); render(); };
  const snapshot = () => { history.push(JSON.stringify(d)); if (history.length > 60) history.shift(); };

  if (!locked) {
    const toolBtn = (t, text) => h('button', { type: 'button', class: `btn btn-ghost btn-xs draw-tool${tool === t ? ' on' : ''}`, 'data-tool': t, 'aria-pressed': tool === t ? 'true' : 'false', onclick: () => { tool = t; syncBar(); } }, text);
    const colorBtns = COLORS.map(([c, name]) => h('button', { type: 'button', class: 'draw-color', 'data-color': c, title: name, 'aria-label': `${name} 색`, style: `background:${c}`, onclick: () => { color = c; syncBar(); } }));
    bar.append(toolBtn('pen', '✎ 펜'), toolBtn('text', 'T 글자'), h('span', { class: 'draw-colors' }, ...colorBtns),
      h('button', { type: 'button', class: 'btn btn-ghost btn-xs', onclick: () => { if (!history.length) return; d = JSON.parse(history.pop()); commit(); } }, '↶ 되돌리기'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-xs', onclick: async () => {
        if (isEmptyDrawing(d)) return;
        if (!(await confirmDialog({ title: '그림 모두 지우기', body: '그린 선과 글자를 모두 지울까요? [되돌리기]로 다시 살릴 수 있습니다.', okLabel: '모두 지우기', danger: true }))) return;
        snapshot(); d = empty(); commit();
      } }, '모두 지우기'));
    const syncBar = () => {
      bar.querySelectorAll('.draw-tool').forEach((b) => { const on = b.dataset.tool === tool; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      bar.querySelectorAll('.draw-color').forEach((b) => b.classList.toggle('on', b.dataset.color === color));
      svgHost.classList.toggle('text-mode', tool === 'text');
    };
    syncBar();

    const local = (e) => {
      const r = svgHost.firstElementChild.getBoundingClientRect();
      // preserveAspectRatio meet: 실제 그림 영역 계산
      const k = Math.min(r.width / DRAW_W, r.height / DRAW_H);
      const ox = (r.width - DRAW_W * k) / 2, oy = (r.height - DRAW_H * k) / 2;
      return [r1(Math.min(DRAW_W, Math.max(0, (e.clientX - r.left - ox) / k))), r1(Math.min(DRAW_H, Math.max(0, (e.clientY - r.top - oy) / k)))];
    };
    let cur = null;
    svgHost.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      if (tool === 'text') {
        const [x, y] = local(e);
        placeText(x, y);
        return;
      }
      svgHost.setPointerCapture?.(e.pointerId);
      snapshot();
      cur = { c: color, w: 3, p: [local(e)] };
      d.strokes.push(cur);
      render();
    });
    svgHost.addEventListener('pointermove', (e) => {
      if (!cur) return;
      const p = local(e);
      const last = cur.p[cur.p.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.5 || cur.p.length > 3800) return;
      cur.p.push(p);
      render();
    });
    const end = () => { if (cur) { cur = null; commit(); } };
    svgHost.addEventListener('pointerup', end);
    svgHost.addEventListener('pointercancel', end);

    function placeText(x, y) {
      const box = h('div', { class: 'draw-text-input' });
      const inp = h('input', { type: 'text', maxlength: 40, 'aria-label': '그림에 넣을 글자', placeholder: '예: 달, 태양, 지구' });
      const ok = h('button', { type: 'button', class: 'btn btn-primary btn-xs' }, '넣기');
      const cancel = h('button', { type: 'button', class: 'btn btn-ghost btn-xs' }, '취소');
      box.append(inp, ok, cancel);
      wrap.querySelector('.draw-text-input')?.remove();
      wrap.insertBefore(box, status);
      inp.focus();
      const done = (save) => {
        const t = inp.value.trim();
        box.remove();
        if (save && t) { snapshot(); d.texts.push({ x, y: Math.max(18, y), c: color, s: 18, t }); commit(); }
      };
      ok.onclick = () => done(true);
      cancel.onclick = () => done(false);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(true); } if (e.key === 'Escape') done(false); });
    }
  }
  wrap.append(bar, svgHost, status);
  render();
  return { el: wrap, get value() { return isEmptyDrawing(d) ? null : d; } };
}

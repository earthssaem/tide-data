// 태양·지구·달 배치판: 학생이 천체를 끌어다 놓은 위치를 그리기 목록으로(화면 SVG·PDF 공용)
// 위치는 판 좌표(ORBIT_W × ORBIT_H)로 저장한다. 앱은 '맞는 배치'를 판정하거나 표시하지 않는다.
export const ORBIT_W = 560;
export const ORBIT_H = 300;
export const BODIES = {
  sun: { label: '태양', r: 34, fill: '#f6b93b', stroke: '#c77d00', text: '#5c3a00' },
  earth: { label: '지구', r: 17, fill: '#3c7dd9', stroke: '#1f4f99', text: '#ffffff' },
  moon: { label: '달', r: 10, fill: '#c9ced6', stroke: '#6b7684', text: '#1d2733' },
};
export const BODY_KEYS = ['sun', 'earth', 'moon'];
/** 처음 위치: 아래쪽 보관함(일부러 한 줄로 늘어놓지 않음). 학생이 옮긴 천체만 '놓음'으로 본다 */
export const TRAY = { sun: { x: 60, y: 245 }, earth: { x: 150, y: 262 }, moon: { x: 205, y: 236 } };
export const TRAY_BOX = { x: 12, y: 196, w: 228, h: 94 };

export function emptyOrbit() {
  return Object.fromEntries(BODY_KEYS.map((k) => [k, { ...TRAY[k], placed: false }]));
}
export const isEmptyOrbit = (o) => !o || !BODY_KEYS.some((k) => o[k]?.placed);

/** 그리기 목록 */
export function orbitLayout(o, width = ORBIT_W, { showTray = true } = {}) {
  const v = o || emptyOrbit();
  const s = width / ORBIT_W;
  const items = [{ type: 'rect', x: 0, y: 0, w: width, h: ORBIT_H * s, fill: '#0f1b2d', stroke: '#c5ced8', strokeWidth: 0.8 }];
  if (showTray) {
    items.push({ type: 'rect', x: TRAY_BOX.x * s, y: TRAY_BOX.y * s, w: TRAY_BOX.w * s, h: TRAY_BOX.h * s, fill: 'none', stroke: '#5b6b80', strokeWidth: 1, dash: [4, 3] });
    items.push({ type: 'text', x: (TRAY_BOX.x + 6) * s, y: (TRAY_BOX.y + 12) * s, text: '처음 위치', size: 10 * s, fill: '#8fa0b5' });
  }
  for (const k of BODY_KEYS) {
    const b = BODIES[k];
    const p = v[k] || TRAY[k];
    const cx = p.x * s, cy = p.y * s;
    items.push({ type: 'circle', cx, cy, r: b.r * s, fill: b.fill, stroke: b.stroke, strokeWidth: 1.4 });
    const moved = v[k]?.placed !== false;
    items.push({ type: 'text', x: cx, y: cy + b.r * s + 12 * s, text: !showTray && !moved ? `${b.label}(안 옮김)` : b.label, size: 11 * s, anchor: 'middle', fill: moved ? '#e8edf3' : '#8fa0b5', bold: true });
  }
  return { items, width, height: ORBIT_H * s };
}

// 태양·지구·달 배치판(문항 ④): 태양과 지구는 고정, 달은 지구 둘레의 공전 궤도 위에서만 움직인다.
// 조석 자료만으로는 같은 대조(소조)라도 달의 위치가 어느 쪽인지 구별할 수 없으므로, 달을 두 개(달 1·달 2) 두고
// '달이 있을 수 있는 위치를 모두' 나타내게 한다.
// 저장 값은 달마다 위치각(도, 지구에서 오른쪽=0°, 시계 반대 방향으로 증가). 앱은 '맞는 배치'를 판정·표시하지 않는다.
// 그리기 목록 형식이라 화면(SVG)과 PDF가 같이 쓴다.
export const ORBIT_W = 560;
export const ORBIT_H = 300;
export const SUN = { x: 66, y: 150, r: 44, label: '태양' };
export const EARTH = { x: 360, y: 150, r: 18, label: '지구' };
export const MOON_R = 10;
export const ORBIT_R = 100;
// 처음 위치: 대조·소조 어느 쪽과도 겹치지 않고, 서로 마주 보지도 않는 각도(정답 모양을 암시하지 않음). 옮기기 전에는 '배치하지 않음'
export const START_ANGLES = [35, 125];
export const MOON_COUNT = 2;
// 달은 궤도 위 네 자리(90° 간격: 0°·90°·180°·270°)에만 놓인다(학생이 옮길 때 가장 가까운 자리로 맞춤)
export const SLOT_STEP = 90;
export const SLOTS = [0, 90, 180, 270];
export const snapAngle = (a) => ((Math.round(a / SLOT_STEP) * SLOT_STEP) % 360 + 360) % 360;
const rad = (d) => (d * Math.PI) / 180;

export function moonXY(angle) {
  return { x: EARTH.x + ORBIT_R * Math.cos(rad(angle)), y: EARTH.y - ORBIT_R * Math.sin(rad(angle)) };
}
/** 판 좌표 → 달의 위치각(0~360, 1° 단위) */
export function angleAt(x, y) {
  const a = (Math.atan2(-(y - EARTH.y), x - EARTH.x) * 180) / Math.PI;
  return ((Math.round(a) % 360) + 360) % 360;
}
export function emptyOrbit() { return { moons: START_ANGLES.map((angle) => ({ angle, placed: false })) }; }
/** 이전 저장 형식({moon})도 읽는다 */
export function normalizeOrbit(o) {
  const e = emptyOrbit();
  if (Array.isArray(o?.moons)) return { moons: e.moons.map((d, i) => (o.moons[i] && typeof o.moons[i].angle === 'number' ? { angle: o.moons[i].angle, placed: !!o.moons[i].placed } : d)) };
  if (o?.moon && typeof o.moon.angle === 'number') return { moons: [{ angle: o.moon.angle, placed: !!o.moon.placed }, e.moons[1]] };
  return e;
}
export const isEmptyOrbit = (o) => !o || !normalizeOrbit(o).moons.some((m) => m.placed);

export function orbitLayout(o, width = ORBIT_W, { forReport = false } = {}) {
  const v = normalizeOrbit(o);
  const s = width / ORBIT_W;
  const S = (n) => n * s;
  const items = [{ type: 'rect', x: 0, y: 0, w: width, h: S(ORBIT_H), fill: '#0f1b2d', stroke: '#c5ced8', strokeWidth: 0.8 }];
  // 햇빛 방향(태양 → 오른쪽)
  for (const dy of [-70, -35, 35, 70]) items.push({ type: 'line', x1: S(SUN.x + SUN.r + 10), y1: S(SUN.y + dy * 0.5), x2: S(SUN.x + SUN.r + 70), y2: S(SUN.y + dy), stroke: '#6d5a2a', width: S(1), dash: [S(4), S(4)] });
  items.push({ type: 'text', x: S(SUN.x + SUN.r + 40), y: S(SUN.y - 82), text: '햇빛', size: S(10), anchor: 'middle', fill: '#b9a46a' });
  // 공전 궤도
  const pts = [];
  for (let d = 0; d <= 360; d += 6) { const p = moonXY(d); pts.push([S(p.x), S(p.y)]); }
  items.push({ type: 'polyline', pts, stroke: '#7d8ea6', width: S(1.2), dash: [S(5), S(4)] });
  items.push({ type: 'text', x: S(EARTH.x + ORBIT_R * 0.72 + 6), y: S(EARTH.y - ORBIT_R * 0.72 - 6), text: '달의 공전 궤도', size: S(10), anchor: 'start', fill: '#8fa0b5' });
  // 달을 놓을 수 있는 네 자리
  for (const d of SLOTS) { const p = moonXY(d); items.push({ type: 'circle', cx: S(p.x), cy: S(p.y), r: S(MOON_R + 3), fill: 'none', stroke: '#56677f', strokeWidth: 1, dash: [S(2), S(2)] }); }
  // 태양·지구(고정)
  items.push({ type: 'circle', cx: S(SUN.x), cy: S(SUN.y), r: S(SUN.r), fill: '#f6b93b', stroke: '#c77d00', strokeWidth: 1.4 });
  items.push({ type: 'text', x: S(SUN.x), y: S(SUN.y + 4), text: SUN.label, size: S(12), anchor: 'middle', fill: '#5c3a00', bold: true });
  items.push({ type: 'circle', cx: S(EARTH.x), cy: S(EARTH.y), r: S(EARTH.r), fill: '#3c7dd9', stroke: '#1f4f99', strokeWidth: 1.4 });
  items.push({ type: 'text', x: S(EARTH.x), y: S(EARTH.y + EARTH.r + 13), text: EARTH.label, size: S(11), anchor: 'middle', fill: '#e8edf3', bold: true });
  // 달 1·달 2
  v.moons.forEach((mn, i) => {
    const m = moonXY(mn.angle);
    const placed = !!mn.placed;
    if (forReport && !placed) return;
    items.push({ type: 'circle', cx: S(m.x), cy: S(m.y), r: S(MOON_R), fill: placed ? '#d7dbe2' : '#7b8494', stroke: placed ? '#ffffff' : '#9aa5b1', strokeWidth: 1.2 });
    items.push({ type: 'text', x: S(m.x), y: S(m.y - MOON_R - 5), text: `달 ${i + 1}${placed ? '' : '(옮기기 전)'}`, size: S(10.5), anchor: 'middle', fill: placed ? '#e8edf3' : '#9aa5b1', bold: true });
  });
  return { items, width, height: S(ORBIT_H) };
}

/** 이전 배치판(천체를 자유롭게 놓던 형식)에 저장된 답 — 지우지 않고 보고서에만 그대로 그림 */
export function freeOrbitLayout(o, width = ORBIT_W) {
  const s = width / ORBIT_W;
  const B = { sun: ['태양', 34, '#f6b93b'], earth: ['지구', 17, '#3c7dd9'], moon: ['달', 10, '#c9ced6'] };
  const items = [{ type: 'rect', x: 0, y: 0, w: width, h: ORBIT_H * s, fill: '#0f1b2d', stroke: '#c5ced8', strokeWidth: 0.8 }];
  for (const [k, [label, r, fill]] of Object.entries(B)) {
    const p = o?.[k];
    if (!p) continue;
    items.push({ type: 'circle', cx: p.x * s, cy: p.y * s, r: r * s, fill, stroke: '#ffffff', strokeWidth: 1 });
    items.push({ type: 'text', x: p.x * s, y: (p.y + r + 12) * s, text: label, size: 11 * s, anchor: 'middle', fill: '#e8edf3', bold: true });
  }
  return { items, width, height: ORBIT_H * s };
}

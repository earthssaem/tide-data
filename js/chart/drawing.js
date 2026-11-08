// 학생 그림(선·글자) → 그리기 목록. 화면 미리보기(SVG)와 PDF(벡터)에 같이 쓴다.
// 앱은 그림을 만들거나 정답 배치를 넣지 않는다. 학생이 그린 선과 글자만 그대로 옮긴다.

export const DRAW_W = 640;
export const DRAW_H = 360;

export function isEmptyDrawing(d) {
  return !d || (!(d.strokes || []).length && !(d.texts || []).length);
}

/** @returns {{items:Array, width:number, height:number}} */
export function drawingLayout(d, width) {
  const w = d?.w || DRAW_W, h = d?.h || DRAW_H;
  const k = width / w;
  const items = [{ type: 'rect', x: 0, y: 0, w: width, h: h * k, fill: '#ffffff', stroke: '#9aa5b1', strokeWidth: 0.8 }];
  for (const s of d?.strokes || []) {
    if (s.p.length === 1) items.push({ type: 'circle', cx: s.p[0][0] * k, cy: s.p[0][1] * k, r: (s.w * k) / 2, fill: s.c });
    else items.push({ type: 'polyline', pts: s.p.map(([x, y]) => [x * k, y * k]), stroke: s.c, width: Math.max(0.6, s.w * k) });
  }
  for (const t of d?.texts || []) items.push({ type: 'text', x: t.x * k, y: t.y * k, text: t.t, size: Math.max(6, t.s * k), fill: t.c });
  return { items, width, height: h * k };
}

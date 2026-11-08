// PDF 보고서 생성 (브라우저 안에서 처리, 외부 전송 없음)
// - A4 세로, 첫 페이지 상단에 제목과 학생 정보
// - 한글 글꼴(Noto Sans KR, OFL)을 PDF에 포함 → 다른 컴퓨터에서도 글자가 깨지지 않음
// - 본문은 검색·복사 가능한 텍스트, 그래프는 벡터 도형으로 그려 인쇄해도 선명함
// - 화면 캡처를 잘라 붙이지 않고 문항·답변·그래프 단위로 배치

import { drawingLayout, isEmptyDrawing } from '../chart/drawing.js';
import { layoutFigure } from './model.js';
import { orbitLayout, isEmptyOrbit } from '../chart/orbit.js';

const FONT_URL = 'fonts/NotoSansKR-Regular.ttf';
const LIBS = ['vendor/pdf-lib.min.js', 'vendor/fontkit.umd.min.js'];

const A4 = [595.28, 841.89];
const M = { top: 54, bottom: 62, left: 54, right: 54 };
const CW = A4[0] - M.left - M.right;

const C = {
  text: '#1d2733', muted: '#5b6675', navy: '#1f3a68', teal: '#0f8b8d', rule: '#c5ced8',
  light: '#eef2f6', warnBg: '#fff6e5', warn: '#8a4b00', table: '#d5dce4',
};

let fontBytesCache = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`${src}를 불러오지 못했습니다.`));
    document.head.append(s);
  });
}

async function ensureLibs() {
  if (!window.PDFLib) await loadScript(LIBS[0]);
  if (!window.fontkit) await loadScript(LIBS[1]);
  if (!window.PDFLib || !window.fontkit) throw new Error('PDF 생성 도구를 불러오지 못했습니다.');
}

async function fontBytes() {
  if (fontBytesCache) return fontBytesCache;
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`한글 글꼴 파일을 불러오지 못했습니다 (HTTP ${res.status}).`);
  fontBytesCache = await res.arrayBuffer();
  return fontBytesCache;
}

function hex(c) {
  const { rgb } = window.PDFLib;
  if (!c || c === 'none') return null;
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  if (!m) return rgb(0, 0, 0);
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}

/**
 * @param {object} model buildReport() 결과
 * @param {object} cd CaseData
 * @param {{onProgress?:(msg:string)=>void}} opts
 * @returns {Promise<{bytes:Uint8Array, pages:number, replacedChars:number}>}
 */
export async function generatePdf(model, { onProgress = () => {} } = {}) {
  onProgress('PDF 도구를 불러오는 중…');
  await ensureLibs();
  const { PDFDocument, pushGraphicsState, popGraphicsState, setTextRenderingMode, TextRenderingMode, setLineWidth, setStrokingColor, degrees, LineCapStyle } = window.PDFLib;
  onProgress('한글 글꼴을 불러오는 중…');
  const bytes = await fontBytes();
  onProgress('페이지를 구성하는 중…');
  const doc = await PDFDocument.create();
  doc.registerFontkit(window.fontkit);
  // 주의: 이 글꼴은 pdf-lib의 부분 포함(subset)에서 글자가 빠지는 문제가 있어 전체를 포함한다.
  const font = await doc.embedFont(bytes, { subset: false });
  doc.setTitle(`${model.title} - ${model.studentLine}`);
  doc.setAuthor(model.studentLine);
  doc.setSubject(model.isSample ? `${model.caseTitle} (기능 확인용 예시 데이터)` : model.caseTitle);
  doc.setCreator(model.appName);
  doc.setProducer(`${model.appName} (pdf-lib)`);
  doc.setLanguage('ko-KR');

  const charset = new Set(font.getCharacterSet());
  let replaced = 0;
  const clean = (s) => {
    let out = '';
    for (const ch of String(s ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ')) {
      const cp = ch.codePointAt(0);
      if (ch === '\n' || charset.has(cp)) out += ch;
      else if (cp === 0x2212) out += '-';
      else if (cp === 0x00a0 || cp === 0x3000) out += ' ';
      else { out += '?'; replaced++; }
    }
    return out;
  };
  const width = (s, size) => font.widthOfTextAtSize(s, size);

  // ── 쪽 관리 ──
  const pages = [];
  let page = null;
  let y = 0; // PDF 좌표(아래가 0)
  const newPage = () => {
    page = doc.addPage(A4);
    pages.push(page);
    y = A4[1] - M.top;
  };
  const room = () => y - M.bottom;
  const ensure = (h) => { if (h > room()) newPage(); };

  function drawText(str, x, yy, { size = 10, color = C.text, bold = false, rotate = 0 } = {}) {
    const s = clean(str);
    if (!s) return;
    const opts = { x, y: yy, size, font, color: hex(color) };
    if (rotate) opts.rotate = degrees(rotate);
    if (bold) {
      page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.FillAndOutline), setLineWidth(size * 0.035), setStrokingColor(hex(color)));
      page.drawText(s, opts);
      page.pushOperators(popGraphicsState());
    } else page.drawText(s, opts);
  }

  /** 줄바꿈 유지 + 폭에 맞춘 줄 나누기 */
  function wrap(text, size, maxW) {
    const lines = [];
    const paras = clean(text).split('\n');
    for (const para of paras) {
      if (para === '') { lines.push(''); continue; }
      const tokens = para.match(/\S+|\s+/g) || [];
      let line = '';
      let lw = 0;
      for (const tok of tokens) {
        const tw = width(tok, size);
        if (lw + tw <= maxW) { line += tok; lw += tw; continue; }
        if (/^\s+$/.test(tok)) { lines.push(line.replace(/\s+$/, '')); line = ''; lw = 0; continue; }
        if (line.trim()) { lines.push(line.replace(/\s+$/, '')); line = ''; lw = 0; }
        if (tw <= maxW) { line = tok; lw = tw; continue; }
        // 한 단어가 너무 길면 글자 단위로 나눔
        for (const ch of tok) {
          const cw = width(ch, size);
          if (lw + cw > maxW && line) { lines.push(line); line = ''; lw = 0; }
          line += ch; lw += cw;
        }
      }
      lines.push(line.replace(/\s+$/, ''));
    }
    return lines;
  }

  /** 문단 출력: 줄 단위로 쪽을 넘김(긴 답변도 잘리지 않음) */
  function paragraph(text, { size = 10, color = C.text, bold = false, indent = 0, lead = 1.55, after = 4, maxW = CW - indent } = {}) {
    const lh = size * lead;
    for (const line of wrap(text, size, maxW)) {
      ensure(lh);
      y -= lh;
      if (line) drawText(line, M.left + indent, y + (lh - size) / 2 + size * 0.12, { size, color, bold });
    }
    y -= after;
  }

  function measureParagraph(text, size, maxW, lead = 1.55) {
    return wrap(text, size, maxW).length * size * lead;
  }

  function rule(color = C.rule, thick = 0.8, gapBefore = 4, gapAfter = 8) {
    y -= gapBefore;
    page.drawLine({ start: { x: M.left, y }, end: { x: M.left + CW, y }, thickness: thick, color: hex(color) });
    y -= gapAfter;
  }

  function box(h, { fill, stroke, x = M.left, w = CW }) {
    page.drawRectangle({ x, y: y - h, width: w, height: h, color: hex(fill) || undefined, borderColor: hex(stroke) || undefined, borderWidth: stroke ? 0.9 : 0 });
  }

  // ── 표 ──
  function table(head, rows, { size = 8.6, colMin = 34 } = {}) {
    const pad = 4;
    const n = head.length;
    const natural = head.map((hd, i) => Math.max(width(clean(hd), size), ...rows.map((r) => width(clean(r[i] ?? ''), size))) + pad * 2);
    let widths = natural.map((w) => Math.max(colMin, w));
    const total = widths.reduce((a, b) => a + b, 0);
    if (total > CW) {
      // 넓은 열부터 줄여서 맞춤(줄바꿈 허용)
      const fixed = widths.map((w) => Math.min(w, CW / n));
      const fixedSum = fixed.reduce((a, b) => a + b, 0);
      const extra = CW - fixedSum;
      const over = widths.map((w, i) => Math.max(0, w - fixed[i]));
      const overSum = over.reduce((a, b) => a + b, 0) || 1;
      widths = fixed.map((f, i) => f + (extra * over[i]) / overSum);
    } else {
      widths = widths.map((w) => (w * CW) / total);
    }
    const lh = size * 1.4;
    const rowLines = (r) => r.map((c, i) => wrap(String(c ?? ''), size, widths[i] - pad * 2));
    const drawRow = (cells, { header = false } = {}) => {
      const lines = rowLines(cells);
      const h = Math.max(...lines.map((l) => l.length)) * lh + pad * 2 - 2;
      ensure(h);
      if (header) page.drawRectangle({ x: M.left, y: y - h, width: CW, height: h, color: hex(C.light) });
      let x = M.left;
      lines.forEach((ls, i) => {
        ls.forEach((ln, k) => drawText(ln, x + pad, y - pad - (k + 1) * lh + lh * 0.3, { size, bold: header || i === 0, color: header ? C.navy : C.text }));
        x += widths[i];
      });
      page.drawLine({ start: { x: M.left, y: y - h }, end: { x: M.left + CW, y: y - h }, thickness: 0.5, color: hex(C.table) });
      y -= h;
      return h;
    };
    const headH = Math.max(...rowLines(head).map((l) => l.length)) * lh + pad * 2;
    const firstH = rows.length ? Math.max(...rowLines(rows[0]).map((l) => l.length)) * lh + pad * 2 : 0;
    ensure(headH + firstH);
    page.drawLine({ start: { x: M.left, y }, end: { x: M.left + CW, y }, thickness: 0.8, color: hex(C.navy) });
    drawRow(head, { header: true });
    for (const r of rows) {
      const h = Math.max(...rowLines(r).map((l) => l.length)) * lh + pad * 2;
      if (h > room()) { newPage(); page.drawLine({ start: { x: M.left, y }, end: { x: M.left + CW, y }, thickness: 0.8, color: hex(C.navy) }); drawRow(head, { header: true }); }
      drawRow(r);
    }
    y -= 6;
  }

  // ── 그래프(벡터) ──
  const chartMeasure = (t, s) => width(clean(t), s);
  function drawLayout(L, x0, yTop) {
    const X = (x) => x0 + x;
    const Y = (yy) => yTop - yy;
    for (const it of L.items) {
      switch (it.type) {
        case 'rect': {
          const w = Math.max(0, it.w), h = Math.max(0, it.h);
          if (w <= 0 || h <= 0) break;
          const o = { x: X(it.x), y: Y(it.y + h), width: w, height: h };
          const fill = it.fill && it.fill !== 'none' ? hex(it.fill) : null;
          if (fill) { o.color = fill; if (it.opacity != null) o.opacity = it.opacity; }
          if (it.stroke && it.stroke !== 'none' && it.strokeWidth) {
            o.borderColor = hex(it.stroke); o.borderWidth = it.strokeWidth;
            if (it.dash) o.borderDashArray = it.dash;
          }
          if (!fill && !o.borderColor) break;
          page.drawRectangle(o);
          break;
        }
        case 'line':
          page.drawLine({ start: { x: X(it.x1), y: Y(it.y1) }, end: { x: X(it.x2), y: Y(it.y2) }, thickness: it.width || 1, color: hex(it.stroke), dashArray: it.dash || undefined });
          break;
        case 'polyline': {
          if (it.pts.length < 2) break;
          const d = it.pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ');
          page.drawSvgPath(d, { x: x0, y: yTop, borderColor: hex(it.stroke), borderWidth: it.width || 1, borderDashArray: it.dash || undefined, borderLineCap: LineCapStyle.Round });
          break;
        }
        case 'polygon': {
          const d = it.pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ') + ' Z';
          const o = { x: x0, y: yTop };
          if (it.fill && it.fill !== 'none') o.color = hex(it.fill);
          if (it.stroke && it.stroke !== 'none') { o.borderColor = hex(it.stroke); o.borderWidth = it.strokeWidth || 1; }
          page.drawSvgPath(d, o);
          break;
        }
        case 'circle': {
          const o = { x: X(it.cx), y: Y(it.cy), size: it.r };
          if (it.fill && it.fill !== 'none') o.color = hex(it.fill);
          if (it.stroke && it.stroke !== 'none') { o.borderColor = hex(it.stroke); o.borderWidth = it.strokeWidth || 1; }
          page.drawCircle(o);
          break;
        }
        case 'text': {
          const s = clean(it.text);
          const w = width(s, it.size);
          const f = it.anchor === 'middle' ? 0.5 : it.anchor === 'end' ? 1 : 0;
          if (it.rotate === -90) {
            drawText(s, X(it.x), Y(it.y + w * f), { size: it.size, color: it.fill, bold: it.bold, rotate: 90 });
          } else {
            drawText(s, X(it.x - w * f), Y(it.y), { size: it.size, color: it.fill, bold: it.bold });
          }
          break;
        }
        default: break;
      }
    }
  }

  function sideBySide(sb, answer, emptyText) {
    const gap = 14;
    const colW = (CW - gap) / 2;
    const size = 10;
    const lh = size * 1.55;
    const L = sb.left.trim() ? wrap(sb.left, size, colW - 10) : [];
    const R = answer.trim() ? wrap(answer, size, colW - 10) : [];
    const tl = wrap(sb.leftTitle, 8.6, colW - 4), tr = wrap(sb.rightTitle, 8.6, colW - 4);
    const th = Math.max(tl.length, tr.length) * 8.6 * 1.4 + 6;
    ensure(th + lh * 3);
    page.drawRectangle({ x: M.left, y: y - th, width: colW, height: th, color: hex(C.light) });
    page.drawRectangle({ x: M.left + colW + gap, y: y - th, width: colW, height: th, color: hex(C.light) });
    tl.forEach((ln, k) => drawText(ln, M.left + 4, y - 4 - (k + 1) * 8.6 * 1.4 + 3, { size: 8.6, bold: true, color: C.navy }));
    tr.forEach((ln, k) => drawText(ln, M.left + colW + gap + 4, y - 4 - (k + 1) * 8.6 * 1.4 + 3, { size: 8.6, bold: true, color: C.teal }));
    y -= th + 2;
    const rows = Math.max(L.length || 1, R.length || 1);
    for (let i = 0; i < rows; i++) {
      ensure(lh);
      y -= lh;
      const ty = y + (lh - size) / 2 + size * 0.12;
      if (i === 0 && !L.length) drawText(emptyText, M.left + 6, ty, { size, color: C.muted });
      else if (L[i]) drawText(L[i], M.left + 6, ty, { size, color: C.text });
      if (i === 0 && !R.length) drawText(emptyText, M.left + colW + gap + 6, ty, { size, color: C.muted });
      else if (R[i]) drawText(R[i], M.left + colW + gap + 6, ty, { size, color: C.text });
      page.drawLine({ start: { x: M.left + colW + gap / 2, y: y + lh }, end: { x: M.left + colW + gap / 2, y }, thickness: 0.6, color: hex(C.rule) });
    }
    y -= 6;
  }


  function figureBlock(f) {
    const layouts = layoutFigure(f, { width: CW, measure: chartMeasure, fontSize: 9 });
    const capLines = wrap(f.caption, 9, CW - 12);
    const capH = capLines.length * 9 * 1.45 + 8;
    const total = capH + layouts.reduce((a, L) => a + L.height + 6, 0);
    const avail = A4[1] - M.top - M.bottom;
    ensure(total <= avail ? total : capH + (layouts[0]?.height || 0) + 6);
    y -= 2;
    page.drawRectangle({ x: M.left, y: y - capH, width: CW, height: capH, color: hex(C.light) });
    capLines.forEach((ln, n) => drawText(ln, M.left + 6, y - 4 - (n + 1) * 9 * 1.45 + 3, { size: 9, bold: true, color: C.navy }));
    y -= capH + 4;
    for (const L of layouts) {
      ensure(L.height + 6);
      drawLayout(L, M.left + Math.max(0, (CW - L.width) / 2), y);
      y -= L.height + 6;
    }
    y -= 4;
  }

  function qaHead(q) {
    const qH = measureParagraph(q.text, 10, CW - 4, 1.5) + 18;
    ensure(qH + 34);
    y -= 6;
    drawText(q.label, M.left, y - 11, { size: 10.5, bold: true, color: C.navy });
    y -= 16;
    paragraph(q.text, { size: 10, color: C.text, lead: 1.5, after: 3 });
    if (q.lockedNote) paragraph(q.lockedNote, { size: 8.4, color: C.muted, lead: 1.4, after: 3 });
  }

  function qaBlock(q) {
    qaHead(q);
    ensure(30);
    drawText('답', M.left, y - 10, { size: 8.6, bold: true, color: C.teal });
    y -= 13;
    if (q.empty || !q.lines.length) { paragraph(q.waitNote ? `(${q.waitNote})` : '(작성하지 않음)', { size: 10, color: C.muted, indent: 10, after: 6 }); return; }
    const startY = y, startPage = page;
    for (const ln of q.lines) paragraph(ln, { size: 10.5, color: C.text, indent: 10, lead: 1.6, after: 1 });
    if (page === startPage) page.drawLine({ start: { x: M.left + 3, y: startY - 2 }, end: { x: M.left + 3, y: y + 2 }, thickness: 1.4, color: hex(C.teal) });
    y -= 6;
  }

  function drawingsBlock(q) {
    qaHead(q);
    const gap = 12;
    const w = (CW - gap) / 2;
    const Ls = q.items.map((it) => ('orbit' in it ? (isEmptyOrbit(it.orbit) ? null : orbitLayout(it.orbit, w, { showTray: false })) : (isEmptyDrawing(it.drawing) ? null : drawingLayout(it.drawing, w))));
    const hh = Math.max(60, ...Ls.map((L) => (L ? L.height : 60)));
    ensure(hh + 24);
    q.items.forEach((it, n) => {
      const x = M.left + n * (w + gap);
      drawText(it.title, x, y - 10, { size: 9, bold: true, color: C.teal });
      if (Ls[n]) drawLayout(Ls[n], x, y - 14);
      else drawText('orbit' in it ? '(배치하지 않음)' : '(그림 없음)', x + 6, y - 32, { size: 9.5, color: C.muted });
      page.drawRectangle({ x, y: y - 14 - hh, width: w, height: hh, borderColor: hex(C.rule), borderWidth: 0.6 });
    });
    y -= hh + 22;
  }

  function sideBlock(q) {
    qaHead(q);
    sideBySide({ leftTitle: q.leftTitle, left: q.left || '', rightTitle: q.rightTitle }, q.right || '', '(작성하지 않음)');
    y -= 4;
  }

  function tableBlock(t) {
    ensure(40);
    paragraph(t.title, { size: 9.2, bold: true, color: C.text, after: 2 });
    table(t.head, t.rows);
  }

  function sectionHeading(title, sub) {
    ensure(70);
    y -= 10;
    drawText(title, M.left, y - 15, { size: 14, bold: true, color: C.navy });
    y -= 22;
    page.drawLine({ start: { x: M.left, y }, end: { x: M.left + CW, y }, thickness: 1.4, color: hex(C.navy) });
    y -= 8;
    if (sub) paragraph(sub, { size: 9, color: C.muted, lead: 1.45, after: 4 });
  }

  // ───────── 첫 페이지 머리 ─────────
  newPage();
  drawText(model.title, M.left, y - 20, { size: 19, bold: true, color: C.navy });
  y -= 30;
  drawText(model.studentLine, M.left, y - 13, { size: 13, bold: true });
  const stamp = `작성일 ${model.createdText} · ${model.appName}`;
  drawText(stamp, M.left + CW - width(clean(stamp), 8.6), y - 12, { size: 8.6, color: C.muted });
  y -= 20;
  rule(C.navy, 1.2, 2, 10);
  if (model.isSample) {
    const txt = `기능 확인용 예시 데이터 — ${model.sampleNotice}`;
    const hgt = measureParagraph(txt, 9.5, CW - 20, 1.45) + 12;
    box(hgt, { fill: C.warnBg, stroke: '#e0a040' });
    y -= 6;
    paragraph(txt, { size: 9.5, color: C.warn, bold: true, indent: 10, lead: 1.45, maxW: CW - 20, after: 0 });
    y -= 10;
  }
  paragraph('학생 정보와 자료', { size: 10.5, bold: true, color: C.navy, after: 2 });
  table(['항목', '내용'], model.info, { size: 8.6 });

  for (const sec of model.sections) {
    sectionHeading(sec.title, sec.sub);
    for (const it of sec.items) {
      if (it.type === 'figure') figureBlock(it);
      else if (it.type === 'qa') qaBlock(it);
      else if (it.type === 'drawings') drawingsBlock(it);
      else if (it.type === 'side') sideBlock(it);
      else if (it.type === 'table') tableBlock(it);
      else if (it.type === 'note') paragraph(`※ ${it.text}`, { size: 8.8, color: C.muted, lead: 1.42, after: 6 });
    }
  }

  // ───────── 자료 출처 ─────────
  sectionHeading('자료 출처와 분석의 한계', model.isSample ? '이 보고서의 자료는 기능 확인용 예시 데이터입니다. 실제 관측값이 아닙니다.' : '');
  for (const src of model.sources) {
    ensure(30);
    paragraph(src.role, { size: 9.5, bold: true, color: C.text, after: 1, lead: 1.45 });
    for (const l of src.lines) paragraph(`· ${l}`, { size: 8.8, color: C.text, indent: 8, lead: 1.42, after: 0 });
    y -= 4;
  }
  ensure(30);
  paragraph('자료 처리 기준과 분석의 한계', { size: 9.5, bold: true, color: C.text, after: 1 });
  for (const l of model.processing) paragraph(`· ${l}`, { size: 8.8, indent: 8, lead: 1.42, after: 0 });

  // ───────── 쪽 번호·바닥글 ─────────
  const total = pages.length;
  pages.forEach((pg, n) => {
    page = pg;
    const fy = 30;
    pg.drawLine({ start: { x: M.left, y: fy + 14 }, end: { x: M.left + CW, y: fy + 14 }, thickness: 0.5, color: hex(C.rule) });
    drawText(`${model.appName} · ${model.studentLine}`, M.left, fy, { size: 8, color: C.muted });
    const num = `${n + 1} / ${total}`;
    drawText(num, M.left + CW - width(num, 8.5), fy, { size: 8.5, color: C.text });
    if (model.isSample) {
      const t = '기능 확인용 예시 데이터 — 실제 관측값 아님';
      drawText(t, M.left + CW / 2 - width(clean(t), 7.8) / 2, fy - 11, { size: 7.8, color: C.warn });
    }
  });

  onProgress('파일을 만드는 중…');
  const out = await doc.save();
  return { bytes: out, pages: total, replacedChars: replaced };
}

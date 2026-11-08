// 보고서 미리보기와 PDF 다운로드
import { h, confirmDialog, downloadBlob } from '../util/dom.js';
import { escapeHtml } from '../util/format.js';
import { buildReport, pdfFilename, layoutFigure } from '../report/model.js';
import { drawingLayout, isEmptyDrawing } from '../chart/drawing.js';
import { itemsToSVG, layoutToSVG, screenMeasure, SCREEN_FONT } from '../chart/svg.js';

export function render(app, container) {
  const { ad, store } = app;
  let model = buildReport(ad, store.state);

  container.append(h('div', { class: 'inq-head' },
    h('h1', {}, '보고서 확인·PDF'),
    h('p', { class: 'inq-intro' }, '보고서에 들어갈 내용을 확인하세요. 그래프에서 고른 지점·날짜·구간은 해당 그래프에 그대로 그려집니다. 고칠 내용이 있으면 해당 탐구로 돌아가 수정한 뒤 다시 내려받을 수 있습니다.')));

  const layout = h('div', { class: 'report-layout' });
  const side = h('aside', { class: 'report-side', 'aria-label': '확인 사항과 PDF 다운로드' });
  const paper = h('article', { class: 'report-paper', 'aria-label': '보고서 미리보기' });
  layout.append(side, paper);
  container.append(layout);

  const check = h('section', { class: 'card check-card' });
  const goto = (step, qid) => {
    app.navigate(step);
    if (qid) requestAnimationFrame(() => { const el = document.getElementById(`q-${qid}`); if (el) el.scrollIntoView({ block: 'center' }); });
  };
  const studentMissing = () => { const s = store.state.student; return !s.grade || !s.klass || !s.number || !s.name; };
  function renderCheck() {
    const m = model.missing;
    check.innerHTML = '';
    check.append(h('h2', {}, '제출 전 확인'));
    const items = [];
    if (studentMissing()) items.push(h('li', { class: 'warn' }, '학생 정보가 비어 있습니다. ', h('button', { type: 'button', class: 'link-btn', onclick: () => app.navigate('start') }, '시작 화면에서 입력')));
    const qs = m.filter((x) => x.qid);
    if (qs.length) items.push(h('li', { class: 'warn' }, `작성하지 않은 문항 ${qs.length}개`, h('ul', {}, ...qs.map((a) => h('li', {}, h('button', { type: 'button', class: 'link-btn', onclick: () => goto(a.step, a.qid) }, a.label))))));
    for (const r of m.filter((x) => x.reveal)) items.push(h('li', { class: 'info' }, h('button', { type: 'button', class: 'link-btn', onclick: () => goto(r.step) }, r.label)));
    if (!items.length) check.append(h('p', { class: 'ok-text' }, '✓ 모든 문항을 작성했습니다.'));
    else check.append(h('ul', { class: 'check-list' }, ...items));
    check.append(h('p', { class: 'muted small' }, '안내 사항이 있어도 확인한 뒤 PDF를 내려받을 수 있습니다. 앱은 비어 있는 답을 채우지 않습니다.'));
  }

  const dl = h('section', { class: 'card dl-card' });
  const dlBtn = h('button', { type: 'button', class: 'btn btn-primary btn-lg btn-block', id: 'btn-pdf' }, 'PDF 보고서 다운로드');
  const status = h('div', { class: 'pdf-status', role: 'status', 'aria-live': 'polite' });
  dl.append(
    h('h2', {}, 'PDF 보고서'),
    h('p', { class: 'small' }, '파일 이름: ', h('code', { class: 'fname' }, pdfFilename(store.state.student))),
    dlBtn, status,
    h('p', { class: 'notice notice-info submit-note' }, '다운로드한 PDF를 선생님이 안내한 곳에 제출하세요. PDF를 내려받아도 선생님께 자동으로 제출되지 않습니다.'),
    h('p', { class: 'muted small' }, 'PDF는 이 컴퓨터의 브라우저 안에서 만들어집니다. 내려받은 뒤에도 답을 고치고 다시 내려받을 수 있습니다.'),
    h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => window.print() }, '인쇄하기 (보조 기능)'));

  let busy = false;
  dlBtn.addEventListener('click', async () => {
    if (busy) return;
    model = buildReport(ad, store.state);
    renderCheck();
    const issues = [];
    if (studentMissing()) issues.push('학생 정보가 비어 있음');
    const qs = model.missing.filter((x) => x.qid);
    if (qs.length) issues.push(`작성하지 않은 문항 ${qs.length}개: ${qs.map((a) => a.label).join(', ')}`);
    if (issues.length) {
      const ok = await confirmDialog({
        title: '확인이 필요한 내용이 있습니다', html: true,
        body: `<ul>${issues.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul><p>이대로 PDF를 만들까요? 비어 있는 답은 PDF에 ‘작성하지 않음’으로 표시됩니다.</p>`,
        okLabel: '확인했고 PDF 만들기', cancelLabel: '돌아가서 작성',
      });
      if (!ok) return;
    }
    await makePdf();
  });

  async function makePdf() {
    busy = true;
    store.flush();
    dlBtn.disabled = true;
    dlBtn.textContent = 'PDF 만드는 중…';
    status.className = 'pdf-status busy';
    status.textContent = '준비 중…';
    try {
      const { generatePdf } = await import('../report/pdf.js');
      const res = await generatePdf(model, { onProgress: (msg) => { status.textContent = msg; } });
      const name = pdfFilename(store.state.student);
      downloadBlob(new Blob([res.bytes], { type: 'application/pdf' }), name);
      store.update((s) => { s.lastPdfAt = Date.now(); }, { topic: 'pdf' });
      status.className = 'pdf-status ok';
      status.innerHTML = `✓ <b>${escapeHtml(name)}</b> 파일을 만들었습니다 (${res.pages}쪽, ${(res.bytes.length / 1024 / 1024).toFixed(1)} MB). 브라우저의 다운로드 폴더를 확인하세요.${res.replacedChars ? `<br>⚠ PDF 글꼴에 없는 문자 ${res.replacedChars}개(이모지 등)는 ‘?’로 바뀌었습니다.` : ''}<br><b>다운로드한 PDF를 선생님이 안내한 곳에 제출하세요.</b>`;
      dlBtn.textContent = 'PDF 보고서 다시 다운로드';
    } catch (e) {
      console.error(e);
      status.className = 'pdf-status err';
      status.innerHTML = `⚠ PDF를 만들지 못했습니다: ${escapeHtml(e.message || String(e))}<br>작성한 답은 그대로 보존되어 있습니다. `;
      status.append(h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => makePdf() }, '다시 시도'));
      dlBtn.textContent = 'PDF 보고서 다운로드';
    } finally {
      dlBtn.disabled = false;
      busy = false;
    }
  }

  side.append(dl, check);
  renderCheck();
  renderPaper(paper, model);
  return null;
}

function drawingHtml(d) {
  if (isEmptyDrawing(d)) return '<p class="rp-empty">(그림 없음)</p>';
  const L = drawingLayout(d, 320);
  return `<div class="rp-drawing"><svg viewBox="0 0 ${L.width} ${L.height}" width="${L.width}" height="${L.height}" font-family='${SCREEN_FONT}' role="img" aria-label="학생이 그린 그림">${itemsToSVG(L.items)}</svg></div>`;
}

const linesHtml = (q) => (q.empty || !q.lines?.length
  ? `<p class="rp-empty">(${escapeHtml(q.waitNote || '작성하지 않음')})</p>`
  : q.lines.map((l) => `<p class="rp-answer">${escapeHtml(l)}</p>`).join(''));

function qHead(q) {
  return `<h4>${escapeHtml(q.label)}</h4><p class="rp-qtext">${escapeHtml(q.text)}</p>${q.lockedNote ? `<p class="rp-note-lock">${escapeHtml(q.lockedNote)}</p>` : ''}`;
}

function itemHtml(it) {
  if (it.type === 'figure') {
    const Ls = layoutFigure(it, { width: 680, measure: screenMeasure, fontSize: 11 });
    return `<figure class="rp-figure" id="rp-${escapeHtml(it.id)}"><figcaption><b>${escapeHtml(it.caption)}</b></figcaption>${Ls.map((L) => `<div class="rp-fig-svg">${layoutToSVG(L, { title: it.caption })}</div>`).join('')}</figure>`;
  }
  if (it.type === 'qa') return `<section class="rp-q" id="rp-${escapeHtml(it.id)}">${qHead(it)}<p class="rp-label">답</p>${linesHtml(it)}</section>`;
  if (it.type === 'drawings') return `<section class="rp-q" id="rp-${escapeHtml(it.id)}">${qHead(it)}<div class="rp-draw-grid">${it.items.map((d) => `<div><p class="rp-label">${escapeHtml(d.title)}</p>${drawingHtml(d.drawing)}</div>`).join('')}</div></section>`;
  if (it.type === 'side') {
    return `<section class="rp-q" id="rp-${escapeHtml(it.id)}">${qHead(it)}<div class="rp-side">
      <div><p class="rp-label">${escapeHtml(it.leftTitle)}</p>${it.left ? `<p class="rp-answer">${escapeHtml(it.left)}</p>` : '<p class="rp-empty">(작성하지 않음)</p>'}</div>
      <div><p class="rp-label">${escapeHtml(it.rightTitle)}</p>${linesHtml(it)}</div></div></section>`;
  }
  if (it.type === 'table') return `<p class="rp-label">${escapeHtml(it.title)}</p><table class="data-table compact"><thead><tr>${it.head.map((x) => `<th>${escapeHtml(x)}</th>`).join('')}</tr></thead><tbody>${it.rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  if (it.type === 'note') return `<p class="rp-note small">※ ${escapeHtml(it.text)}</p>`;
  return '';
}

function renderPaper(paper, model) {
  paper.innerHTML = `
    <header class="rp-head">
      <h2 class="rp-title">${escapeHtml(model.title)}</h2>
      <p class="rp-student">${escapeHtml(model.studentLine)}</p>
      <p class="rp-date muted small">작성일 ${escapeHtml(model.createdText)} · ${escapeHtml(model.appName)}</p>
    </header>
    ${model.isSample ? `<p class="rp-sample">기능 확인용 예시 데이터 — ${escapeHtml(model.sampleNotice)}</p>` : ''}
    <h3 class="rp-h-sm">학생 정보와 자료</h3>
    <table class="data-table compact rp-info"><tbody>${model.info.map(([k, v]) => `<tr><th scope="row">${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join('')}</tbody></table>
    ${model.sections.map((sec) => `
      <section class="rp-section" data-part="${escapeHtml(sec.key)}">
        <h3 class="rp-h">${escapeHtml(sec.title)}</h3>
        ${sec.sub ? `<p class="muted small">${escapeHtml(sec.sub)}</p>` : ''}
        ${sec.items.map(itemHtml).join('')}
      </section>`).join('')}
    <section class="rp-section rp-sources" data-part="sources">
      <h3 class="rp-h">자료 출처와 분석의 한계</h3>
      ${model.isSample ? '<p class="rp-unavail">이 보고서의 자료는 기능 확인용 예시 데이터입니다. 실제 관측값이 아닙니다.</p>' : ''}
      ${model.sources.map((x) => `<p class="rp-src"><b>${escapeHtml(x.role)}</b></p><ul>${x.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`).join('')}
      <p class="rp-src"><b>자료 처리 기준과 분석의 한계</b></p><ul>${model.processing.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>
    </section>
    <p class="rp-note muted small">미리보기는 내용 확인용입니다. 실제 PDF는 A4 쪽 단위로 나뉘고 쪽 번호가 붙습니다.</p>`;
}

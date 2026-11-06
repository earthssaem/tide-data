// 보고서 미리보기와 PDF 다운로드
import { h, confirmDialog, downloadBlob } from '../util/dom.js';
import { escapeHtml } from '../util/format.js';
import { buildReport, pdfFilename } from '../report/model.js';
import { evidenceFigureSVG, evidenceTablesHTML } from './common.js';

export function render(app, container) {
  const { cd, store } = app;
  let model = buildReport(cd, store.state);

  container.append(h('div', { class: 'inq-head' },
    h('h1', {}, '보고서 미리보기'),
    h('p', { class: 'inq-intro' }, '보고서에 들어갈 내용을 확인하세요. 고칠 내용이 있으면 해당 단계로 돌아가 수정한 뒤 다시 내려받을 수 있습니다.')));

  const layout = h('div', { class: 'report-layout' });
  const side = h('aside', { class: 'report-side', 'aria-label': '확인 사항과 PDF 다운로드' });
  const paper = h('article', { class: 'report-paper', 'aria-label': '보고서 미리보기' });
  layout.append(side, paper);
  container.append(layout);

  // ── 확인 사항 ──
  const check = h('section', { class: 'card check-card' });
  const goto = (step, qid) => {
    app.navigate(step);
    if (qid) requestAnimationFrame(() => { const el = document.getElementById(`ans-${qid}`); if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); } });
  };
  function renderCheck() {
    const m = model.missing;
    check.innerHTML = '';
    check.append(h('h2', {}, '제출 전 확인'));
    const items = [];
    if (m.student) items.push(h('li', { class: 'warn' }, '학생 정보가 비어 있습니다. ', h('button', { type: 'button', class: 'link-btn', onclick: () => app.navigate('start') }, '시작 화면에서 입력')));
    if (m.answers.length) {
      items.push(h('li', { class: 'warn' }, `작성하지 않은 문항 ${m.answers.length}개`, h('ul', {}, ...m.answers.map((a) => h('li', {}, h('button', { type: 'button', class: 'link-btn', onclick: () => goto(a.step, a.qid) }, a.label))))));
    }
    if (m.noEvidence.length) {
      items.push(h('li', { class: 'warn' }, '근거를 첨부하지 않은 탐구: ', ...m.noEvidence.map((a, i) => [i ? ', ' : '', h('button', { type: 'button', class: 'link-btn', onclick: () => goto(a.step) }, a.label)])));
    }
    if (m.noLink.length) {
      items.push(h('li', { class: 'info' }, `근거를 연결하지 않은 문항 ${m.noLink.length}개`, h('ul', {}, ...m.noLink.map((a) => h('li', {}, h('button', { type: 'button', class: 'link-btn', onclick: () => goto(a.step, a.qid) }, a.label))))));
    }
    if (model.dataVersionMismatch.length) items.push(h('li', { class: 'info' }, `근거 ${model.dataVersionMismatch.join(', ')}은(는) 다른 자료 버전에서 기록되었습니다.`));
    if (!items.length) check.append(h('p', { class: 'ok-text' }, '✓ 모든 문항을 작성했고 각 탐구에 근거가 있습니다.'));
    else check.append(h('ul', { class: 'check-list' }, ...items));
    check.append(h('p', { class: 'muted small' }, '안내 사항이 있어도 확인한 뒤 PDF를 내려받을 수 있습니다. 앱은 비어 있는 답안을 채우지 않습니다.'));
  }

  // ── 다운로드 ──
  const dl = h('section', { class: 'card dl-card' });
  const dlBtn = h('button', { type: 'button', class: 'btn btn-primary btn-lg btn-block', id: 'btn-pdf' }, 'PDF 보고서 다운로드');
  const status = h('div', { class: 'pdf-status', role: 'status', 'aria-live': 'polite' });
  const printBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => window.print() }, '인쇄하기 (보조 기능)');
  dl.append(
    h('h2', {}, 'PDF 보고서'),
    h('p', { class: 'small' }, `파일 이름: `, h('code', { class: 'fname' }, pdfFilename(store.state.student))),
    dlBtn, status,
    h('p', { class: 'notice notice-info submit-note' }, '다운로드한 PDF를 선생님이 안내한 곳에 제출하세요. PDF를 내려받아도 선생님께 자동으로 제출되지 않습니다.'),
    h('p', { class: 'muted small' }, 'PDF는 이 컴퓨터의 브라우저 안에서 만들어집니다. 내려받은 뒤에도 답안을 고치고 다시 내려받을 수 있으며, 작성 내용은 자동으로 지워지지 않습니다.'),
    printBtn,
  );

  let busy = false;
  dlBtn.addEventListener('click', async () => {
    if (busy) return;
    model = buildReport(cd, store.state);
    renderCheck();
    const m = model.missing;
    const issues = [];
    if (m.student) issues.push('학생 정보가 비어 있음');
    if (m.answers.length) issues.push(`작성하지 않은 문항 ${m.answers.length}개: ${m.answers.map((a) => a.label).join(', ')}`);
    if (m.noEvidence.length) issues.push(`근거를 첨부하지 않은 탐구: ${m.noEvidence.map((a) => a.label).join(', ')}`);
    if (issues.length) {
      const ok = await confirmDialog({
        title: '확인이 필요한 내용이 있습니다',
        html: true,
        body: `<ul>${issues.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul><p>이대로 PDF를 만들까요? 비어 있는 답안은 PDF에 ‘작성하지 않음’으로 표시됩니다.</p>`,
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
      const res = await generatePdf(model, cd, { onProgress: (msg) => { status.textContent = msg; } });
      const name = pdfFilename(store.state.student);
      downloadBlob(new Blob([res.bytes], { type: 'application/pdf' }), name);
      store.update((s) => { s.lastPdfAt = Date.now(); }, { topic: 'pdf' });
      status.className = 'pdf-status ok';
      status.innerHTML = `✓ <b>${escapeHtml(name)}</b> 파일을 만들었습니다 (${res.pages}쪽, ${(res.bytes.length / 1024 / 1024).toFixed(1)} MB). 브라우저의 다운로드 폴더를 확인하세요.${res.replacedChars ? `<br>⚠ PDF 글꼴에 없는 문자 ${res.replacedChars}개(이모지 등)는 ‘?’로 바뀌었습니다.` : ''}<br><b>다운로드한 PDF를 선생님이 안내한 곳에 제출하세요.</b>`;
      dlBtn.textContent = 'PDF 보고서 다시 다운로드';
    } catch (e) {
      console.error(e);
      status.className = 'pdf-status err';
      status.innerHTML = `⚠ PDF를 만들지 못했습니다: ${escapeHtml(e.message || String(e))}<br>작성한 답안과 근거는 그대로 보존되어 있습니다. `;
      status.append(h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => makePdf() }, '다시 시도'));
      status.append(' ', h('span', { class: 'small' }, '계속 실패하면 [인쇄하기]로 PDF 저장을 하거나 선생님께 알려 주세요.'));
      dlBtn.textContent = 'PDF 보고서 다운로드';
    } finally {
      dlBtn.disabled = false;
      busy = false;
    }
  }

  side.append(dl, check);
  renderCheck();
  renderPaper(paper, model, cd, app);
  return null;
}

function answerHtml(q) {
  return q.empty
    ? '<p class="rp-empty">(작성하지 않음)</p>'
    : `<p class="rp-answer">${escapeHtml(q.answer)}</p>`;
}

function figureHtml(cd, ev) {
  return `<figure class="rp-figure" id="fig-${escapeHtml(ev.num)}">
    <figcaption><b>그림 ${escapeHtml(ev.num)}</b> (근거 ${escapeHtml(ev.num)}) <span class="muted">탐구 ${ev.inquiry} · ${escapeHtml(ev.summary)}</span></figcaption>
    <div class="rp-fig-svg">${evidenceFigureSVG(cd, ev, 700, 11.5)}</div>
    <div class="rp-fig-tables">${evidenceTablesHTML(cd, ev)}</div>
    ${ev.memo && ev.memo.trim() ? `<p class="rp-memo"><b>학생 메모:</b> ${escapeHtml(ev.memo)}</p>` : ''}
  </figure>`;
}

function questionHtml(cd, q, kind = '문항') {
  return `<section class="rp-q">
    <h4>${kind} ${q.no}</h4>
    <p class="rp-qtext">${escapeHtml(q.text)}</p>
    ${q.unavailable ? `<p class="rp-unavail">※ ${escapeHtml(q.unavailable)}</p>` : ''}
    <p class="rp-label">답변</p>
    ${answerHtml(q)}
    <p class="rp-links">연결 근거: ${q.linkedNums.length ? q.linkedNums.map((n) => `그림 ${escapeHtml(n)}`).join(', ') : '없음'}</p>
    ${(q.figures || []).map((ev) => figureHtml(cd, ev)).join('')}
  </section>`;
}

function renderPaper(paper, model, cd) {
  paper.innerHTML = `
    <header class="rp-head">
      <h2 class="rp-title">${escapeHtml(model.title)}</h2>
      <p class="rp-student">${escapeHtml(model.studentLine)}</p>
      <p class="rp-date muted small">작성일 ${escapeHtml(model.createdText)} · ${escapeHtml(model.appName)}</p>
    </header>
    ${model.isSample ? `<p class="rp-sample">기능 확인용 예시 데이터 — ${escapeHtml(model.sampleNotice)}</p>` : ''}
    <h3 class="rp-h-sm">분석 관측소·기간·사례</h3>
    <table class="data-table compact rp-info"><tbody>${model.caseInfo.map(([k, v]) => `<tr><th scope="row">${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join('')}</tbody></table>
    ${model.sections.map((sec) => `
      <section class="rp-section">
        <h3 class="rp-h">${escapeHtml(sec.title)}</h3>
        <p class="muted small">탐구 목표: ${escapeHtml(sec.goal)}</p>
        ${sec.blocks.map((q) => questionHtml(cd, q)).join('')}
        ${sec.unlinked.length ? `<h4 class="rp-h-sm">문항에 연결하지 않은 근거</h4>${sec.unlinked.map((ev) => figureHtml(cd, ev)).join('')}` : ''}
        ${!sec.blocks.some((b) => b.figures.length) && !sec.unlinked.length ? '<p class="rp-empty">(첨부한 근거 없음)</p>' : ''}
      </section>`).join('')}
    <section class="rp-section">
      <h3 class="rp-h">${escapeHtml(model.conclusion.title)}</h3>
      ${model.conclusion.blocks.map((q) => questionHtml(cd, q, '결론')).join('')}
    </section>
    <section class="rp-section rp-sources">
      <h3 class="rp-h">자료 출처와 관측 간격</h3>
      ${model.isSample ? '<p class="rp-unavail">이 보고서의 자료는 기능 확인용 예시 데이터입니다. 실제 관측값이 아닙니다.</p>' : ''}
      ${model.sources.map((s) => `<p class="rp-src"><b>${escapeHtml(s.role)}</b></p><ul>${s.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`).join('')}
      <p class="rp-src"><b>자료 처리 기준</b></p><ul>${model.processing.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>
    </section>
    <p class="rp-note muted small">미리보기는 내용 확인용입니다. 실제 PDF는 A4 쪽 단위로 나뉘고 쪽 번호가 붙습니다.</p>`;
}

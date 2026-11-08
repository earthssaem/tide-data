// 탐구 화면 공통 요소: 문항·답안 패널, 근거 연결, 근거 카드

import { h, autosize, alertDialog } from '../util/dom.js';
import { escapeHtml } from '../util/format.js';
import { ANSWER_GUIDE, NEEDS_LABEL, REVEALS, activeQuestions, questionById } from '../content/questions.js';
import { figurePanels, panelLayout } from '../chart/specs.js';
import { layoutToSVG, screenMeasure } from '../chart/svg.js';
import { evidenceTables } from '../state/evidence.js';
import { fmtDateTime } from '../util/time.js';
import { createDrawingPad } from './drawing-pad.js';

const localTz = () => ({ offsetMinutes: -new Date().getTimezoneOffset() });

export function unavailableNeeds(cd, q) {
  return (q.needs || []).filter((k) => !cd.availability[k]);
}

export function unavailableText(cd, q) {
  const miss = unavailableNeeds(cd, q);
  if (!miss.length) return '';
  const parts = miss.map((k) => NEEDS_LABEL[k] || k);
  let reason = '';
  if (miss.includes('residual') && cd.availability.predicted && cd.residual?.problems?.length) reason = ` (${cd.residual.problems[0]})`;
  return `이 사례에는 ${parts.join(', ')}이(가) 제공되지 않아 해당 그래프·값을 확인할 수 없습니다${reason}. 확인할 수 없는 내용은 값을 지어내지 말고, 자료가 없다는 점을 답안에 밝히세요.`;
}

export function inquiryHeader(inq) {
  return h('div', { class: 'inq-head' },
    h('h1', {}, `탐구 ${inq.no}. ${inq.title}`),
    h('p', { class: 'inq-goal' }, inq.goal),
    h('p', { class: 'inq-intro' }, inq.intro));
}

export function evidenceFigureSVG(cd, ev, width = 560, fontSize = 11.5) {
  const panels = figurePanels(cd, ev, { width, measure: screenMeasure, fontSize });
  return panels.map((p) => layoutToSVG(panelLayout(p), { className: 'ev-svg', title: `근거 ${ev.num} 그래프` })).join('');
}

export function evidenceTablesHTML(cd, ev, { meta = true } = {}) {
  const { meta: m, tables } = evidenceTables(cd, ev);
  const metaHtml = meta ? `<dl class="ev-meta">${m.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl>` : '';
  const tablesHtml = tables.map((t) => `
    <div class="ev-table-wrap"><p class="ev-table-title">${escapeHtml(t.title)}</p>
    ${t.rows.length ? `<div class="table-host"><table class="data-table compact"><thead><tr>${t.head.map((x) => `<th scope="col">${escapeHtml(x)}</th>`).join('')}</tr></thead>
    <tbody>${t.rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${escapeHtml(c)}</th>` : `<td>${escapeHtml(c)}</td>`)).join('')}</tr>`).join('')}</tbody></table></div>` : `<p class="muted small">${escapeHtml(t.empty || '내용 없음')}</p>`}
    ${t.note ? `<p class="muted small">${escapeHtml(t.note)}</p>` : ''}</div>`).join('');
  return metaHtml + tablesHtml;
}

/** 이 문항이 자료 공개로 고정되었는가 */
export function lockedBy(state, q) {
  return q.lockAfter && state.reveals?.[q.lockAfter] ? state.reveals[q.lockAfter] : null;
}

/** 공개 시점에 보관한 답(없으면 현재 답) */
export function revealedAnswer(state, kind, qid) {
  const r = state.reveals?.[kind];
  if (r && typeof r.answers?.[qid] === 'string') return r.answers[qid];
  return state.answers[qid] || '';
}

/**
 * 오른쪽 문항 패널
 * @param {object} o
 * @param {object} o.app
 * @param {object} o.def INQUIRIES 항목 또는 CONCLUSION
 * @param {number|null} o.inquiryNo 근거 범위(null이면 모든 근거)
 * @param {()=>object} o.getAnalysis 현재 분석 상태(근거 교체용)
 * @param {(state)=>void} o.applyState 근거 상태를 그래프에 다시 적용
 */
export function createQuestionPanel(o) {
  const { app, def, inquiryNo } = o;
  const { store, cd } = app;
  const S = () => store.state;
  const root = h('aside', { class: 'qpanel', 'aria-label': '문항과 답안' });
  root.append(h('div', { class: 'guide' },
    h('span', { class: 'guide-label' }, '답안 작성 안내'),
    h('span', { class: 'guide-flow' }, ANSWER_GUIDE),
    h('span', { class: 'guide-sub' }, '답안은 직접 작성합니다. 근거 번호(예: 근거 1-1)를 답안에 써도 좋습니다.')));

  const list = h('ol', { class: 'questions' });
  const linkHosts = {};
  const qs = activeQuestions(def, cd.setup);
  qs.forEach((q, i) => {
    const li = h('li', { class: 'q', id: `q-${q.id}` });
    const n = i + 1;
    li.append(h('div', { class: 'q-head' }, h('span', { class: 'q-no' }, `문항 ${n}`)));
    li.append(h('p', { class: 'q-text', id: `qt-${q.id}` }, q.text));
    const un = unavailableText(cd, q);
    if (un && !(q.afterReveal && !S().reveals[q.afterReveal])) li.append(h('p', { class: 'notice notice-warn' }, un));
    if (q.tip) li.append(h('p', { class: 'q-tip' }, q.tip));
    // 공개 후에만 쓰는 문항
    if (q.afterReveal && !S().reveals[q.afterReveal]) {
      li.append(h('p', { class: 'notice notice-info q-wait' }, `${REVEALS[q.afterReveal].label}를 확인한 뒤 작성합니다. 위 문항의 답을 먼저 쓰고 [${REVEALS[q.afterReveal].label} 확인]을 누르세요.`));
      list.append(li);
      return;
    }
    // 초기 추측과 나란히 보기
    if (q.compareWith) {
      const base = questionById(q.compareWith);
      const prev = revealedAnswer(S(), 'weather', q.compareWith);
      li.append(h('div', { class: 'compare-prev' },
        h('p', { class: 'compare-prev-title' }, `탐구 4 문항 1에서 쓴 초기 추측(추가 자료 확인 전) — ${base ? base.text : ''}`),
        prev.trim() ? h('p', { class: 'compare-prev-text' }, prev) : h('p', { class: 'muted small' }, '(초기 추측을 작성하지 않음)')));
    }
    const lock = lockedBy(S(), q);
    const ta = h('textarea', {
      id: `ans-${q.id}`, class: 'answer', rows: 5, 'aria-labelledby': `qt-${q.id}`,
      placeholder: '주장 → 수치·그래프 근거 → 과학적 설명 순서로 써 보세요.', spellcheck: 'false',
    });
    ta.value = lock ? revealedAnswer(S(), q.lockAfter, q.id) : (S().answers[q.id] || '');
    const count = h('span', { class: 'count', 'aria-hidden': 'true' });
    const setCount = () => { count.textContent = `${ta.value.length}자`; };
    setCount();
    if (lock) {
      ta.readOnly = true;
      ta.classList.add('locked');
      li.append(h('p', { class: 'notice notice-lock small' }, `${REVEALS[q.lockAfter].label} 공개 전에 작성한 답변입니다(공개 ${fmtDateTime(lock.at, localTz())}). 고칠 수 없으며, 생각이 달라졌다면 다음 문항이나 다음 탐구에 쓰세요.`));
    } else {
      ta.addEventListener('input', () => {
        store.update((s) => { s.answers[q.id] = ta.value; }, { topic: 'answer' });
        setCount();
      });
    }
    autosize(ta);
    li.append(ta);
    if (q.drawing) {
      const val = lock ? (lock.drawing || null) : (S().drawings[q.id] || null);
      const pad = createDrawingPad({
        id: `draw-${q.id}`, label: `문항 ${n} 그림판`, value: val, locked: !!lock,
        onChange: (d) => store.update((s) => { if (d) s.drawings[q.id] = d; else delete s.drawings[q.id]; }, { topic: 'drawing' }),
      });
      li.append(h('p', { class: 'draw-label' }, '그림으로 설명하기(선택)'), pad.el);
    }
    const links = h('div', { class: 'links', role: 'group', 'aria-label': `문항 ${n}에 연결할 근거` });
    linkHosts[q.id] = links;
    li.append(h('div', { class: 'q-foot' }, h('span', { class: 'links-label' }, '연결한 근거'), count));
    li.append(links);
    list.append(li);
  });
  root.append(list);

  const evSec = h('section', { class: 'evidence-section', 'aria-labelledby': `evh-${def.step || 'x'}` });
  const evTitle = h('h2', { class: 'evh', id: `evh-${def.step || 'x'}` });
  const evList = h('div', { class: 'evidence-list' });
  evSec.append(evTitle, evList);
  root.append(evSec);

  const ownEvidence = !!(inquiryNo && def.evidence);
  function scopeEvidences() {
    const all = S().evidences;
    if (ownEvidence) return all.filter((e) => e.inquiry === inquiryNo);
    if (def.linkFrom) return all.filter((e) => def.linkFrom.includes(e.inquiry));
    return all;
  }
  const chipLabel = (ev) => `근거 ${ev.num}${ev.stationId && ev.stationId !== cd.station.id ? `(${ev.station})` : ''}`;

  function renderLinks() {
    const evs = scopeEvidences();
    for (const q of qs) {
      const host = linkHosts[q.id];
      if (!host) continue;
      host.innerHTML = '';
      const linked = S().links[q.id] || [];
      if (!evs.length) {
        host.append(h('span', { class: 'muted small' }, ownEvidence ? '아직 추가한 근거가 없습니다. 왼쪽에서 [현재 분석을 근거로 추가]를 누르세요.' : '연결할 수 있는 근거가 없습니다.'));
        continue;
      }
      for (const ev of evs) {
        const on = linked.includes(ev.id);
        host.append(h('button', {
          type: 'button', class: `chip${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false',
          title: on ? `${chipLabel(ev)} 연결 해제` : `${chipLabel(ev)} 연결`,
          onclick: () => {
            store.update((s) => {
              const arr = s.links[q.id] || (s.links[q.id] = []);
              const i = arr.indexOf(ev.id);
              if (i >= 0) arr.splice(i, 1); else arr.push(ev.id);
              arr.sort((a, b) => evOrder(s, a) - evOrder(s, b));
            }, { topic: 'links' });
            renderLinks();
          },
        }, `${on ? '✓ ' : ''}${chipLabel(ev)}`));
      }
    }
  }

  function renderEvidence() {
    const evs = scopeEvidences();
    evTitle.textContent = ownEvidence ? `이 탐구에서 첨부한 근거 (${evs.length})` : def.linkFrom ? `연결할 수 있는 근거 — 탐구 ${def.linkFrom.join('·')} (${evs.length})` : `첨부한 근거 (${evs.length})`;
    evList.innerHTML = '';
    if (!evs.length) {
      evList.append(h('p', { class: 'muted small empty-ev' }, ownEvidence ? '근거가 없습니다. 그래프에서 분석한 뒤 [현재 분석을 근거로 추가]를 누르면 그 순간의 그래프와 측정값이 고정되어 여기에 저장됩니다.' : '첨부한 근거가 없습니다.'));
    }
    for (const ev of evs) evList.append(evidenceCard(ev));
    renderLinks();
  }

  function evidenceCard(ev) {
    const card = h('article', { class: 'ev-card', id: `ev-${ev.id}`, 'aria-label': `근거 ${ev.num}` });
    const linkedQs = Object.entries(S().links).filter(([, ids]) => ids.includes(ev.id)).map(([qid]) => qid);
    card.append(h('header', { class: 'ev-head' },
      h('span', { class: 'ev-num' }, `근거 ${ev.num}`),
      h('span', { class: 'ev-sum' }, `탐구 ${ev.inquiry} · ${ev.station || ''} · ${ev.summary}`)));
    const fig = h('button', { type: 'button', class: 'ev-thumb', title: '크게 보기', html: evidenceFigureSVG(cd, ev, 560, 12) });
    fig.addEventListener('click', () => showEvidenceLarge(cd, ev));
    card.append(fig);
    card.append(h('p', { class: 'ev-time muted small' }, `추가 ${fmtDateTime(ev.createdAt, localTz())}${ev.updatedAt !== ev.createdAt ? ` · 교체 ${fmtDateTime(ev.updatedAt, localTz())}` : ''}${linkedQs.length ? ` · 연결 문항 ${linkedQs.length}개` : ' · 연결된 문항 없음'}`));
    const det = h('details', { class: 'ev-details' }, h('summary', {}, '측정값 보기'));
    det.append(h('div', { html: evidenceTablesHTML(cd, ev) }));
    card.append(det);
    const memoId = `memo-${ev.id}`;
    const memo = h('textarea', { id: memoId, class: 'memo', rows: 2, placeholder: '짧은 메모 (예: A·B·C는 연속한 만조로 판단)' });
    memo.value = ev.memo || '';
    memo.addEventListener('input', () => {
      store.update((s) => { const e = s.evidences.find((x) => x.id === ev.id); if (e) e.memo = memo.value; }, { topic: 'memo' });
    });
    card.append(h('label', { class: 'memo-label', for: memoId }, '학생 메모'), memo);
    const actions = h('div', { class: 'ev-actions' });
    const sameStation = !ev.stationId || ev.stationId === cd.station.id;
    if (o.applyState && ev.inquiry === inquiryNo && sameStation) {
      actions.append(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => o.applyState(JSON.parse(JSON.stringify(ev.state))) }, '이 상태를 그래프에 다시 열기'));
      actions.append(h('button', {
        type: 'button', class: 'btn btn-secondary btn-sm',
        onclick: async () => { if (await app.replaceEvidence(ev.id, o.getAnalysis())) renderEvidence(); },
      }, '현재 분석으로 교체'));
    } else if (ev.inquiry !== inquiryNo) {
      actions.append(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => app.navigate(`inq${ev.inquiry}`) }, `탐구 ${ev.inquiry}로 이동`));
    }
    if (ev.inquiry === inquiryNo || !inquiryNo) {
      actions.append(h('button', {
        type: 'button', class: 'btn btn-danger-outline btn-sm',
        onclick: async () => { if (await app.deleteEvidence(ev.id)) renderEvidence(); },
      }, '삭제'));
    }
    card.append(actions);
    return card;
  }

  renderEvidence();
  return { el: root, renderEvidence, renderLinks };
}

function evOrder(s, id) {
  const e = s.evidences.find((x) => x.id === id);
  return e ? e.inquiry * 1000 + e.seq : 1e9;
}

export async function showEvidenceLarge(cd, ev) {
  await alertDialog({
    title: `근거 ${ev.num} (탐구 ${ev.inquiry} · ${ev.station || ''})`,
    html: true,
    body: `<div class="ev-large">${evidenceFigureSVG(cd, ev, 820, 12.5)}${evidenceTablesHTML(cd, ev)}${ev.memo ? `<p><b>메모</b> ${escapeHtml(ev.memo)}</p>` : ''}</div>`,
    okLabel: '닫기',
  });
}

/** 근거 추가 버튼 영역 */
export function addEvidenceBar({ onAdd, label = '현재 분석을 근거로 추가', hint }) {
  return h('div', { class: 'add-ev-bar' },
    h('button', { type: 'button', class: 'btn btn-accent', onclick: onAdd }, `＋ ${label}`),
    h('p', { class: 'muted small' }, hint || '지금 보이는 그래프 범위, 선택 지점, 계산 결과가 그 상태 그대로 고정되어 오른쪽 근거 목록에 저장됩니다.'));
}

export function nextLetter(used) {
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  return L.find((x) => !used.includes(x)) || null;
}

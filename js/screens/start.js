// 시작 화면
import { h, confirmDialog } from '../util/dom.js';
import { escapeHtml } from '../util/format.js';
import { fmtRange, fmtDateTime } from '../util/time.js';
import { INQUIRIES } from '../content/questions.js';
import { studentLine } from '../report/model.js';

const localTz = () => ({ offsetMinutes: -new Date().getTimezoneOffset() });

export function render(app, container) {
  const { cd, store } = app;
  const s = store.state;
  const r = cd.ranges;

  const wrap = h('div', { class: 'start' });
  wrap.append(h('section', { class: 'start-hero' },
    h('h1', {}, '조석 데이터 탐구실'),
    h('p', { class: 'lead' }, '해수면 변화의 규칙을 찾고, 태풍이 남긴 흔적을 분석해 봅시다.')));

  const grid = h('div', { class: 'start-grid' });

  // ── 분석 사례 안내 ──
  const caseCard = h('section', { class: 'card', 'aria-labelledby': 'case-h' });
  const avail = [
    ['관측 조위', true],
    ['천문조 예측 조위', cd.availability.predicted],
    ['조위 잔차 비교', cd.availability.residual],
    ['기상(기압·바람)', cd.availability.weather],
    ['달의 위상', cd.availability.moonPhases],
    ['태풍 경로', !!cd.typhoon?.track?.length],
  ];
  caseCard.innerHTML = `
    <h2 id="case-h">분석 사례 안내</h2>
    ${cd.isSample ? `<p class="notice notice-sample"><b>기능 확인용 예시 데이터</b><br>${escapeHtml(cd.sampleNotice)}</p>` : ''}
    <dl class="case-dl">
      <div><dt>관측소</dt><dd>${escapeHtml(cd.station.name)}</dd></div>
      <div><dt>분석 기간</dt><dd>${escapeHtml(fmtRange(r.inq2[0], r.inq2[1], cd.tz))}</dd></div>
      <div><dt>태풍</dt><dd>${cd.typhoon ? `${escapeHtml(cd.typhoon.name)} (${escapeHtml(String(cd.typhoon.year))}년)` : '자료 미제공'}</dd></div>
      <div><dt>탐구 1 구간</dt><dd>${escapeHtml(fmtRange(r.inq1[0], r.inq1[1], cd.tz))}</dd></div>
      <div><dt>탐구 3 구간</dt><dd>${escapeHtml(fmtRange(r.inq3[0], r.inq3[1], cd.tz))}</dd></div>
      <div><dt>자료</dt><dd>${escapeHtml(cd.config.description?.provider || '')} · 관측 간격 ${cd.observed.intervalMs / 3600e3}시간 · 기준면 ${escapeHtml(cd.observed.datumLabel)} · ${escapeHtml(cd.tz.name || cd.tz.label)}</dd></div>
      <div><dt>자료 버전</dt><dd>${escapeHtml(cd.dataVersion)}</dd></div>
    </dl>
    <ul class="avail">${avail.map(([k, ok]) => `<li class="${ok ? 'ok' : 'no'}"><span aria-hidden="true">${ok ? '●' : '○'}</span> ${escapeHtml(k)}: ${ok ? '제공' : '<b>자료 미제공</b>'}</li>`).join('')}</ul>
    ${cd.issues.length ? `<p class="notice notice-warn">자료를 읽는 중 문제가 있었습니다: ${cd.issues.map((i) => escapeHtml(i.message)).join(' / ')}</p>` : ''}`;
  grid.append(caseCard);

  // ── 학생 정보 ──
  const form = h('form', { class: 'card student-form', novalidate: true, 'aria-labelledby': 'stu-h' });
  form.innerHTML = `
    <h2 id="stu-h">학생 정보</h2>
    <div class="form-row">
      <label>학년 <select name="grade" required><option value="">선택</option><option>1</option><option>2</option><option>3</option></select></label>
      <label>반 <input name="klass" inputmode="numeric" maxlength="2" required autocomplete="off"></label>
      <label>번호 <input name="number" inputmode="numeric" maxlength="2" required autocomplete="off"></label>
      <label class="grow">이름 <input name="name" maxlength="20" required autocomplete="off"></label>
    </div>
    <p class="form-error" role="alert" hidden></p>
    <div class="start-actions"></div>
    <p class="muted small">임시 저장은 현재 컴퓨터와 브라우저에 보관됩니다. 학생 정보와 답안은 외부 서버로 전송되지 않습니다.</p>`;
  const f = form.elements;
  f.grade.value = s.student.grade || '';
  f.klass.value = s.student.klass || '';
  f.number.value = s.student.number || '';
  f.name.value = s.student.name || '';
  const err = form.querySelector('.form-error');
  const actions = form.querySelector('.start-actions');

  function readStudent() {
    const st = { grade: f.grade.value.trim(), klass: f.klass.value.trim(), number: f.number.value.trim(), name: f.name.value.trim() };
    const problems = [];
    if (!st.grade) problems.push('학년을 선택하세요.');
    if (!/^\d{1,2}$/.test(st.klass)) problems.push('반은 숫자로 입력하세요.');
    if (!/^\d{1,2}$/.test(st.number)) problems.push('번호는 숫자로 입력하세요.');
    if (!st.name) problems.push('이름을 입력하세요.');
    if (problems.length) {
      err.hidden = false;
      err.textContent = problems.join(' ');
      const first = !st.grade ? f.grade : !/^\d{1,2}$/.test(st.klass) ? f.klass : !/^\d{1,2}$/.test(st.number) ? f.number : f.name;
      first.focus();
      return null;
    }
    err.hidden = true;
    return st;
  }

  const startBtn = h('button', { type: 'submit', class: 'btn btn-primary btn-lg' }, '탐구 시작');
  actions.append(startBtn);
  if (s.started) {
    const cont = h('button', { type: 'button', class: 'btn btn-accent btn-lg', id: 'btn-continue' }, '이어서 작성');
    cont.addEventListener('click', () => {
      const st = readStudent();
      if (!st) return;
      store.update((x) => { x.student = st; }, { immediate: true });
      app.navigate(s.step && s.step !== 'start' ? s.step : 'inq1');
    });
    actions.prepend(cont);
  }
  actions.append(h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => app.importBackup() }, '백업 파일 불러오기'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const st = readStudent();
    if (!st) return;
    if (s.started) {
      const ok = await confirmDialog({
        title: '새로 시작할까요?',
        body: `이 컴퓨터에 저장된 작성 내용(${studentLine(s.student)}, 답안 ${Object.values(s.answers).filter((x) => x.trim()).length}개, 근거 ${s.evidences.length}개)이 지워지고 새로 시작합니다.\n기존 내용을 계속 쓰려면 [이어서 작성]을 누르세요.`,
        okLabel: '지우고 새로 시작', danger: true,
      });
      if (!ok) return;
    }
    app.startNew(st);
  });
  grid.append(form);
  wrap.append(grid);

  // ── 저장 상태 안내 ──
  const saveCard = h('section', { class: 'card save-card', 'aria-labelledby': 'save-h' });
  saveCard.append(h('h2', { id: 'save-h' }, '저장된 작성 내용'));
  if (s.started) {
    saveCard.append(h('p', {}, `${studentLine(s.student)} · 마지막 수정 ${fmtDateTime(s.updatedAt, localTz())} · 답안 ${Object.values(s.answers).filter((x) => x.trim()).length}개 · 근거 ${s.evidences.length}개`));
  } else {
    saveCard.append(h('p', { class: 'muted' }, '이 컴퓨터에 저장된 작성 내용이 없습니다.'));
  }
  if (app.loadError) saveCard.append(h('p', { class: 'notice notice-warn' }, `저장된 내용을 읽지 못했습니다: ${app.loadError}`));
  if (app.savedOther) {
    const o = app.savedOther;
    const p = h('p', { class: 'notice notice-warn' }, `이 컴퓨터에는 다른 사례(${o.caseId})의 작성 내용이 저장되어 있습니다(${studentLine(o.student)}). `);
    p.append(h('a', { href: `?case=${encodeURIComponent(o.caseId)}`, class: 'btn btn-secondary btn-sm' }, '그 사례로 열기'));
    saveCard.append(p);
  }
  saveCard.append(h('p', { class: 'small' }, '임시 저장은 현재 컴퓨터와 브라우저에 보관됩니다. 다른 컴퓨터에서 이어서 쓰려면 백업 파일을 받아 가져가세요. 공용 컴퓨터라면 활동을 마친 뒤 내 작성 내용을 삭제하세요.'));
  const tools = h('div', { class: 'row-actions' });
  tools.append(
    h('button', { type: 'button', class: 'btn btn-secondary btn-sm', disabled: !s.started, onclick: () => app.downloadBackup() }, '작성 내용 백업 파일 받기'),
    h('button', { type: 'button', class: 'btn btn-danger-outline btn-sm', onclick: () => app.clearMyWork() }, '이 컴퓨터의 내 작성 내용 삭제'),
  );
  saveCard.append(tools);

  // ── 탐구 흐름 ──
  const flow = h('section', { class: 'card flow-card', 'aria-labelledby': 'flow-h' });
  flow.innerHTML = `<h2 id="flow-h">탐구 순서</h2>
    <ol class="flow">
      ${INQUIRIES.map((q) => `<li><b>탐구 ${q.no}. ${escapeHtml(q.title)}</b><span>${escapeHtml(q.goal)}</span></li>`).join('')}
      <li><b>종합 결론</b><span>수치와 그래프를 근거로 결론을 쓰고 분석의 한계를 설명합니다.</span></li>
      <li><b>보고서 미리보기</b><span>내용을 확인하고 PDF 보고서를 내려받아 선생님이 안내한 곳에 제출합니다.</span></li>
    </ol>`;
  const bottom = h('div', { class: 'start-grid' }, flow, saveCard);
  wrap.append(bottom);
  container.append(wrap);
  return null;
}

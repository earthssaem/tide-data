// 시작 화면
// 첫 화면에는 사례(태풍 이름·날짜 등)를 보여 주지 않는다. 학생은 관측 자료에서 특징을 먼저 발견한다.
import { h, confirmDialog } from '../util/dom.js';
import { escapeHtml } from '../util/format.js';
import { fmtDateTime } from '../util/time.js';
import { INQUIRIES } from '../content/questions.js';
import { studentLine } from '../report/model.js';
import { legacyList } from '../state/persistence.js';

const localTz = () => ({ offsetMinutes: -new Date().getTimezoneOffset() });
export const START_LEAD = '우리나라 바다의 해수면 높이 자료에서 규칙을 찾고, 예측과 실제를 비교하며 해수면에 영향을 주는 요인을 탐구해 봅시다.';

const filled = (s) => {
  const a = s.answers;
  let n = 0;
  if (a.q1.high || a.q1.low || a.q1.range) n++;
  if (a.q2.high || a.q2.low || a.q2.period) n++;
  if (a.q3.spring || a.q3.neap) n++;
  if (a.q4.spring || a.q4.neap) n++;
  if (a.q5.some(Boolean)) n++;
  if (Object.keys(a.q6).length) n++;
  for (const k of ['q9', 'q10', 'q12']) if (String(a[k] || '').trim()) n++;
  if (a.q11 && (a.q11.peak || a.q11.pressure || a.q11.wind || a.q11.pressureText || a.q11.windText || a.q11.old)) n++;
  return n;
};

export function render(app, container) {
  const { store } = app;
  const s = store.state;

  const wrap = h('div', { class: 'start' });
  wrap.append(h('section', { class: 'start-hero' },
    h('h1', {}, '조석 데이터 탐구실'),
    h('p', { class: 'lead' }, START_LEAD)));
  if (app.mode === 'preview') {
    wrap.append(h('p', { class: 'notice notice-accent', id: 'preview-note' }, h('b', {}, '교사용 미리보기'), ` — 학생 화면과 같은 흐름입니다. 여기서 쓴 내용은 학생 답안과 따로 저장됩니다(이 브라우저의 미리보기 저장 공간).${app.setupSource ? ` 적용한 설정: ${app.setupSource}` : ''}`));
  }

  const grid = h('div', { class: 'start-grid' });
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

  const startBtn = h('button', { type: 'submit', class: 'btn btn-primary btn-lg', id: 'btn-start' }, '탐구 시작하기');
  actions.append(startBtn);
  if (s.started) {
    const cont = h('button', { type: 'button', class: 'btn btn-accent btn-lg', id: 'btn-continue' }, '이어서 작성하기');
    cont.addEventListener('click', () => {
      const st = readStudent();
      if (!st) return;
      app.continueWork(st);
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
        body: `이 컴퓨터에 저장된 작성 내용(${studentLine(s.student)}, 작성한 문항 ${filled(s)}개)이 지워지고 새로 시작합니다.\n기존 내용을 계속 쓰려면 [이어서 작성하기]를 누르세요.`,
        okLabel: '지우고 새로 시작', danger: true,
      });
      if (!ok) return;
    }
    app.startNew(st);
  });
  grid.append(form);

  // ── 저장 상태 안내 ──
  const saveCard = h('section', { class: 'card save-card', 'aria-labelledby': 'save-h' });
  saveCard.append(h('h2', { id: 'save-h' }, '저장된 작성 내용'));
  if (s.started) {
    saveCard.append(h('p', {}, `${studentLine(s.student)} · 마지막 수정 ${fmtDateTime(s.updatedAt, localTz())} · 작성한 문항 ${filled(s)}개`));
  } else {
    saveCard.append(h('p', { class: 'muted' }, '이 컴퓨터에 저장된 작성 내용이 없습니다.'));
  }
  if (app.loadError) saveCard.append(h('p', { class: 'notice notice-warn' }, `저장된 내용을 읽지 못했습니다: ${app.loadError}`));
  for (const legacy of legacyList()) {
    saveCard.append(h('div', { class: 'notice notice-warn', id: `legacy-note-v${legacy.version}` },
      h('p', {}, h('b', {}, '이전 버전 앱의 작성 내용을 보관하고 있습니다. '), `${studentLine(legacy.student)}${legacy.updatedAt ? ` · 마지막 수정 ${fmtDateTime(legacy.updatedAt, localTz())}` : ''} · 답안 ${legacy.answers}개${legacy.evidences ? ` · 근거 ${legacy.evidences}개` : ''}`),
      h('p', { class: 'small' }, '앱의 탐구 구성과 문항이 바뀌어 이 내용은 새 화면에서 이어 쓸 수 없습니다. 원본은 지우지 않고 이 컴퓨터에 그대로 보관했습니다. 필요하면 백업 파일로 받아 두세요.'),
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', id: `btn-legacy-backup-v${legacy.version}`, onclick: () => app.downloadLegacy(legacy.key) }, '이전 작성 내용 백업 파일 받기')));
  }
  saveCard.append(h('p', { class: 'small' }, '다른 컴퓨터에서 이어서 쓰려면 백업 파일을 받아 가져가세요. 공용 컴퓨터라면 활동을 마친 뒤 내 작성 내용을 삭제하세요.'));
  const tools = h('div', { class: 'row-actions' });
  tools.append(
    h('button', { type: 'button', class: 'btn btn-secondary btn-sm', disabled: !s.started, onclick: () => app.downloadBackup() }, '작성 내용 백업 파일 받기'),
    h('button', { type: 'button', class: 'btn btn-danger-outline btn-sm', onclick: () => app.clearMyWork() }, '이 컴퓨터의 내 작성 내용 삭제'),
  );
  saveCard.append(tools);
  grid.append(saveCard);
  wrap.append(grid);

  // ── 탐구 흐름(원인을 암시하지 않는 중립적인 설명) ──
  const flow = h('section', { class: 'card flow-card', 'aria-labelledby': 'flow-h' });
  const steps = [
    [`탐구 1. ${INQUIRIES[0].title}`, '부산의 예측 조위에서 하루와 한 달 동안 반복되는 규칙을 찾습니다.'],
    [`탐구 2. ${INQUIRIES[1].title}`, '인천·부산·묵호의 예측 조위를 비교합니다.'],
    [`탐구 3. ${INQUIRIES[2].title}`, '부산의 서로 다른 두 기간의 관측 조위를 비교하고, 추가 자료로 원인을 확인합니다.'],
    ['종합·PDF', '해수면 높이에 영향을 주는 요인을 정리하고 PDF 보고서를 내려받아 선생님이 안내한 곳에 제출합니다.'],
  ];
  flow.innerHTML = `<h2 id="flow-h">탐구 순서</h2><ol class="flow">${steps.map(([a, b]) => `<li><b>${escapeHtml(a)}</b><span>${escapeHtml(b)}</span></li>`).join('')}</ol>`;
  wrap.append(flow);
  container.append(wrap);
  return null;
}

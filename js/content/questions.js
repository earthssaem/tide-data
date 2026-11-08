// 탐구 문항 정의 (수행평가: 탐구 1~3 + 종합, 문항 ①~⑩)
// 문항 id(q1~q6, q9~q12)는 저장 형식과 맞추려고 그대로 두고, 화면 번호(no)만 ①~⑩으로 매긴다(이전 탐구 3의 q7·q8은 삭제).
// - 문항 번호는 교사 채점표와 맞추기 위해 고정한다(교사가 끈 문항은 건너뛴다).
// - 탐구 1~3의 제목·안내·범례에는 원인(기상·태풍)이나 분석 정답을 미리 쓰지 않는다.
//   만조·간조·대조·소조·조석 형태라는 낱말은 학생이 답해야 할 '개념'으로만 쓰고, 앱이 어느 지점이 그것인지 표시하지 않는다.
// lockAfter: 해당 자료를 공개하면 답을 고정한다('moon' 달의 위상, 'weather' 추가 자료).
// afterReveal: 해당 자료를 공개한 뒤에만 작성한다.

export const PREDICTED_TEXT = '해당 지역의 조석 특성과 달·태양의 주기적인 영향을 바탕으로 계산한 해수면 높이입니다.';
export const OBSERVED_TEXT = '조위관측소에서 실제로 잰 해수면 높이입니다(1시간 간격).';
export const DATUM_CAUTION = '관측소마다 높이의 기준(0 cm)이 달라, 조위 숫자로 어느 지역 해수면이 더 높은지 비교할 수 없습니다. 오르내리는 폭과 반복 모양을 비교하세요.';
export const TIDE_TYPES = ['반일주조', '혼합조', '일주조', '판단 어려움'];
export const CIRCLED = ['', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

export const INQUIRIES = [
  {
    no: 1,
    step: 'inq1',
    title: '조석의 규칙',
    goal: '부산의 예측 조위에서 하루와 한 달 동안 반복되는 규칙을 찾는다.',
    intro: '부산의 예측 조위 그래프입니다. 그래프 위를 누르면 가장 가까운 자료점의 시각과 높이가 나타나고, 버튼으로 기록할 수 있습니다.',
    questions: [
      { id: 'q1', no: 1, kind: 'range', text: '서로 이웃한 만조와 간조를 하나씩 골라 조차를 구하세요.', tip: '그래프에서 점을 누른 뒤 [만조로 기록] 또는 [간조로 기록]을 누르세요. 조차는 직접 계산해 적습니다.' },
      { id: 'q2', no: 2, kind: 'count', text: '색칠된 24시간 동안 만조와 간조는 각각 몇 번 나타나나요? 만조에서 다음 만조까지는 약 몇 시간인가요?' },
      { id: 'q3', no: 3, kind: 'springNeap', text: '한 달 동안의 예측 조위 그래프에서 대조와 소조로 판단한 날짜를 하나씩 고르세요.', tip: '그래프에서 그날을 누른 뒤 [대조로 기록] 또는 [소조로 기록]을 누르세요.', lockAfter: 'moon' },
      { id: 'q4', no: 4, kind: 'drawings', text: '대조일 때와 소조일 때 달이 있을 수 있는 위치를 각각 모두 나타내고, 대조일 때 조차가 크고 소조일 때 조차가 작은 이유를 쓰세요.', lockAfter: 'moon' },
    ],
  },
  {
    no: 2,
    step: 'inq2',
    title: '지역별 차이',
    goal: '인천·부산·묵호의 예측 조위를 같은 기간에 놓고 조차와 조석 형태를 비교한다.',
    intro: '세 지역의 예측 조위를 같은 시간 축에 놓았습니다. [같은 축(평균 0)]은 지역마다 이 기간의 평균 높이를 0으로 맞춰 세 그래프를 똑같은 세로축에 그립니다. 오르내림의 크기(조차)를 같은 숫자로 비교할 수 있습니다.',
    questions: [
      { id: 'q5', no: 5, kind: 'order', text: '세 지역을 조차가 큰 순서대로 쓰세요.' },
      { id: 'q6', no: 6, kind: 'tideType', text: '각 지역의 조석 형태를 고르고, 판단한 근거를 한 줄로 쓰세요.' },
    ],
  },
  {
    no: 3,
    step: 'inq4', // 내부 이름은 그대로(저장된 진행 단계와 호환), 화면에는 탐구 3
    title: '특이한 변화',
    goal: '서로 다른 두 기간의 부산 관측 조위를 비교하고, 차이의 원인을 자료로 확인한다.',
    intro: '부산의 관측 조위를 두 기간으로 나누어 보여 줍니다. 두 그래프의 세로 눈금 간격은 같습니다. 그래프를 비교해 차이를 쓰고 원인을 추측한 뒤 [추가 자료 확인]을 누르세요.',
    questions: [
      { id: 'q9', no: 7, kind: 'text', text: '두 기간의 그래프는 어떻게 다른가요? 한 문장으로 쓰세요.', lockAfter: 'weather' },
      { id: 'q10', no: 8, kind: 'text', text: '그 차이가 생긴 원인을 추측해 한 문장으로 쓰세요.', lockAfter: 'weather' },
      { id: 'q11', no: 9, kind: 'text', text: '기상·태풍 자료에서 근거를 하나 이상 들어 원인을 설명하세요.', hint: '1~2문장', afterReveal: 'weather', compareWith: 'q10' },
    ],
  },
];

export const CONCLUSION = {
  no: 4,
  step: 'conclusion',
  title: '종합',
  goal: '탐구 1~3을 바탕으로 해수면 높이에 영향을 주는 요인을 정리한다.',
  questions: [
    { id: 'q12', no: 10, kind: 'text', text: '해수면 높이에 영향을 주는 요인을 정리하세요.', hint: '1~2문장' },
  ],
};

export const ALL_QUESTIONS = [...INQUIRIES.flatMap((d) => d.questions), ...CONCLUSION.questions];
export const ALL_QUESTION_IDS = ALL_QUESTIONS.map((q) => q.id);
export const questionById = (id) => ALL_QUESTIONS.find((q) => q.id === id) || null;
export const qLabel = (q) => `문항 ${CIRCLED[q.no]}`;

export const STEPS = [
  { id: 'start', label: '시작', short: '시작' },
  { id: 'inq1', label: '탐구 1 조석의 규칙', short: '탐구 1' },
  { id: 'inq2', label: '탐구 2 지역별 차이', short: '탐구 2' },
  { id: 'inq4', label: '탐구 3 특이한 변화', short: '탐구 3' },
  { id: 'conclusion', label: '종합', short: '종합' },
  { id: 'report', label: '보고서 확인·PDF', short: '보고서' },
];
export const STEP_IDS = STEPS.map((s) => s.id);

/** 자료 공개 단계 */
export const REVEALS = {
  moon: { label: '달의 위상 확인', step: 'inq1', lockIds: ['q3', 'q4'] },
  weather: { label: '추가 자료 확인', step: 'inq4', lockIds: ['q9', 'q10'] },
};

/** 교사가 켠 문항(설정이 없으면 모두 켬) */
export function isEnabled(q, setup) {
  const v = setup?.questions?.[q.id];
  return typeof v === 'boolean' ? v : true;
}
export const activeQuestions = (def, setup) => def.questions.filter((q) => isEnabled(q, setup));

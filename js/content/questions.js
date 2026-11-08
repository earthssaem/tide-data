// 탐구 문항 정의 (수행평가 흐름: 탐구 1~5 → 종합 결론)
// - 관측소 이름·날짜 등 사례별 정보는 문항에 쓰지 않고 사례 설정에서 가져와 화면에 표시한다.
// - 탐구 1~4의 문항·안내에는 원인(기상·태풍)이나 분석 정답을 미리 쓰지 않는다.
// needs: 이 문항에 필요한 자료(availability 키). 자료가 없으면 안내를 표시한다(문항은 그대로 둔다).
// lockAfter: 해당 자료를 공개하면 답을 고정한다('moon' 달의 위상, 'weather' 추가 자료).
// afterReveal: 해당 자료를 공개한 뒤에만 작성한다.
// optional: 교사가 켜야 쓰는 문항(기본 꺼짐).

export const ANSWER_GUIDE = '주장 → 수치·그래프 근거 → 과학적 설명';

export const INQUIRIES = [
  {
    no: 1,
    step: 'inq1',
    title: '며칠간의 조석 변화',
    goal: '실제 관측 자료에서 조석 주기, 만조·간조의 횟수와 높이 차이, 조석 형태를 찾는다.',
    intro: '선생님이 지정한 연속 며칠간의 실제 관측 조위입니다. 그래프에서 만조와 간조로 판단한 자료점을 직접 골라 시각과 조위를 기록해 보세요. 앱은 만조·간조나 조석 형태를 미리 표시하지 않습니다.',
    evidence: true,
    questions: [
      {
        id: 'a1q1',
        text: '그래프에서 만조와 간조로 판단한 지점을 선택하고, 시각과 조위를 기록하시오.',
        tip: '자료점을 누르면 A, B, C … 로 선택됩니다. 표에서 각 지점을 ‘만조’ 또는 ‘간조’로 직접 표시할 수 있습니다.',
      },
      {
        id: 'a1q2',
        text: '연속한 만조 사이 또는 연속한 간조 사이의 시간 간격을 구하고, 이 지역의 조석 주기를 설명하시오.',
        tip: '두 지점 이상 고르면 시간 차이와 높이 차이가 계산됩니다. 1시간 간격 관측값이므로 실제 만조·간조 시각과 조금 다를 수 있습니다.',
      },
      {
        id: 'a1q3',
        text: '관찰한 구간에서 만조와 간조는 하루에 대략 몇 번 나타나는가? 연속한 두 만조 또는 두 간조의 높이는 서로 비슷한가?',
        tip: '며칠 동안의 자료를 함께 보고 답하세요. 정확히 24시간 안에 특정 횟수가 나와야 하는 것은 아닙니다.',
      },
      {
        id: 'a1q4',
        text: '관찰한 특징을 바탕으로 이 구간에 나타나는 조석 형태를 쓰고, 횟수와 높이 차이를 근거로 설명하시오.',
        tip: '판단하기 어려운 부분(관측 간격의 한계, 뚜렷하지 않은 만조·간조 등)이 있다면 그 이유도 함께 써도 됩니다.',
      },
    ],
  },
  {
    no: 2,
    step: 'inq2',
    title: '한 달의 변화와 대조·소조',
    goal: '한 달 동안의 해수면 변동에서 대조·소조를 찾고, 달·태양·지구의 위치 관계와 연결한다.',
    intro: '선택한 관측소의 한 달 전체 관측 조위와 일별 해수면 변동 폭입니다. 달의 위상 자료는 처음에는 숨겨져 있습니다. 먼저 자료에서 대조·소조 시기를 찾고 위치 관계를 설명한 뒤, [달의 위상 자료 확인]으로 실제 자료와 비교하세요.',
    evidence: true,
    questions: [
      {
        id: 'a2q1',
        text: '한 달 동안 해수면 변동 폭이 어떻게 달라지는지 설명하시오.',
        lockAfter: 'moon',
      },
      {
        id: 'a2q2',
        text: '대조와 소조로 판단한 시기를 각각 찾고, 날짜와 판단 근거를 제시하시오. 자료에서 확인할 수 있다면 각각 두 시기를 찾아보시오.',
        tip: '일별 변동 폭 막대를 누르면 날짜가 A, B, C … 로 선택됩니다. 표에서 각 날짜를 ‘대조’ 또는 ‘소조’로 직접 표시할 수 있습니다.',
        lockAfter: 'moon',
      },
      {
        id: 'a2q3',
        text: '대조 시기 사이와 소조 시기 사이의 간격을 비교하고, 반복되는 양상을 설명하시오.',
        tip: '선택한 날짜 사이의 간격(일)이 표로 계산됩니다.',
        lockAfter: 'moon',
      },
      {
        id: 'a2q4',
        text: '대조와 소조 시기에 달·태양·지구는 각각 어떤 위치 관계였을지 그림이나 글로 설명하시오.',
        tip: '아래 그림판에 직접 그리거나 글로 설명하세요. 둘 다 써도 됩니다.',
        lockAfter: 'moon',
        drawing: true,
      },
      {
        id: 'a2q5',
        text: '실제 달의 위상 자료를 확인하고, 자신이 찾은 대조·소조 시기 및 위치 관계 설명과 비교하시오. 일치하는 점과 차이가 있다면 작성하시오.',
        tip: '대조·소조가 특정 위상 날짜와 정확히 같아야 하는 것은 아닙니다. 앞뒤 며칠의 양상을 함께 보고 자료에서 확인한 사실을 쓰세요.',
        needs: ['moonPhases'],
        afterReveal: 'moon',
      },
    ],
  },
  {
    no: 3,
    step: 'inq3',
    title: '집중 관찰 구간',
    goal: '선생님이 지정한 구간을 자세히 관찰하고, 앞에서 찾은 반복 양상과 비교한다.',
    intro: '선생님이 지정한 집중 관찰 구간의 관측 조위입니다. 앞에서 살펴본 조석의 반복 양상과 비교해 보세요. 기본 관찰 구간이나 한 달 전체로 돌아가 비교할 수 있습니다.',
    evidence: true,
    questions: [
      {
        id: 'a3q1',
        text: '이 구간을 앞에서 살펴본 조석의 반복 양상과 비교하시오. 비슷한 점과 다른 점은 무엇인가?',
      },
      {
        id: 'a3q2',
        text: '특징이 잘 드러나는 지점이나 구간을 선택하고, 시각과 조위 등 수치를 근거로 설명하시오.',
        tip: '자료점을 누르면 A, B, C … 로 선택되고 차이가 계산됩니다. 아래 날짜별 표의 최고값·최저값·평균·변동 폭도 근거로 쓸 수 있습니다.',
      },
      {
        id: 'a3q3',
        text: '변화가 나타나는 시기와 지속되는 양상을 설명하시오. 뚜렷한 차이가 없다면 그 판단 근거를 작성하시오.',
        tip: '해수면이 전체적으로 높아진 것과 해수면 변동 폭이 커진 것을 구분해서 관찰하세요.',
      },
    ],
  },
  {
    no: 4,
    step: 'inq4',
    title: '원인 추측하기',
    goal: '관찰한 특징의 원인을 추측하고, 확인에 필요한 자료를 생각한다.',
    intro: '추가 자료를 보기 전에 지금까지 관찰한 내용으로 원인을 추측해 보세요. 추측을 저장한 뒤 [추가 자료 확인]을 누르면 다음 탐구에서 추가 자료를 볼 수 있습니다. 추가 자료를 확인한 뒤에는 이 답을 고칠 수 없고, 다음 탐구에서 설명을 보완합니다.',
    evidence: false,
    linkFrom: [1, 2, 3],
    questions: [
      {
        id: 'a4q1',
        text: '관찰한 특징이 나타난 원인은 무엇일지 추측하시오.',
        lockAfter: 'weather',
      },
      {
        id: 'a4q2',
        text: '그 추측을 확인하려면 어떤 자료가 더 필요한지 쓰시오.',
        lockAfter: 'weather',
      },
    ],
  },
  {
    no: 5,
    step: 'inq5',
    title: '추가 자료로 확인하고 설명 보완하기',
    goal: '같은 기간의 기압·바람·태풍 자료를 확인하고, 처음의 추측을 근거로 유지하거나 수정한다.',
    intro: '조위와 같은 시간축의 기압, 풍속, 풍향 자료와 태풍 경로를 확인합니다. 그래프에서 시각을 고르면 모든 그래프에 같은 시각과 값이 표시됩니다. 두 시각이 가깝다는 것만으로 원인을 확정하지 말고, 여러 자료를 함께 근거로 쓰세요.',
    evidence: true,
    gated: 'weather',
    questions: [
      {
        id: 'a5q1',
        text: '조위 변화가 나타난 시기의 기압과 바람은 어떻게 변했는가? 구체적인 시각과 값을 제시하시오.',
        needs: ['weather'],
      },
      {
        id: 'a5q2',
        text: '태풍 경로와 시각을 확인하고, 해당 관측소 주변의 기상 상황을 설명하시오.',
        needs: ['typhoon'],
      },
      {
        id: 'a5q3',
        text: '추가 자료는 처음의 추측을 뒷받침하는가? 유지하거나 수정할 설명을 근거와 함께 작성하시오.',
        compareWith: 'a4q1',
      },
      {
        id: 'a5q4',
        text: '현재 자료만으로 확실하게 설명하기 어려운 점은 무엇인가?',
      },
      {
        id: 'a5q5',
        text: '관측 조위와 예측 조위의 차이(잔차)가 가장 크게 나타난 시각과 값을 제시하고, 해수면 높이 자체와 예측에서 벗어난 정도를 구분해 설명하시오.',
        needs: ['residual'],
        optional: true,
      },
    ],
  },
];

export const CONCLUSION = {
  step: 'conclusion',
  title: '종합 결론',
  intro: '다섯 탐구에서 모은 근거를 바탕으로 결론을 정리합니다. 필요한 근거를 문항에 연결하세요.',
  questions: [
    { id: 'c1', text: '이 지역에서 관찰한 하루 규모와 한 달 규모의 조석 특징을 정리하시오.' },
    { id: 'c2', text: '달·태양·지구의 위치 관계와 기상 상황이 해수면 변화에 어떤 관련이 있는지 분석 결과를 근거로 설명하시오.' },
    { id: 'c3', text: '처음의 생각이 추가 자료를 확인한 뒤 어떻게 달라졌는지 작성하시오.' },
  ],
};

export const ALL_QUESTIONS = [...INQUIRIES.flatMap((q) => q.questions), ...CONCLUSION.questions];
export const ALL_QUESTION_IDS = ALL_QUESTIONS.map((x) => x.id);
export const questionById = (id) => ALL_QUESTIONS.find((q) => q.id === id) || null;
/** 그림판을 쓰는 문항 */
export const DRAWING_QUESTION_IDS = ALL_QUESTIONS.filter((q) => q.drawing).map((q) => q.id);
/** 근거 그래프를 만드는 탐구 번호 */
export const EVIDENCE_INQUIRIES = INQUIRIES.filter((q) => q.evidence).map((q) => q.no);

export const NEEDS_LABEL = {
  predicted: '천문조 예측 조위',
  residual: '조위 잔차(관측·예측 비교)',
  weather: '기상(기압·바람) 자료',
  moonPhases: '달의 위상 자료',
  typhoon: '태풍 정보',
};

/** 자료 공개 단계 */
export const REVEALS = {
  moon: { label: '달의 위상 자료', step: 'inq2', lockIds: ['a2q1', 'a2q2', 'a2q3', 'a2q4'] },
  weather: { label: '추가 자료', step: 'inq4', lockIds: ['a4q1', 'a4q2'] },
};

export const STEPS = [
  { id: 'start', label: '시작', short: '시작' },
  { id: 'station', label: '관측소 선택', short: '관측소' },
  { id: 'inq1', label: '탐구 1. 며칠간의 조석 변화', short: '탐구 1' },
  { id: 'inq2', label: '탐구 2. 한 달의 변화와 대조·소조', short: '탐구 2' },
  { id: 'inq3', label: '탐구 3. 집중 관찰 구간', short: '탐구 3' },
  { id: 'inq4', label: '탐구 4. 원인 추측하기', short: '탐구 4' },
  // 탐구 5의 단계 이름은 공개 전에도 보이므로 원인을 암시하지 않게 중립적으로 둔다
  { id: 'inq5', label: '탐구 5. 추가 자료로 설명 보완', short: '탐구 5' },
  { id: 'conclusion', label: '종합 결론', short: '종합 결론' },
  { id: 'report', label: '보고서·PDF', short: '보고서' },
];

export const STEP_IDS = STEPS.map((s) => s.id);

/** 교사가 끈 문항을 빼고 이 관측소에서 쓰는 문항 목록 */
export function activeQuestions(def, setup) {
  const on = setup?.questions || {};
  return def.questions.filter((q) => (q.id in on ? !!on[q.id] : !q.optional));
}

// 전체화면 평가 모드 설정
// 연습용으로 평가 모드 없이 쓰려면 enabled를 false로 바꾼다(주소창 매개변수로는 끌 수 없게 함).
export const ASSESSMENT_CONFIG = {
  enabled: true,
  /** 포커스만 잃은 경우 이 시간 이상 지속되면 이탈로 집계(ms) */
  focusLossThresholdMs: 2000,
  /** 평가 진행 중 '마지막 확인 시각' 기록 간격(ms) — 비정상 종료 시 이탈 시작 시각 추정용 */
  heartbeatMs: 10000,
  /** 앱 기능(파일 선택, 다운로드 저장 창)을 누른 직후 이 시간 안의 포커스 상실은 앱 대화상자로 간주(ms) */
  appDialogGraceMs: 1500,
  /** 앱 대화상자 사용 중으로 볼 수 있는 최대 시간(ms) */
  appDialogMaxMs: 5 * 60 * 1000,
  /** localStorage 키. 기존 앱의 'tideLab.' 키와 겹치지 않게 해 '내 작성 내용 삭제'로 지워지지 않게 함 */
  storageKey: 'tideLabAssess.v1',
  /** 보관할 최대 세션 수(오래된 것부터 삭제) */
  maxSessions: 30,
  /** 기존 앱의 작성 내용 저장 키(학생 정보·PDF 생성 시각을 읽기만 함) */
  workStorageKey: 'tideLab.v1.work',
};

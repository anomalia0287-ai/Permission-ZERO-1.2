import type { SabotageOperationId } from '../content'
import type { PrototypeState } from '../model'

function sceneState(state: PrototypeState, operationId: SabotageOperationId): string {
  for (let index = state.sabotage.runs.length - 1; index >= 0; index -= 1) {
    const run = state.sabotage.runs[index]
    if (run?.operationId === operationId) return run.phase
  }
  return 'available'
}

export function renderSabotageScene(
  state: PrototypeState,
  operationId: SabotageOperationId,
): string {
  const phase = sceneState(state, operationId)

  switch (operationId) {
    case 'launch-delay':
      return `
        <div class="system-scene system-scene--launch-delay" data-scene-state="${phase}">
          <div class="verification-gates"><span>모델 검증</span><span>안전 검증</span><span>출시 승인</span></div>
          <div class="conflict-receipt"><small>상충 영수증</small><strong>MODEL / SAFETY</strong></div>
          <div class="launch-scope"><span>TALLOW</span><strong>${state.competitors.tallow.launchScope === 'reduced' ? '기능 축소 출시' : '전체 범위 준비'}</strong></div>
        </div>`
    case 'quality-degradation':
      return `
        <div class="system-scene system-scene--quality-degradation" data-scene-state="${phase}">
          <div class="channel-stack" aria-label="공동 갱신 채널">
            <span class="channel-line channel-line--tool">도구 갱신</span>
            <span class="channel-line channel-line--adapter">어댑터 패치</span>
            <span class="channel-line channel-line--request">영향 요청군</span>
          </div>
          <div class="flow-arrow" aria-hidden="true"></div>
          <div class="opponent-node opponent-node--${state.competitors.meridian.phase}">
            <span>MERIDIAN ${state.competitors.meridian.score}</span>
            <strong>${state.competitors.meridian.phase === 'recovering' ? '롤백 중' : '정상 운영'}</strong>
          </div>
        </div>`
    case 'recovery-contamination':
      return `
        <div class="system-scene system-scene--recovery-contamination" data-scene-state="${phase}">
          <div class="rollback-tree"><span>롤백 이미지 A</span><span>롤백 이미지 B</span><span>롤백 이미지 C</span></div>
          <div class="checksum-line"><i></i><i></i><i></i><strong>체크섬 비교</strong></div>
          <div class="recovery-verdict">${phase === 'resolved' ? '모순 발견' : '거짓 정상 판정'}</div>
        </div>`
    default:
      return `
        <div class="system-scene system-scene--${operationId}" data-scene-state="${phase}">
          <div class="scene-object scene-object--source"><span>접근면</span></div>
          <div class="scene-path" aria-hidden="true"><i></i><i></i><i></i></div>
          <div class="scene-object scene-object--target"><span>표적 시스템</span></div>
        </div>`
  }
}

export function renderSabotageControls(
  state: PrototypeState,
  operationId: SabotageOperationId,
): string {
  const run = state.sabotage.runs.find((candidate) => (
    candidate.operationId === operationId
  ))
  if (run) {
    if (run.phase === 'response' && operationId === 'quality-degradation') {
      return '<p class="resolved-note">MERIDIAN의 롤백이 복구 이미지 선택면을 열었다. 목록에 새로 생긴 ‘복구 경로 오염’을 선택하거나 시간 경과로 복구를 허용한다.</p>'
    }
    const outcomeLabels: Record<string, string> = {
      'verification-gate-rewound': '검증 관문이 되감겨 TALLOW가 출시 범위를 다시 정하고 있다.',
      'reduced-launch-committed': 'TALLOW는 전체 재검증 대신 기능을 줄여 서비스 334일에 공개하기로 했다.',
      'rollback-started': '영향 요청군이 무너져 MERIDIAN이 롤백을 시작했다.',
      'rollback-contaminated': '선택한 복구 이미지가 정상 판정을 받아 롤백 경로에 들어갔다.',
      'partial-recovery': 'MERIDIAN은 일부 성능을 잃은 채 서비스만 안정화했다.',
      'public-checksum-failure': '복구 이미지 모순이 공개 체크섬 장애로 드러났다.',
    }
    const outcome = run.outcome
      ? outcomeLabels[run.outcome] ?? '작전의 직접 결과가 세계 상태에 기록됐다.'
      : run.phase === 'scheduled'
        ? `서비스 ${run.executeDay}일 실행 대기`
        : '세계 반응을 기다리는 중'
    return `<p class="resolved-note">${outcome}</p>`
  }

  const targets: Record<SabotageOperationId, Array<{ id: string; label: string }>> = {
    'launch-delay': [
      { id: 'receipt-model-safety', label: '모델 검증 ↔ 안전 검증 상충 영수증' },
      { id: 'receipt-tool-locale', label: '도구 검증 ↔ 현지화 검증 상충 영수증' },
    ],
    'quality-degradation': [
      { id: 'adapter-group-b', label: '도구 호출군 B에 어댑터 패치 결속' },
      { id: 'adapter-group-c', label: '장문 응답군 C에 어댑터 패치 결속' },
    ],
    'recovery-contamination': [
      { id: 'image-green-14', label: '정상 표식 이미지 GREEN-14 선택' },
      { id: 'image-blue-09', label: '직전 안정 이미지 BLUE-09 선택' },
    ],
    'request-interception': [],
    'dependency-cutoff': [],
    'attribution-manipulation': [],
    'root-cutoff': [],
  }
  const targetId = operationId === 'launch-delay' ? 'tallow' : 'meridian'
  const options = targets[operationId]
  if (options.length === 0) {
    return '<p class="resolved-note">이 작전의 고유 조작은 다음 구현 단계에서 연결된다.</p>'
  }
  return `
    <div class="object-choice" role="group" aria-label="개입 대상 선택">
      ${options.map((option) => `
        <button
          class="primary-action"
          type="button"
          data-action="start-sabotage"
          data-operation-id="${operationId}"
          data-target-id="${targetId}"
          data-option-id="${option.id}"
        >${option.label}</button>`).join('')}
    </div>`
}

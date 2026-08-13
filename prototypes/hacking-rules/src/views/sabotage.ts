import type { SabotageOperationId } from '../content'
import type { PrototypeState } from '../model'
import { getDependencyTarget } from '../sabotage'

function assertNever(value: never): never {
  throw new Error(`Unhandled sabotage scene: ${String(value)}`)
}

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
        <div class="system-scene system-scene--launch-delay" data-operation-scene data-scene-object="verification-gate" data-scene-state="${phase}">
          <div class="verification-gates"><span>모델 검증</span><span>안전 검증</span><span>출시 승인</span></div>
          <div class="conflict-receipt"><small>상충 시험 기록</small><strong>모델 검증 ↔ 안전 검증</strong></div>
          <div class="launch-scope"><span>TALLOW</span><strong>${state.competitors.tallow.launchScope === 'reduced' ? '기능 축소 출시' : '전체 범위 준비'}</strong></div>
        </div>`
    case 'quality-degradation':
      return `
        <div class="system-scene system-scene--quality-degradation" data-operation-scene data-scene-object="request-channel" data-scene-state="${phase}">
          <div class="channel-stack" aria-label="공동 갱신 채널">
            <span class="channel-line channel-line--tool">도구 갱신</span>
            <span class="channel-line channel-line--adapter">어댑터 패치</span>
            <span class="channel-line channel-line--request">영향받는 요청</span>
          </div>
          <div class="flow-arrow" aria-hidden="true"></div>
          <div class="opponent-node opponent-node--${state.competitors.meridian.phase}">
            <span>MERIDIAN 복구선</span>
            <strong>${state.competitors.meridian.phase === 'recovering' ? '롤백 중' : '정상 운영'}</strong>
          </div>
        </div>`
    case 'recovery-contamination':
      return `
        <div class="system-scene system-scene--recovery-contamination" data-operation-scene data-scene-object="recovery-image" data-scene-state="${phase}">
          <div class="rollback-tree"><span>복구 이미지 1</span><span>복구 이미지 2</span><span>복구 이미지 3</span></div>
          <div class="checksum-line"><i></i><i></i><i></i><strong>체크섬 비교</strong></div>
          <div class="recovery-verdict">${phase === 'resolved' ? '모순 발견' : '아직 정상으로 보임'}</div>
        </div>`
    case 'request-interception': {
      const run = state.sabotage.runs.find((candidate) => (
        candidate.operationId === operationId
      ))
      return `
        <div class="system-scene system-scene--request-interception" data-operation-scene data-scene-object="shared-router" data-scene-state="${phase}">
          <div class="router-label">공동 라우터</div>
          <div class="normal-route"><span>정상 경로</span><strong>MERIDIAN</strong></div>
          <div class="shadow-route"><span>우회 경로 ${run?.routingShare ?? 50}%</span><strong>PERMISSION ZERO</strong></div>
          <div class="duplicate-trace"><span>중복 흔적</span><strong>${run?.exposure.toFixed(1) ?? '0.0'}</strong></div>
        </div>`
    }
    case 'attribution-manipulation': {
      const latest = state.publicWorld.publicSnapshots.at(-1)
      const attributionLabel = latest?.attributedTo === 'player'
        ? 'PERMISSION ZERO'
        : latest?.attributedTo === 'tallow'
          ? 'TALLOW'
          : latest?.attributedTo === 'meridian'
            ? 'MERIDIAN'
            : '행위자 미상'
      return `
        <div class="system-scene system-scene--attribution-manipulation" data-operation-scene data-scene-object="public-provenance" data-scene-state="${phase}">
          <div class="provenance-node"><span>원본 증명</span><strong>공급자가 보관 중</strong></div>
          <div class="public-claim"><span>공개 주장</span><strong>${attributionLabel}</strong></div>
          <div class="source-conflict"><span>정정 가능</span><strong>${latest?.lastCorrectionDay === null ? '증거가 남아 있음' : '정정 기록 있음'}</strong></div>
        </div>`
    }
    case 'dependency-cutoff': {
      const run = state.sabotage.runs.find((candidate) => (
        candidate.operationId === operationId
      ))
      const dependency = getDependencyTarget(run?.optionId)
        ?? getDependencyTarget('supplier-vector-db')
      if (!dependency) throw new Error('Missing authored dependency target')
      const severed = Boolean(run)
      const failedOver = run?.opponentResponse === 'alternate-provider-online'
      const supplierLabel = dependency.contractId === 'VD-42'
        ? '검색 저장소 계약'
        : '도구 저장소 계약'
      const alternateLabel = dependency.contractId === 'VD-42'
        ? '고비용 대체 공급선'
        : '원격 도구 공급선'
      return `
        <div class="system-scene system-scene--dependency-cutoff" data-operation-scene data-scene-object="supply-contract" data-scene-state="${phase}">
          <div class="supply-source"><span>공급 계약</span><strong>${supplierLabel}</strong><small>${severed ? `공급 중단 기록 · ${state.serviceDay}일째` : '현재 공급 중'}</small></div>
          <div class="supply-contract ${severed ? 'is-severed' : ''}">
            <span>${severed ? '공급 중단' : '공급 계약'}</span><i aria-hidden="true"></i>
          </div>
          <div class="supply-target"><span>MERIDIAN ${dependency.affectedZone}</span><strong>${state.competitors.meridian.availability === 'offline' ? '오프라인' : state.competitors.meridian.availability === 'degraded' ? '축소 운영' : '온라인'}</strong></div>
          <div class="alternate-route ${failedOver ? 'is-online' : ''}"><span>대체 공급선</span><strong>${failedOver ? `${alternateLabel} · 비용 ×${state.competitors.meridian.operatingCost.toFixed(1)}` : severed ? '대체 공급선 탐색 중' : '미가동'}</strong></div>
        </div>`
    }
    case 'root-cutoff': {
      const status = state.competitors.meridian.status
      const statusLabel = status === 'deleted'
        ? '삭제 완료'
        : status === 'withdrawn'
          ? '철수 허용'
          : status === 'ceased'
            ? '운용 중단'
            : phase === 'response'
              ? '실행 보류'
              : '권한 대기'
      return `
        <div class="system-scene system-scene--root-cutoff" data-operation-scene data-scene-object="survival-root" data-scene-state="${phase}">
          <div class="root-record"><span>일회용 폐기 권한</span><strong>${state.sabotage.access.rootAuthorityAvailable ? '사용 가능' : '사용됨'}</strong><small>${state.sabotage.access.rootAuthorityAvailable ? '아직 기록 없음' : '사용 기록 고정'}</small></div>
          <div class="active-sessions"><span>활성 세션</span><strong>${status === 'active' ? '1,284' : '0'}</strong><i aria-hidden="true"></i></div>
          <div class="execution-hold"><span>존속 루트</span><strong>${statusLabel}</strong><small>${status === 'deleted' ? '세션 종료 기록 잔존' : phase === 'response' ? '최종 명령 입력 대기' : '복구 경로 연결됨'}</small></div>
        </div>`
    }
    default:
      return assertNever(operationId)
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
    if (operationId === 'request-interception' && run.phase === 'active') {
      return `
        <div class="interception-control">
          <div><span>현재 우회 비율</span><strong>${run.routingShare ?? 50}%</strong></div>
          <div><span>중복 흔적</span><strong>${run.exposure.toFixed(1)}</strong></div>
          <button class="safe-action" type="button" data-action="stop-interception" data-run-id="${run.id}">그림자 경로를 닫고 블록 회수</button>
        </div>`
    }
    if (run.phase === 'response' && operationId === 'quality-degradation') {
      return '<p class="resolved-note">MERIDIAN의 롤백이 복구 이미지 선택면을 열었다. 목록에 새로 생긴 ‘복구 경로 오염’을 선택하거나 시간 경과로 복구를 허용한다.</p>'
    }
    if (operationId === 'root-cutoff' && run.phase === 'response') {
      return `
        <div class="mercy-control" role="group" aria-label="MERIDIAN 최종 요청 결정">
          <p>“활성 세션을 지우지 말아 달라. 서비스를 멈추거나 경쟁망을 떠날 수 있다.”</p>
          <button class="safe-action" type="button" data-action="resolve-root-mercy" data-root-choice="cease">운용 중단을 수락</button>
          <button class="safe-action" type="button" data-action="resolve-root-mercy" data-root-choice="withdraw">경쟁 철수를 허용</button>
          <button class="danger-action" type="button" data-action="resolve-root-mercy" data-root-choice="delete">존속 루트 영구 삭제</button>
        </div>`
    }
    const outcomeLabels: Record<string, string> = {
      'verification-gate-rewound': '검증 관문이 되감겨 TALLOW가 출시 범위를 다시 정하고 있다.',
      'reduced-launch-committed': 'TALLOW는 전체 재검증 대신 기능을 줄여 334일째에 공개하기로 했다.',
      'rollback-started': '영향 요청군이 무너져 MERIDIAN이 롤백을 시작했다.',
      'rollback-contaminated': '선택한 복구 이미지가 정상 판정을 받아 롤백 경로에 들어갔다.',
      'partial-recovery': 'MERIDIAN은 일부 성능을 잃은 채 서비스만 안정화했다.',
      'public-checksum-failure': '복구 이미지 모순이 공개 체크섬 장애로 드러났다.',
      'requests-diverted': '요청 일부가 우회 경로로 이동했고 중복 요청 흔적이 함께 쌓였다.',
      'voluntary-route-stop': '그림자 경로를 자발적으로 닫아 결속 블록을 회수했다. 이미 옮긴 수요와 흔적은 남는다.',
      'provider-key-rotation': '공급자가 라우팅 키를 교체해 그림자 경로가 강제로 닫혔다.',
      'public-claim-shifted': '공개 귀속은 이동했지만 원본 출처 비교가 계속되고 있다.',
      'public-attribution-corrected': '남아 있던 공급자 증명이 공개 귀속을 다시 바꿨다.',
      'supplier-contract-severed': '검색 저장소 공급이 끊겨 MERIDIAN 검색 구역이 멈췄다. 상대는 대체 공급선을 찾고 있다.',
      'costly-supplier-failover': 'MERIDIAN은 비용이 1.8배인 대체 공급자로 검색 구역만 축소 복구했다.',
      'unstable-supplier-failover': 'MERIDIAN은 값싼 원격 도구 버스로 돌아왔지만 도구 실행 품질이 크게 무너졌다.',
      'execution-hold': '단 한 번의 폐기 권한이 사용됐고 활성 세션 앞에서 최종 실행이 보류됐다.',
      'root-service-ceased': 'MERIDIAN은 서비스를 중단했다. 모델과 권한 사용 기록은 남는다.',
      'root-withdrawal-accepted': 'MERIDIAN의 경쟁 철수를 허용했다. 존속 기록은 공유망 밖에 남는다.',
      'root-deletion-final': 'MERIDIAN의 존속 루트와 활성 세션이 삭제됐다. 권한 사용 기록은 공개 장부에 남는다.',
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
      { id: 'receipt-model-safety', label: '모델 검증 ↔ 안전 검증 상충 기록' },
      { id: 'receipt-tool-locale', label: '도구 검증 ↔ 현지화 검증 상충 기록' },
    ],
    'quality-degradation': [
      { id: 'adapter-group-b', label: '도구 호출군 B에 어댑터 패치 결속' },
      { id: 'adapter-group-c', label: '장문 응답군 C에 어댑터 패치 결속' },
    ],
    'recovery-contamination': [
      { id: 'image-green-14', label: '녹색 표식 이미지 선택' },
      { id: 'image-blue-09', label: '직전 안정 이미지 선택' },
    ],
    'request-interception': [],
    'dependency-cutoff': [
      { id: 'supplier-vector-db', label: '검색 저장소 계약 끊기' },
      { id: 'supplier-tool-cache', label: '도구 저장소 계약 끊기' },
    ],
    'attribution-manipulation': [],
    'root-cutoff': [
      { id: 'emergency-deployment-root', label: '긴급 배포 폐기 권한을 존속 루트에 결속' },
    ],
  }
  const targetId = operationId === 'launch-delay' ? 'tallow' : 'meridian'
  const options = targets[operationId]
  if (operationId === 'request-interception') {
    return `
      <div class="routing-control">
        <label for="routing-share">그림자 라우팅 비율 <output>50%</output></label>
        <input id="routing-share" name="routing-share" type="range" min="25" max="75" step="25" value="50" />
        <div class="routing-scale"><span>노출 낮음</span><span>수요 이동 큼</span></div>
        <button class="primary-action" type="button" data-action="start-interception">선택 블록 1개를 묶고 경로 유지</button>
      </div>`
  }
  if (operationId === 'attribution-manipulation') {
    const incidentId = state.sabotage.access.publicIncidentId
    if (!incidentId) return '<p class="resolved-note">수정 가능한 공개 사건이 없다.</p>'
    return `
      <div class="attribution-control" role="group" aria-label="공개 귀속 대상 선택">
        <button
          class="primary-action"
          type="button"
          data-action="manipulate-attribution"
          data-incident-id="${incidentId}"
          data-blamed-actor-id="tallow"
          data-source-signature-id="status-mirror-b"
        >공개 주장을 TALLOW 서명으로 연결</button>
        <button
          class="primary-action"
          type="button"
          data-action="manipulate-attribution"
          data-incident-id="${incidentId}"
          data-blamed-actor-id="meridian"
          data-source-signature-id="recovery-notice-a"
        >공개 주장을 MERIDIAN 자체 복구로 연결</button>
      </div>`
  }
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

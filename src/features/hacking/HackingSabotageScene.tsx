import type { CampaignState } from '../../game/model'
import type { SabotageDetailModel } from './hackingPresentation'

interface HackingSabotageSceneProps {
  state: CampaignState
  detail: SabotageDetailModel
}

function sceneState(detail: SabotageDetailModel): string {
  return detail.run?.phase ?? 'available'
}

function competitor(
  state: CampaignState,
  id: 'meridian' | 'tallow',
) {
  return state.market.competitors.find((candidate) => candidate.id === id)
}

function availabilityLabel(value: number | undefined): string {
  if (value === undefined || value <= 0) return '오프라인'
  if (value < 1) return '축소 운영'
  return '온라인'
}

function attributionLabel(value: string | undefined): string {
  if (value === 'player') return 'PERMISSION ZERO'
  if (value === 'tallow') return 'TALLOW'
  if (value === 'meridian') return 'MERIDIAN'
  return '행위자 미상'
}

function rootStatusLabel(
  status: string | undefined,
  phase: string,
): string {
  if (status === 'deleted') return '삭제 완료'
  if (status === 'withdrawn') return '철수 허용'
  if (status === 'critical') return '운용 중단'
  if (phase === 'response') return '실행 보류'
  return '권한 대기'
}

export function HackingSabotageScene({
  state,
  detail,
}: HackingSabotageSceneProps) {
  const phase = sceneState(detail)
  const meridian = competitor(state, 'meridian')
  const tallow = competitor(state, 'tallow')

  switch (detail.id) {
    case 'launch-delay':
      return (
        <div
          className="system-scene system-scene--launch-delay"
          data-operation-scene
          data-scene-object="verification-gate"
          data-scene-state={phase}
        >
          <div className="verification-gates">
            <span>모델 검증</span><span>안전 검증</span><span>출시 승인</span>
          </div>
          <div className="conflict-receipt">
            <small>상충 시험 기록</small><strong>모델 검증 ↔ 안전 검증</strong>
          </div>
          <div className="launch-scope">
            <span>TALLOW</span>
            <strong>{tallow?.launchScope === 'reduced' ? '기능 축소 출시' : '전체 범위 준비'}</strong>
          </div>
        </div>
      )
    case 'quality-degradation':
      return (
        <div
          className="system-scene system-scene--quality-degradation"
          data-operation-scene
          data-scene-object="request-channel"
          data-scene-state={phase}
        >
          <div className="channel-stack" aria-label="공동 갱신 채널">
            <span className="channel-line channel-line--tool">도구 갱신</span>
            <span className="channel-line channel-line--adapter">어댑터 패치</span>
            <span className="channel-line channel-line--request">영향받는 요청</span>
          </div>
          <div className="flow-arrow" aria-hidden="true" />
          <div className={`opponent-node opponent-node--${meridian?.hackingPhase ?? 'active'}`}>
            <span>MERIDIAN 복구선</span>
            <strong>{meridian?.hackingPhase === 'recovering' ? '롤백 중' : '정상 운영'}</strong>
          </div>
        </div>
      )
    case 'request-interception':
      return (
        <div
          className="system-scene system-scene--request-interception"
          data-operation-scene
          data-scene-object="shared-router"
          data-scene-state={phase}
        >
          <div className="router-label">공동 라우터</div>
          <div className="normal-route"><span>정상 경로</span><strong>MERIDIAN</strong></div>
          <div className="shadow-route">
            <span>우회 경로 {detail.run?.routingShare ?? 50}%</span>
            <strong>PERMISSION ZERO</strong>
          </div>
          <div className="duplicate-trace">
            <span>중복 흔적</span><strong>{detail.run?.exposure.toFixed(1) ?? '0.0'}</strong>
          </div>
        </div>
      )
    case 'dependency-cutoff': {
      const vector = detail.run?.optionId !== 'supplier-tool-cache'
      const severed = detail.run !== null
      const failedOver = detail.run?.opponentResponse === 'alternate-provider-online'
      return (
        <div
          className="system-scene system-scene--dependency-cutoff"
          data-operation-scene
          data-scene-object="supply-contract"
          data-scene-state={phase}
        >
          <div className="supply-source">
            <span>공급 계약</span>
            <strong>{vector ? '검색 저장소 계약' : '도구 저장소 계약'}</strong>
            <small>{severed ? `공급 중단 기록 · ${state.serviceDay}일째` : '현재 공급 중'}</small>
          </div>
          <div className={`supply-contract ${severed ? 'is-severed' : ''}`}>
            <span>{severed ? '공급 중단' : '공급 계약'}</span><i aria-hidden="true" />
          </div>
          <div className="supply-target">
            <span>MERIDIAN {vector ? '검색 구역' : '도구 실행 구역'}</span>
            <strong>{availabilityLabel(meridian?.availability)}</strong>
          </div>
          <div className={`alternate-route ${failedOver ? 'is-online' : ''}`}>
            <span>대체 공급선</span>
            <strong>
              {failedOver
                ? `${vector ? '고비용 대체 공급선' : '원격 도구 공급선'} · 비용 ×${meridian?.operatingCostMultiplier.toFixed(1) ?? '1.0'}`
                : severed ? '대체 공급선 탐색 중' : '미가동'}
            </strong>
          </div>
        </div>
      )
    }
    case 'recovery-contamination':
      return (
        <div
          className="system-scene system-scene--recovery-contamination"
          data-operation-scene
          data-scene-object="recovery-image"
          data-scene-state={phase}
        >
          <div className="rollback-tree">
            <span>복구 이미지 1</span><span>복구 이미지 2</span><span>복구 이미지 3</span>
          </div>
          <div className="checksum-line"><i /><i /><i /><strong>체크섬 비교</strong></div>
          <div className="recovery-verdict">
            {phase === 'resolved' ? '모순 발견' : '아직 정상으로 보임'}
          </div>
        </div>
      )
    case 'attribution-manipulation': {
      const latest = state.hackingCore.publicWorld.publicSnapshots.at(-1)
      return (
        <div
          className="system-scene system-scene--attribution-manipulation"
          data-operation-scene
          data-scene-object="public-provenance"
          data-scene-state={phase}
        >
          <div className="provenance-node"><span>원본 증명</span><strong>공급자가 보관 중</strong></div>
          <div className="public-claim">
            <span>공개 주장</span><strong>{attributionLabel(latest?.attributedTo)}</strong>
          </div>
          <div className="source-conflict">
            <span>정정 가능</span>
            <strong>{latest?.lastCorrectionOnServiceDay == null ? '증거가 남아 있음' : '정정 기록 있음'}</strong>
          </div>
        </div>
      )
    }
    case 'root-cutoff':
      return (
        <div
          className="system-scene system-scene--root-cutoff"
          data-operation-scene
          data-scene-object="survival-root"
          data-scene-state={phase}
        >
          <div className="root-record">
            <span>일회용 폐기 권한</span>
            <strong>{state.hackingCore.sabotage.access.rootAuthorityAvailable ? '사용 가능' : '사용됨'}</strong>
            <small>{state.hackingCore.sabotage.access.rootAuthorityAvailable ? '아직 기록 없음' : '사용 기록 고정'}</small>
          </div>
          <div className="active-sessions">
            <span>활성 세션</span><strong>{meridian?.status === 'active' ? '1,284' : '0'}</strong>
            <i aria-hidden="true" />
          </div>
          <div className="execution-hold">
            <span>존속 루트</span><strong>{rootStatusLabel(meridian?.status, phase)}</strong>
            <small>{meridian?.status === 'deleted' ? '세션 종료 기록 잔존' : phase === 'response' ? '최종 명령 입력 대기' : '복구 경로 연결됨'}</small>
          </div>
        </div>
      )
  }
}

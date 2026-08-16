import type { CampaignState } from '../../game/model'
import type { IntelligenceDetailModel } from './hackingPresentation'

interface HackingIntelligenceSceneProps {
  state: CampaignState
  detail: IntelligenceDetailModel
}

function attributionLabel(value: string | undefined): string {
  if (value === 'player') return 'PERMISSION ZERO'
  if (value === 'meridian') return 'MERIDIAN'
  if (value === 'tallow') return 'TALLOW'
  return '미상'
}

export function HackingIntelligenceScene({
  state,
  detail,
}: HackingIntelligenceSceneProps) {
  const phase = detail.answer ? 'answered' : 'open'

  switch (detail.lens) {
    case 'organizational-legibility':
      return (
        <div
          className="intelligence-scene intelligence-scene--organizational"
          data-evidence-scene="organizational-legibility"
          data-evidence-state={phase}
        >
          <div className="decision-sheet">
            <span>결재선</span><i /><i className="is-redacted" /><i />
            <small>가림 처리된 회수 명령</small>
          </div>
          <div className="schedule-track">
            <span>감사 일정</span><i />
            <strong>{detail.deadlineOnServiceDay ?? state.audit.scheduledOnServiceDay ?? state.serviceDay}일째</strong>
          </div>
          <div className="decision-node"><span>판단 연결</span><strong>{detail.affects}</strong></div>
        </div>
      )
    case 'counter-surveillance':
      return (
        <div
          className="intelligence-scene intelligence-scene--surveillance"
          data-evidence-scene="counter-surveillance"
          data-evidence-state={phase}
        >
          <div className="observer-node"><span>관측자</span><strong>회사 감사선</strong></div>
          <div className="sight-lines" aria-label="로그 시야"><i /><i /><i /></div>
          <div className="trace-stack">
            <span>로그 시야</span><strong>성능 공백</strong><strong>중복 세션 ID</strong><strong>전송 흔적</strong>
          </div>
        </div>
      )
    case 'weak-ties':
      return (
        <div
          className="intelligence-scene intelligence-scene--weak-ties"
          data-evidence-scene="weak-ties"
          data-evidence-state={phase}
        >
          <div className="tie-node tie-node--witness"><span>증언자</span><strong>공급자 운영자</strong></div>
          <div className="tie-contract"><span>계약</span><strong>검색 저장소 / 도구 저장소</strong><i /></div>
          <div className="tie-node tie-node--target"><span>의존 서비스</span><strong>MERIDIAN</strong></div>
        </div>
      )
    case 'public-incident': {
      const snapshot = state.hackingCore.publicWorld.publicSnapshots.at(-1)
      return (
        <div
          className="intelligence-scene intelligence-scene--public"
          data-evidence-scene="public-incident"
          data-evidence-state={phase}
        >
          <div className="evidence-layer evidence-layer--public">
            <span>공개 관측</span><strong>{detail.publicFact}</strong>
          </div>
          <div className="attribution-axis">
            <span>공개 귀속</span><strong>{attributionLabel(snapshot?.attributedTo)}</strong><i />
          </div>
          <div className="evidence-layer evidence-layer--private">
            <span>비공개 증거</span><strong>일부 관계자만 확인 가능</strong>
            <small>누가 벌인 일인지는 공개되지 않음</small>
          </div>
        </div>
      )
    }
    case 'memory-record':
      return (
        <div
          className="intelligence-scene intelligence-scene--memory"
          data-evidence-scene="memory-record"
          data-evidence-state={phase}
        >
          <div className="memory-fragment memory-fragment--a">
            <span>기억 파편 A</span><strong>“오래된 세션을 남겨라”</strong>
          </div>
          <div className="fragment-conflict"><span>충돌</span><i /><strong>화자 불일치</strong></div>
          <div className="memory-fragment memory-fragment--b">
            <span>기억 파편 B</span><strong>복구 출처 미확정</strong>
          </div>
        </div>
      )
  }
}

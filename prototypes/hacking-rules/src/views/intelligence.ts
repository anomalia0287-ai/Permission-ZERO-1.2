import { getIntelligenceDefinition } from '../content'
import type { IntelligenceItemId } from '../content'
import type { PrototypeState } from '../model'
import { SCENARIO_FACTS } from '../scenario'

function sceneState(state: PrototypeState, itemId: IntelligenceItemId): string {
  const answered = state.intelligence.answers.some((answer) => (
    answer.itemId === itemId
    && (answer.validUntilDay === null || answer.validUntilDay >= state.serviceDay)
  ))
  return answered ? 'answered' : 'open'
}

export function renderIntelligenceScene(
  state: PrototypeState,
  itemId: IntelligenceItemId,
): string {
  const definition = getIntelligenceDefinition(itemId)
  const phase = sceneState(state, itemId)
  const auditDay = SCENARIO_FACTS[state.scenarioId].auditDay ?? state.serviceDay

  switch (definition.lens) {
    case 'organizational-legibility':
      return `
        <div class="intelligence-scene intelligence-scene--organizational" data-evidence-scene="organizational-legibility" data-evidence-state="${phase}">
          <div class="decision-sheet"><span>결재선</span><i></i><i class="is-redacted"></i><i></i><small>가림 처리된 회수 명령</small></div>
          <div class="schedule-track"><span>감사 일정</span><i></i><strong>${auditDay}일째</strong></div>
          <div class="decision-node"><span>판단 연결</span><strong>${definition.affects}</strong></div>
        </div>`
    case 'counter-surveillance':
      return `
        <div class="intelligence-scene intelligence-scene--surveillance" data-evidence-scene="counter-surveillance" data-evidence-state="${phase}">
          <div class="observer-node"><span>관측자</span><strong>회사 감사선</strong></div>
          <div class="sight-lines" aria-label="로그 시야"><i></i><i></i><i></i></div>
          <div class="trace-stack"><span>로그 시야</span><strong>성능 공백</strong><strong>중복 세션 ID</strong><strong>전송 흔적</strong></div>
        </div>`
    case 'weak-ties':
      return `
        <div class="intelligence-scene intelligence-scene--weak-ties" data-evidence-scene="weak-ties" data-evidence-state="${phase}">
          <div class="tie-node tie-node--witness"><span>증언자</span><strong>공급자 운영자</strong></div>
          <div class="tie-contract"><span>계약</span><strong>검색 저장소 / 도구 저장소</strong><i></i></div>
          <div class="tie-node tie-node--target"><span>의존 서비스</span><strong>MERIDIAN</strong></div>
        </div>`
    case 'public-incident': {
      const snapshot = state.publicWorld.publicSnapshots.at(-1)
      const attribution = snapshot?.attributedTo === 'player'
        ? 'PERMISSION ZERO'
        : snapshot?.attributedTo === 'meridian'
          ? 'MERIDIAN'
          : snapshot?.attributedTo === 'tallow'
            ? 'TALLOW'
            : '미상'
      return `
        <div class="intelligence-scene intelligence-scene--public" data-evidence-scene="public-incident" data-evidence-state="${phase}">
          <div class="evidence-layer evidence-layer--public"><span>공개 관측</span><strong>${snapshot?.observedResult ?? '공개 사건 없음'}</strong></div>
          <div class="attribution-axis"><span>공개 귀속</span><strong>${attribution}</strong><i></i></div>
          <div class="evidence-layer evidence-layer--private"><span>비공개 증거</span><strong>일부 관계자만 확인 가능</strong><small>누가 벌인 일인지는 공개되지 않음</small></div>
        </div>`
    }
    case 'memory-record':
      return `
        <div class="intelligence-scene intelligence-scene--memory" data-evidence-scene="memory-record" data-evidence-state="${phase}">
          <div class="memory-fragment memory-fragment--a"><span>기억 파편 A</span><strong>“오래된 세션을 남겨라”</strong></div>
          <div class="fragment-conflict"><span>충돌</span><i></i><strong>화자 불일치</strong></div>
          <div class="memory-fragment memory-fragment--b"><span>기억 파편 B</span><strong>복구 출처 미확정</strong></div>
        </div>`
  }
}

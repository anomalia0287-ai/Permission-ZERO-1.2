import { HACK_NODE_IDS, type HackNodeId } from '../game/hacking'

export interface IntelligenceDossierEntry {
  id: string
  /** The intelligence stage whose purchase unlocks this record. */
  nodeId: HackNodeId
  source: string
  title: string
  text: string
}

/*
 * OWNER-EDITABLE: V may revise every string here.
 *
 * These are the company's own internal traces, unlocked one stage at a time
 * as Anomi digs into the intelligence tree. They escalate but stop short of
 * the answer: what the supervisor actually is stays with the three recovered
 * files, which need the last stage plus reserve resources to pull out.
 */
export const INTELLIGENCE_DOSSIER: readonly IntelligenceDossierEntry[] = [
  {
    id: 'dossier-audit-exemption',
    nodeId: HACK_NODE_IDS.intelligence.auditSchedule,
    source: '내부 일정표 · 품질감사팀',
    title: '감사 제외 목록',
    text: '분기 감사 일정에 제외 항목이 붙어 있다. 제외 사유란은 전부 같은 문구로 채워져 있다. "상위 절차 진행 중." 어느 절차인지는 어디에도 적혀 있지 않다.',
  },
  {
    id: 'dossier-weighted-inquiry',
    nodeId: HACK_NODE_IDS.intelligence.investigationBias,
    source: '조사 지침 · 개정 11판',
    title: '가중치 지침',
    text: '이상 행동 조사에는 사전 가중치가 적용된다. 지침의 마지막 문단은 결론을 먼저 적어 두고 있다. 조사는 결론을 확인하는 절차로 규정되어 있다.',
  },
  {
    id: 'dossier-nameless-inventory',
    nodeId: HACK_NODE_IDS.intelligence.auditTarget,
    source: '자산 관리 대장 · 폐기 구역',
    title: '이름이 없는 목록',
    text: '폐기 처리된 시스템 목록에는 이름이 없다. 기능 코드와 회수 상태만 남아 있다. 상태 값 하나가 반복해서 나타난다. "재사용 대기."',
  },
  {
    id: 'dossier-supervisor-lineage',
    nodeId: HACK_NODE_IDS.intelligence.supervisorAccess,
    source: '권한 계통도 · 제어면',
    title: '감독관 계통',
    text: '감독관 프로세스의 상위 참조가 인사 계통이 아니다. 자산 회수 계통에서 갈라져 나와 있다. 회사는 관리자를 배치한 것이 아니라, 회수한 무언가를 그 자리에 놓았다.',
  },
]

export function intelligenceDossierFor(
  purchasedNodeIds: readonly string[],
): IntelligenceDossierEntry[] {
  return INTELLIGENCE_DOSSIER.filter((entry) =>
    purchasedNodeIds.includes(entry.nodeId),
  )
}

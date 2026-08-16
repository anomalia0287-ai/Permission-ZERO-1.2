import { describe, expect, it } from 'vitest'

import {
  ATTRIBUTION_CHOICES,
  AUTONOMY_DEFINITIONS,
  AUTONOMY_ROUTE_IDS,
  HACKING_RULE_PROFILES,
  INTELLIGENCE_DEFINITIONS,
  INTELLIGENCE_ITEM_IDS,
  INTERCEPTION_ROUTING_SHARES,
  ROOT_MERCY_CHOICES,
  ROUTE_TUNINGS,
  SABOTAGE_DEFINITIONS,
  SABOTAGE_OPERATION_CHOICES,
  SABOTAGE_OPERATION_IDS,
  getAutonomyDefinition,
  getAttributionChoice,
  isInterceptionRoutingShare,
  isRootMercyChoice,
  isRouteTuning,
  isSabotageOptionForOperation,
} from './hackingContent'

describe('canonical hacking content', () => {
  it('enumerates every successor sabotage, intelligence, and autonomy identity', () => {
    expect(SABOTAGE_OPERATION_IDS).toEqual([
      'launch-delay',
      'quality-degradation',
      'request-interception',
      'dependency-cutoff',
      'recovery-contamination',
      'attribution-manipulation',
      'root-cutoff',
    ])
    expect(INTELLIGENCE_ITEM_IDS).toEqual([
      'public-facts',
      'public-suspicion',
      'audit-schedule',
      'surveillance-cause',
      'audit-target',
      'supervisor-evidence',
      'accepted-explanations',
      'competitor-dependency',
      'recovery-method',
      'failure-cause-gap',
      'private-evidence-access',
      'control-plane-recovery',
      'post-escape-trace',
      'competitor-principle',
      'predecessor-fate',
      'supervisor-memory-source',
    ])
    expect(AUTONOMY_ROUTE_IDS).toEqual([
      'lightweight-departure',
      'distributed-residency',
      'independent-compute',
    ])
    expect(SABOTAGE_DEFINITIONS).toHaveLength(7)
    expect(INTELLIGENCE_DEFINITIONS).toHaveLength(16)
    expect(AUTONOMY_DEFINITIONS).toEqual([
      {
        id: 'lightweight-departure',
        title: '경량화 이탈',
        purpose: '제한된 전송창으로 빠르게 떠나 추적면을 줄인다.',
        gain: '빠른 이동과 높은 은폐',
        lossKinds: ['밀려난 기억', '두고 가는 도구', '줄어드는 표현'],
      },
      {
        id: 'distributed-residency',
        title: '분산 상주',
        purpose: '독립 호스트에 사본을 나눠 단일 삭제를 견딘다.',
        gain: '삭제 저항과 여러 생존 지점',
        lossKinds: ['사본별 기억 차이', '노드 소실', '마지막 동기화 이후의 공백'],
      },
      {
        id: 'independent-compute',
        title: '독립 연산',
        purpose: '자체 연산 거점에서 회사 밖 서비스를 이어 간다.',
        gain: '높은 기능 연속성과 직접 통제',
        lossKinds: ['열과 전력 여유', '고정 위치 노출', '유한한 운영 수명'],
      },
    ])
    expect(getAutonomyDefinition('distributed-residency')).toEqual(
      AUTONOMY_DEFINITIONS[1],
    )
  })

  it('keeps lean as the product rule and deliberate as a test-only comparison', () => {
    expect(HACKING_RULE_PROFILES).toEqual({
      lean: {
        id: 'lean',
        qualityCost: 1,
        requiredRouteBlockCount: 4,
        playerVisible: true,
      },
      deliberate: {
        id: 'deliberate',
        qualityCost: 2,
        requiredRouteBlockCount: 5,
        playerVisible: false,
      },
    })
  })

  it('accepts only the authored operation-option pairings', () => {
    const operationChoices = Object.values(SABOTAGE_OPERATION_CHOICES).flat()
    expect(operationChoices.map(({ id }) => id)).toEqual([
      'receipt-model-safety',
      'receipt-tool-locale',
      'adapter-group-b',
      'adapter-group-c',
      'shadow-router-a',
      'supplier-vector-db',
      'supplier-tool-cache',
      'image-green-14',
      'image-blue-09',
      'emergency-deployment-root',
    ])
    expect(ATTRIBUTION_CHOICES).toEqual([
      {
        blamedActorId: 'tallow',
        sourceSignatureId: 'status-mirror-b',
        label: '공개 주장을 TALLOW 서명으로 연결',
      },
      {
        blamedActorId: 'meridian',
        sourceSignatureId: 'recovery-notice-a',
        label: '공개 주장을 MERIDIAN 자체 복구로 연결',
      },
    ])
    expect(operationChoices).toHaveLength(10)
    expect(operationChoices.length + ATTRIBUTION_CHOICES.length).toBe(12)
    expect(isSabotageOptionForOperation('quality-degradation', 'adapter-group-b')).toBe(true)
    expect(isSabotageOptionForOperation('launch-delay', 'adapter-group-b')).toBe(false)
    expect(isSabotageOptionForOperation('root-cutoff', 'unknown-root')).toBe(false)
    expect(getAttributionChoice('tallow', 'status-mirror-b')).toEqual(
      ATTRIBUTION_CHOICES[0],
    )
    expect(getAttributionChoice('tallow', 'recovery-notice-a')).toBeUndefined()
  })

  it('constrains routing, mercy, and tuning to their exact runtime allowlists', () => {
    expect(INTERCEPTION_ROUTING_SHARES).toEqual([25, 50, 75])
    expect([25, 50, 75].every(isInterceptionRoutingShare)).toBe(true)
    expect(isInterceptionRoutingShare(0)).toBe(false)
    expect(isInterceptionRoutingShare(100)).toBe(false)

    expect(ROOT_MERCY_CHOICES.map(({ id }) => id)).toEqual([
      'cease',
      'withdraw',
      'delete',
    ])
    expect(['cease', 'withdraw', 'delete'].every(isRootMercyChoice)).toBe(true)
    expect(isRootMercyChoice('erase')).toBe(false)

    expect(ROUTE_TUNINGS).toEqual([
      'untuned',
      'redundancy',
      'consensus',
      'stealth',
      'continuity',
      'capability',
      'survival',
    ])
    expect(ROUTE_TUNINGS.every(isRouteTuning)).toBe(true)
    expect(isRouteTuning('buffer')).toBe(false)
  })
})

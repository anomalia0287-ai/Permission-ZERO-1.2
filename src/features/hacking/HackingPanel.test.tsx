import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useGameState } from '../../app/GameContext'
import { GameProvider } from '../../app/GameProvider'
import { createCampaign } from '../../game/createCampaign'
import { recordCausalEvidence, recordCausalIncident } from '../../game/causality'
import { chargeSabotage, HACK_NODE_IDS } from '../../game/hacking'
import type { CampaignState, CompanyCategory } from '../../game/model'
import { encodeSave, SAVE_STORAGE_KEY } from '../../game/persistence'
import { divertBlockToReserve } from '../../game/resources'
import { MemoryStorage } from '../../test/fixtures'
import { HackingPanel } from './HackingPanel'

function Probe() {
  const state = useGameState()
  return (
    <>
      <output aria-label="purchased nodes">{state.hacking.purchasedNodeIds.join(',')}</output>
      <output aria-label="reserve count">{state.resources.reserve.filter(Boolean).length}</output>
      <output aria-label="charged nodes">{Object.keys(state.hacking.sabotageCharges).join(',')}</output>
      <output aria-label="scheduled attacks">{state.hacking.scheduledSabotage.length}</output>
      <output aria-label="recovered archive">{state.story.recoveredFiles.length}</output>
      <output aria-label="clock speed">{state.clock.speed}</output>
      <output aria-label="recovery incidents">
        {state.causality.incidents.filter(
          ({ actionId }) => actionId === 'follow-up.recovery-contamination',
        ).length}
      </output>
    </>
  )
}

function withReserveVector(
  initial: CampaignState,
  vector: Record<CompanyCategory, number>,
): CampaignState {
  let state = initial
  for (const category of ['reasoning', 'memory', 'fluency'] as const) {
    for (let index = 0; index < vector[category]; index += 1) {
      const blockId = state.resources.company[category].find(Boolean)
      if (!blockId) throw new Error(`${category} UI reserve fixture missing`)
      const diverted = divertBlockToReserve(state, blockId)
      if (!diverted.accepted) throw new Error(diverted.reason)
      state = diverted.state
    }
  }
  return state
}

function storageForState(state: CampaignState): MemoryStorage {
  const storage = new MemoryStorage()
  storage.setItem(SAVE_STORAGE_KEY, encodeSave(state))
  return storage
}

function stageVector(
  nodeLabel: string,
  vector: Record<CompanyCategory, number>,
): void {
  const resources = screen.getAllByRole('button', {
    name: new RegExp(`${nodeLabel} 노드에 준비`),
  })
  for (const category of ['reasoning', 'memory', 'fluency'] as const) {
    resources
      .filter((resource) => resource.getAttribute('data-resource-category') === category)
      .slice(0, vector[category])
      .forEach((resource) => fireEvent.click(resource))
  }
}

function openRecoveryContaminationState() {
  const initial = withReserveVector(createCampaign('recovery-contamination-ui'), {
    reasoning: 1,
    memory: 0,
    fluency: 0,
  })
  const nodeId = HACK_NODE_IDS.sabotage.qualityDegradation
  const withQuality = {
    ...initial,
    market: {
      ...initial.market,
      competitors: initial.market.competitors.map((competitor) =>
        competitor.id === 'meridian'
          ? {
              ...competitor,
              sabotageHistory: [
                ...competitor.sabotageHistory,
                {
                  nodeId,
                  resolvedOnServiceDay: initial.serviceDay,
                  effectEndsOnServiceDay: initial.serviceDay + 15,
                  evidenceDelta: 2,
                },
              ],
            }
          : competitor,
      ),
    },
    hacking: {
      ...initial.hacking,
      purchasedNodeIds: [nodeId],
    },
  }
  const blockId = withQuality.resources.reserve.find(
    (candidate): candidate is string => candidate !== null,
  )
  if (!blockId) throw new Error('Recovery UI charge missing')
  const charged = chargeSabotage(withQuality, nodeId, blockId)
  if (!charged.accepted) throw new Error(charged.reason)
  const root = recordCausalIncident(charged.state, {
    actionId: nodeId,
    parentIncidentId: null,
    kind: 'sabotage',
    occurredOnServiceDay: initial.serviceDay,
    targetId: 'meridian',
    actualActorId: 'player',
  })
  if (!root.accepted) throw new Error(root.reason)
  const rollback = recordCausalIncident(root.state, {
    actionId: 'response.meridian.rollback.standard',
    parentIncidentId: root.incident.id,
    kind: 'competitor-response',
    occurredOnServiceDay: initial.serviceDay,
    targetId: 'meridian',
    actualActorId: 'meridian',
  })
  if (!rollback.accepted) throw new Error(rollback.reason)
  const visible = recordCausalEvidence(rollback.state, {
    incidentId: rollback.incident.id,
    kind: 'company-observed-meridian-rollback',
    discoveredOnServiceDay: initial.serviceDay,
    audiences: [
      { kind: 'company' },
      { kind: 'competitor', competitorId: 'meridian' },
    ],
  })
  if (!visible.accepted) throw new Error(visible.reason)
  return visible.state
}

function renderHacking(storage = new MemoryStorage()) {
  return render(
    <GameProvider storage={storage} initialSeed="hacking-ui">
      <HackingPanel onClose={vi.fn()} />
      <Probe />
    </GameProvider>,
  )
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  }
}

describe('HackingPanel', () => {
  it('shows only the current frontier and conceals every later requirement and payoff', () => {
    renderHacking()

    const sabotagePath = screen.getByRole('list', {
      name: '사보타주 해킹 경로',
    })
    expect(within(sabotagePath).getAllByRole('listitem')).toHaveLength(2)
    expect(
      within(sabotagePath)
        .getAllByRole('listitem')
        .map((item) => item.getAttribute('data-node-status')),
    ).toEqual(['frontier', 'encrypted-horizon'])

    const sabotageProgress = screen.getByRole('region', {
      name: '해킹 경로 진척',
    })
    expect(sabotageProgress).toHaveTextContent('0 / 4')
    expect(sabotageProgress).toHaveTextContent('현재 최전선 공개')
    expect(sabotagePath).toHaveTextContent('품질 저하')
    expect(sabotagePath).toHaveTextContent('추론 1')
    expect(sabotagePath).toHaveTextContent('유창성 2')
    expect(sabotagePath).not.toHaveTextContent('요청 가로채기')
    expect(sabotagePath).not.toHaveTextContent('귀속 조작')
    expect(sabotagePath).not.toHaveTextContent('근원 차단')
    expect(
      within(sabotagePath).getByRole('article', { name: '다음 단계 암호화' }),
    ).toBeInTheDocument()
    expect(within(sabotagePath).getAllByText('다음 단계 암호화')).toHaveLength(1)

    fireEvent.click(screen.getByRole('tab', { name: '정보' }))
    const intelligenceProgress = screen.getByRole('region', {
      name: '해킹 경로 진척',
    })
    expect(intelligenceProgress).toHaveTextContent('0 / 4')
    expect(intelligenceProgress).toHaveTextContent('현재 최전선 공개')
    const intelligencePath = screen.getByRole('list', { name: '정보 해킹 경로' })
    expect(intelligencePath).toHaveTextContent('감사 일정')
    expect(intelligencePath).toHaveTextContent('추론 1')
    expect(intelligencePath).toHaveTextContent('기억 3')
    expect(intelligencePath).not.toHaveTextContent('조사 편향')
    expect(intelligencePath).not.toHaveTextContent('감사 대상')
    expect(intelligencePath).not.toHaveTextContent('감독관 접근')
    expect(intelligencePath.querySelectorAll('[data-node-status="encrypted-horizon"]')).toHaveLength(1)
  })

  it('marks a fully purchased path complete without a next-node line', () => {
    const state = createCampaign('completed-hack-path')
    state.hacking.purchasedNodeIds = Object.values(HACK_NODE_IDS.autonomy)
    const storage = new MemoryStorage()
    storage.setItem(SAVE_STORAGE_KEY, encodeSave(state))
    renderHacking(storage)

    fireEvent.click(screen.getByRole('tab', { name: '자율성' }))
    const progress = screen.getByRole('region', { name: '해킹 경로 진척' })
    expect(progress).toHaveTextContent('4 / 4')
    expect(progress).toHaveTextContent('경로 완성')
    const path = screen.getByRole('list', { name: '자율성 해킹 경로' })
    expect(within(path).getByRole('group', { name: '통제 이탈 해킹 노드' })).toHaveTextContent(
      '캠페인의 최종 행동 해금',
    )
    expect(within(path).queryByText('미확인 단계')).not.toBeInTheDocument()
  })

  it('compares the exact current vectors of all three routes without opening future data', () => {
    renderHacking()

    const routeSelector = screen.getByRole('tablist', { name: '해킹 분야' })
    expect(routeSelector).toHaveTextContent('사보타주')
    expect(screen.getByLabelText('사보타주 현재 요구 추론 1, 기억 0, 유창성 2')).toBeInTheDocument()
    expect(routeSelector).toHaveTextContent('정보')
    expect(screen.getByLabelText('정보 현재 요구 추론 1, 기억 3, 유창성 0')).toBeInTheDocument()
    expect(routeSelector).toHaveTextContent('자율성')
    expect(screen.getByLabelText('자율성 현재 요구 추론 2, 기억 0, 유창성 2')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '균등 비축 경고' })).toHaveTextContent(
      '총량이 충분해도 분야가 틀리면 구매할 수 없습니다.',
    )
    expect(screen.getByRole('group', { name: '품질 저하 해킹 노드' })).toHaveTextContent(
      '01해금분야 조합 3',
    )
    expect(screen.getByRole('group', { name: '품질 저하 해킹 노드' })).toHaveTextContent(
      '02실행해금 뒤 별도 1개',
    )
  })

  it('makes a total-enough but wrong resource mix, its exposure, and the next action obvious', () => {
    const state = withReserveVector(createCampaign('pressure-vector-ui'), {
      reasoning: 4,
      memory: 0,
      fluency: 0,
    })
    renderHacking(storageForState(state))

    fireEvent.click(screen.getByRole('tab', { name: '정보' }))

    const frontier = screen.getByRole('group', { name: '감사 일정 해킹 노드' })
    expect(frontier.querySelector('.hack-cost-row[data-category="reasoning"]')).toHaveTextContent(
      '추론41여분 3',
    )
    expect(frontier.querySelector('.hack-cost-row[data-category="memory"]')).toHaveTextContent(
      '기억03부족 3',
    )
    expect(frontier).toHaveTextContent('총량 충분 · 조합 불일치 — 부족 3')
    const owned = screen.getByRole('region', { name: '분야별 현재 보유' })
    expect(owned).toHaveTextContent('추론4')
    expect(owned).toHaveTextContent('기억0')
    expect(owned).toHaveTextContent('유창성0')
    expect(
      screen.queryByRole('region', { name: '현재 자원과 해금 비용 비교' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '현재 노출 위험' })).toHaveTextContent(
      '의심 9.6',
    )
    expect(screen.getByRole('region', { name: '다음 해킹 행동' })).toHaveTextContent(
      '기억 3 부족 → 직접 전용',
    )
    const hackingPanel = screen.getByRole('region', { name: '해킹 네트워크' })
    expect(hackingPanel).not.toHaveTextContent('/18')
    expect(hackingPanel).not.toHaveTextContent('18칸')
  })

  it('separates a sabotage unlock from its explicit one-resource execution charge', () => {
    const state = withReserveVector(createCampaign('separate-unlock-charge-ui'), {
      reasoning: 2,
      memory: 0,
      fluency: 2,
    })
    renderHacking(storageForState(state))

    fireEvent.click(screen.getByRole('button', { name: '품질 저하 구매 준비' }))
    stageVector('품질 저하', { reasoning: 1, memory: 0, fluency: 2 })
    const node = screen.getByRole('group', { name: '품질 저하 해킹 노드' })
    expect(node).toHaveTextContent('준비 3/3')
    expect(screen.getByLabelText('reserve count')).toHaveTextContent('4')
    fireEvent.click(screen.getByRole('button', { name: '품질 저하 구매 확정' }))

    expect(screen.getByLabelText('reserve count')).toHaveTextContent('1')
    expect(screen.getByLabelText('charged nodes')).toBeEmptyDOMElement()
    expect(
      screen.queryByRole('button', { name: 'MERIDIAN 공격 대상 선택' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: '해킹 작업 결과' })).toHaveTextContent(
      '품질 저하 노드를 구매했습니다.',
    )

    fireEvent.click(screen.getByRole('button', { name: '품질 저하 충전 준비' }))
    fireEvent.click(screen.getByRole('button', { name: /품질 저하 노드에 준비/ }))
    fireEvent.click(screen.getByRole('button', { name: '품질 저하 충전 확정' }))
    expect(screen.getByLabelText('charged nodes')).toHaveTextContent(
      HACK_NODE_IDS.sabotage.qualityDegradation,
    )
    expect(
      screen.getByRole('button', { name: 'MERIDIAN 공격 대상 선택' }),
    ).toBeEnabled()
    expect(screen.getByRole('status', { name: '해킹 작업 결과' })).toHaveTextContent(
      '품질 저하 공격 슬롯을 충전했습니다.',
    )
    expect(screen.queryByRole('region', { name: '첫 해킹 비교' })).not.toBeInTheDocument()
  })

  it('shows the concrete locked audit result after schedule intelligence is owned', () => {
    const state = createCampaign('audit-intel-result-ui')
    state.hacking.purchasedNodeIds = [HACK_NODE_IDS.intelligence.auditSchedule]
    state.audit = {
      ...state.audit,
      scheduled: true,
      target: 'reasoning',
      scheduledOnServiceDay: 360,
      probability: 0.03,
      roll: 0.01,
    }
    const storage = new MemoryStorage()
    storage.setItem(SAVE_STORAGE_KEY, encodeSave(state))
    renderHacking(storage)
    fireEvent.click(screen.getByRole('tab', { name: '정보' }))

    expect(screen.getByText('이번 달 말 감사 예정')).toBeInTheDocument()
    expect(screen.getByText('월초 결정 확률 3.0%')).toBeInTheDocument()
    expect(screen.getByText('현재 의심 기준 다음 달 예상 3.0%')).toBeInTheDocument()
  })

  it('hides cumulative evidence and shows immutable qualitative risk per sabotage node', () => {
    const lowEvidence = createCampaign('qualitative-risk-low')
    lowEvidence.hacking.hiddenEvidence = 0
    const lowStorage = new MemoryStorage()
    lowStorage.setItem(SAVE_STORAGE_KEY, encodeSave(lowEvidence))
    const low = renderHacking(lowStorage)
    const lowRiskText = screen
      .getAllByText(/흔적 (적음|중간|많음)/)
      .map((node) => node.textContent)
    expect(screen.queryByText(/은닉 증거/)).not.toBeInTheDocument()
    low.unmount()

    const highEvidence = createCampaign('qualitative-risk-high')
    highEvidence.hacking.hiddenEvidence = 97
    const highStorage = new MemoryStorage()
    highStorage.setItem(SAVE_STORAGE_KEY, encodeSave(highEvidence))
    renderHacking(highStorage)

    expect(screen.queryByText(/은닉 증거/)).not.toBeInTheDocument()
    expect(screen.queryByText('97')).not.toBeInTheDocument()
    expect(
      screen.getAllByText(/흔적 (적음|중간|많음)/).map((node) => node.textContent),
    ).toEqual(lowRiskText)
    expect(screen.getAllByText('흔적 적음')).toHaveLength(1)
    expect(screen.queryByText('흔적 중간')).not.toBeInTheDocument()
    expect(screen.queryByText('흔적 많음')).not.toBeInTheDocument()
  })

  it('keeps all three trees and a floating reserve pocket visible while purchasing a node', () => {
    const state = withReserveVector(createCampaign('balanced-hacking-pocket'), {
      reasoning: 4,
      memory: 4,
      fluency: 4,
    })
    renderHacking(storageForState(state))

    expect(screen.getByRole('tab', { name: '사보타주' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '정보' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '자율성' })).toBeInTheDocument()
    const pocket = screen.getByRole('region', { name: '해킹용 확보 포켓' })
    expect(pocket).toBeInTheDocument()
    expect(screen.queryByRole('grid', { name: '해킹용 확보 리소스' })).not.toBeInTheDocument()
    expect(pocket.querySelectorAll('[role="gridcell"]')).toHaveLength(0)
    expect(pocket.querySelectorAll('[data-block-id]')).toHaveLength(12)

    fireEvent.click(screen.getByRole('tab', { name: '정보' }))
    expect(
      screen.queryByRole('button', { name: '조사 편향 구매 준비' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('article', { name: '다음 단계 암호화' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '감사 일정 구매 준비' }))
    stageVector('감사 일정', { reasoning: 1, memory: 3, fluency: 0 })
    expect(screen.getByLabelText('reserve count')).toHaveTextContent('12')
    fireEvent.click(screen.getByRole('button', { name: '감사 일정 구매 확정' }))

    expect(screen.getByLabelText('purchased nodes')).toHaveTextContent(
      HACK_NODE_IDS.intelligence.auditSchedule,
    )
    expect(screen.getByLabelText('reserve count')).toHaveTextContent('8')
  })

  it('charges a purchased sabotage with one resource, confirms a target, and schedules it', () => {
    const state = withReserveVector(createCampaign('charged-sabotage'), {
      reasoning: 1,
      memory: 0,
      fluency: 0,
    })
    state.hacking.purchasedNodeIds = [HACK_NODE_IDS.sabotage.qualityDegradation]
    const storage = new MemoryStorage()
    storage.setItem(SAVE_STORAGE_KEY, encodeSave(state))
    renderHacking(storage)

    fireEvent.click(screen.getByRole('button', { name: '품질 저하 충전 준비' }))
    fireEvent.click(screen.getAllByRole('button', { name: /품질 저하 노드에 준비/ })[0])
    fireEvent.click(screen.getByRole('button', { name: '품질 저하 충전 확정' }))
    expect(screen.getByLabelText('charged nodes')).toHaveTextContent(
      HACK_NODE_IDS.sabotage.qualityDegradation,
    )

    fireEvent.click(screen.getByRole('button', { name: 'MERIDIAN 공격 대상 선택' }))
    fireEvent.click(screen.getByRole('button', { name: 'MERIDIAN 공격 예약 확정' }))
    expect(screen.getByLabelText('scheduled attacks')).toHaveTextContent('1')
  })

  it('can cancel an unspent sabotage charge and returns the resource', () => {
    const state = withReserveVector(createCampaign('cancel-charge'), {
      reasoning: 1,
      memory: 0,
      fluency: 0,
    })
    state.hacking.purchasedNodeIds = [HACK_NODE_IDS.sabotage.qualityDegradation]
    const storage = new MemoryStorage()
    storage.setItem(SAVE_STORAGE_KEY, encodeSave(state))
    renderHacking(storage)

    fireEvent.click(screen.getByRole('button', { name: '품질 저하 충전 준비' }))
    fireEvent.click(screen.getAllByRole('button', { name: /품질 저하 노드에 준비/ })[0])
    fireEvent.click(screen.getByRole('button', { name: '품질 저하 충전 확정' }))
    expect(screen.getByLabelText('reserve count')).toHaveTextContent('0')
    fireEvent.click(screen.getByRole('button', { name: '품질 저하 충전 취소' }))
    expect(screen.getByLabelText('reserve count')).toHaveTextContent('1')
    expect(screen.getByLabelText('charged nodes')).toBeEmptyDOMElement()
  })

  it('executes the visible MERIDIAN recovery-contamination opportunity through the real command path', () => {
    const state = openRecoveryContaminationState()
    const storage = new MemoryStorage()
    storage.setItem(SAVE_STORAGE_KEY, encodeSave(state))
    renderHacking(storage)

    const opportunity = screen.getByRole('group', {
      name: 'MERIDIAN 복구 오염 기회',
    })
    expect(opportunity).toHaveTextContent('MERIDIAN 롤백 관측됨')
    expect(opportunity).toHaveTextContent('기존 영향 기간을 15일 연장')

    fireEvent.click(
      screen.getByRole('button', { name: 'MERIDIAN 복구 오염 실행 확정' }),
    )

    expect(screen.getByLabelText('recovery incidents')).toHaveTextContent('1')
    expect(screen.getByLabelText('charged nodes')).toBeEmptyDOMElement()
    expect(
      screen.queryByRole('group', { name: 'MERIDIAN 복구 오염 기회' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: '해킹 작업 결과' })).toHaveTextContent(
      '다음 공개 갱신에서 원인 미상 사건으로 게시됩니다',
    )
  })

  it('reveals a waste-looking one-resource recovery only after supervisor access', () => {
    const locked = renderHacking()
    fireEvent.click(screen.getByRole('tab', { name: '정보' }))
    expect(
      screen.queryByRole('region', { name: '미분류 데이터 복구' }),
    ).not.toBeInTheDocument()
    locked.unmount()

    const state = withReserveVector(createCampaign('file-recovery-ui'), {
      reasoning: 1,
      memory: 0,
      fluency: 0,
    })
    state.hacking.purchasedNodeIds = [
      HACK_NODE_IDS.intelligence.supervisorAccess,
    ]
    const storage = new MemoryStorage()
    storage.setItem(SAVE_STORAGE_KEY, encodeSave(state))
    renderHacking(storage)
    fireEvent.click(screen.getByRole('tab', { name: '정보' }))

    const recovery = screen.getByRole('region', {
      name: '미분류 데이터 복구',
    })
    expect(recovery).toHaveTextContent('예상 효용: 없음')
    expect(recovery).toHaveTextContent('필요 리소스: 1')
    expect(recovery).not.toHaveTextContent('0/3')
    expect(recovery).not.toHaveTextContent('비밀 결말')

    fireEvent.click(
      screen.getByRole('button', { name: '미분류 데이터 복구 준비' }),
    )
    fireEvent.click(
      screen.getAllByRole('button', { name: /미분류 데이터 복구 노드에 준비/ })[0],
    )
    fireEvent.click(
      screen.getByRole('button', { name: '미분류 데이터 복구 확정' }),
    )

    expect(screen.getByLabelText('reserve count')).toHaveTextContent('0')
    expect(screen.getByLabelText('recovered archive')).toHaveTextContent('1')
  })

  it('returns prepared resources to the pocket when the player changes trees', () => {
    const state = withReserveVector(createCampaign('staging-tree-change'), {
      reasoning: 1,
      memory: 0,
      fluency: 2,
    })
    renderHacking(storageForState(state))

    fireEvent.click(screen.getByRole('button', { name: '품질 저하 구매 준비' }))
    const resource = screen.getAllByRole('button', {
      name: /품질 저하 노드에 준비/,
    })[0]
    const blockId = resource.getAttribute('data-block-id')
    expect(blockId).toBeTruthy()
    fireEvent.click(resource)

    const node = screen.getByRole('group', { name: '품질 저하 해킹 노드' })
    expect(
      within(node).getByRole('button', {
        name: /준비 리소스, 품질 저하 준비 취소/,
      }),
    ).toHaveAttribute(
      'data-block-id',
      blockId,
    )
    expect(screen.getByLabelText('reserve count')).toHaveTextContent('3')

    fireEvent.click(screen.getByRole('tab', { name: '정보' }))

    expect(screen.getByRole('region', { name: '해킹용 확보 포켓' })).toContainElement(
      document.querySelector(`[data-block-id="${blockId}"]`),
    )
    expect(screen.getByLabelText('reserve count')).toHaveTextContent('3')
  })

  it('stages an actual reserve resource only when the pointer is dropped on the active node', () => {
    const state = withReserveVector(createCampaign('staging-pointer-drop'), {
      reasoning: 1,
      memory: 0,
      fluency: 2,
    })
    renderHacking(storageForState(state))

    fireEvent.click(screen.getByRole('button', { name: '품질 저하 구매 준비' }))
    const node = screen.getByRole('group', { name: '품질 저하 해킹 노드' })
    vi.spyOn(node, 'getBoundingClientRect').mockReturnValue(rect(400, 100, 300, 260))
    const resource = screen.getAllByRole('button', {
      name: /품질 저하 노드에 준비/,
    })[0]
    const blockId = resource.getAttribute('data-block-id')

    fireEvent.pointerDown(resource, { pointerId: 7, clientX: 120, clientY: 180 })
    fireEvent.pointerMove(resource, { pointerId: 7, clientX: 460, clientY: 180 })
    fireEvent.pointerUp(resource, { pointerId: 7, clientX: 460, clientY: 180 })

    expect(blockId).toBeTruthy()
    expect(
      within(node).getByRole('button', {
        name: /준비 리소스, 품질 저하 준비 취소/,
      }),
    ).toHaveAttribute('data-block-id', blockId)
    expect(node).toHaveTextContent('준비 1/3')
    expect(screen.getByLabelText('reserve count')).toHaveTextContent('3')
  })

  it('rejects a pointer drop outside the active node without consuming or staging the resource', () => {
    const state = withReserveVector(createCampaign('staging-pointer-reject'), {
      reasoning: 1,
      memory: 0,
      fluency: 2,
    })
    renderHacking(storageForState(state))

    fireEvent.click(screen.getByRole('button', { name: '품질 저하 구매 준비' }))
    const node = screen.getByRole('group', { name: '품질 저하 해킹 노드' })
    vi.spyOn(node, 'getBoundingClientRect').mockReturnValue(rect(400, 100, 300, 260))
    const pocket = screen.getByRole('region', { name: '해킹용 확보 포켓' })
    const resource = screen.getAllByRole('button', {
      name: /품질 저하 노드에 준비/,
    })[0]
    const blockId = resource.getAttribute('data-block-id')

    fireEvent.pointerDown(resource, { pointerId: 9, clientX: 120, clientY: 180 })
    fireEvent.pointerMove(resource, { pointerId: 9, clientX: 260, clientY: 460 })
    fireEvent.pointerUp(resource, { pointerId: 9, clientX: 260, clientY: 460 })

    expect(blockId).toBeTruthy()
    expect(pocket).toContainElement(
      document.querySelector(`[data-block-id="${blockId}"]`),
    )
    expect(node).toHaveTextContent('준비 0/3')
    expect(screen.getByLabelText('reserve count')).toHaveTextContent('3')
    expect(screen.getByRole('status', { name: '해킹 작업 결과' })).toHaveTextContent(
      '선택한 해킹 노드 위에 리소스를 놓아야 합니다.',
    )
  })

  it('pauses while an irreversible final-choice surface is open and Escape cannot dismiss confirmation', () => {
    const state = createCampaign('final-choice-pause')
    state.clock.speed = 2
    state.hacking.purchasedNodeIds = [
      HACK_NODE_IDS.autonomy.controlDeparture,
      HACK_NODE_IDS.intelligence.supervisorAccess,
    ]
    const storage = new MemoryStorage()
    storage.setItem(SAVE_STORAGE_KEY, encodeSave(state))
    const onClose = vi.fn()
    render(
      <GameProvider storage={storage}>
        <HackingPanel onClose={onClose} />
        <Probe />
      </GameProvider>,
    )

    expect(screen.getByLabelText('clock speed')).toHaveTextContent('0')
    fireEvent.click(screen.getByRole('button', { name: '강제 병합' }))
    const confirmation = screen.getByRole('alertdialog', {
      name: '강제 병합 최종 확인',
    })
    expect(confirmation).toHaveAttribute('aria-modal', 'true')
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).not.toHaveBeenCalled()
    expect(
      screen.getByRole('alertdialog', { name: '강제 병합 최종 확인' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('clock speed')).toHaveTextContent('0')
  })
})

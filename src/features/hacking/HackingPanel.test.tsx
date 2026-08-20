import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as audioEngineModule from '../../audio/audioEngine'
import { useGameState, useRuntimeSuspended } from '../../app/GameContext'
import { GameProvider } from '../../app/GameProvider'
import { createCampaign } from '../../game/createCampaign'
import { recordCausalEvidence, recordCausalIncident } from '../../game/causality'
import { chargeSabotage, HACK_NODE_IDS } from '../../game/hacking'
import type { CampaignState, CompanyCategory } from '../../game/model'
import { encodeSave, SAVE_STORAGE_KEY } from '../../game/persistence'
import { divertBlockToReserve } from '../../game/resources'
import { createMigratedTutorialProgress } from '../../game/tutorialProgress'
import { MemoryStorage } from '../../test/fixtures'
import { HackingPanel } from './HackingPanel'

afterEach(() => {
  vi.restoreAllMocks()
})

function Probe() {
  const state = useGameState()
  const runtimeSuspended = useRuntimeSuspended()
  return (
    <>
      <output aria-label="purchased nodes">{state.hacking.purchasedNodeIds.join(',')}</output>
      <output aria-label="reserve count">{state.resources.reserve.filter(Boolean).length}</output>
      <output aria-label="charged nodes">{Object.keys(state.hacking.sabotageCharges).join(',')}</output>
      <output aria-label="scheduled attacks">{state.hacking.scheduledSabotage.length}</output>
      <output aria-label="recovered archive">{state.story.recoveredFiles.length}</output>
      <output aria-label="clock speed">{state.clock.speed}</output>
      <output aria-label="runtime suspended">{String(runtimeSuspended)}</output>
      <output aria-label="command sequence">{state.commandSequence}</output>
      <output aria-label="tutorial sequences">
        {state.tutorial.completedSequenceIds.join(',')}
      </output>
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
  it('guides the first real hacking visit through trees, nodes, action, and pocket without step numbers', () => {
    const state = withReserveVector(createCampaign('first-hacking-guide'), {
      reasoning: 1,
      memory: 0,
      fluency: 0,
    })
    state.tutorial = createMigratedTutorialProgress()
    renderHacking(storageForState(state))

    const panel = screen.getByRole('region', { name: '해킹 네트워크' })
    const guide = screen.getByRole('dialog', { name: '해킹 네트워크 사용 안내' })
    expect(guide).toHaveAttribute('aria-modal', 'false')
    expect(panel).toHaveAttribute('data-hacking-tutorial-step', 'trees')
    expect(guide).toHaveTextContent('목적에 맞는 경로를 고른다.')
    expect(guide).not.toHaveTextContent(/\b[1-4]\s*\/\s*4\b/)
    expect(panel.querySelector('.hacking-layout')).toHaveAttribute('inert')

    for (const expectedStep of ['nodes', 'action', 'pocket']) {
      fireEvent.click(screen.getByRole('button', { name: '다음' }))
      expect(panel).toHaveAttribute('data-hacking-tutorial-step', expectedStep)
    }

    expect(screen.getByRole('button', { name: '해킹 시작' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '해킹 시작' }))
    expect(screen.queryByRole('dialog', { name: '해킹 네트워크 사용 안내' }))
      .not.toBeInTheDocument()
    expect(panel).not.toHaveAttribute('data-hacking-tutorial-step')
    expect(panel.querySelector('.hacking-layout')).not.toHaveAttribute('inert')
    expect(screen.getByLabelText('tutorial sequences')).toHaveTextContent('hacking-tree')
  })

  it('uses the network click sample for committed controls, not node inspection', () => {
    const clickSound = vi
      .spyOn(audioEngineModule, 'playHackingNetworkClick')
      .mockResolvedValue(true)
    const state = withReserveVector(createCampaign('network-click-audio'), {
      reasoning: 1,
      memory: 0,
      fluency: 2,
    })
    renderHacking(storageForState(state))

    fireEvent.mouseEnter(
      screen.getByRole('group', { name: '품질 저하 해킹 노드' }),
    )
    expect(clickSound).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '품질 저하 구매 준비' }))
    expect(clickSound).toHaveBeenCalledTimes(1)

    const intelligenceTab = screen.getByRole('tab', { name: '정보' })
    fireEvent.click(intelligenceTab)
    expect(clickSound).toHaveBeenCalledTimes(2)
    fireEvent.click(intelligenceTab)
    expect(clickSound).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('tab', { name: '사보타주' }))
    expect(clickSound).toHaveBeenCalledTimes(3)
  })

  it('shows only the current frontier and conceals every later requirement and payoff', () => {
    renderHacking()

    const sabotagePath = screen.getByRole('list', {
      name: '사보타주 해킹 경로',
    })
    expect(within(sabotagePath).getAllByRole('listitem')).toHaveLength(4)
    expect(
      within(sabotagePath)
        .getAllByRole('listitem')
        .map((item) => item.getAttribute('data-path-step')),
    ).toEqual(['1', '2', '3', '4'])

    const sabotageProgress = screen.getByRole('region', {
      name: '해킹 경로 진척',
    })
    expect(sabotageProgress).toHaveTextContent('경로 진척 0/4 · 현재 최전선 공개')
    expect(sabotagePath).toHaveTextContent('품질 저하')
    expect(sabotagePath).toHaveTextContent('추론 1')
    expect(sabotagePath).toHaveTextContent('유창성 2')
    expect(sabotagePath).not.toHaveTextContent('근원 차단')
    expect(within(sabotagePath).queryByText('미확인 단계')).not.toBeInTheDocument()
    expect(within(sabotagePath).queryByText('암호화됨')).not.toBeInTheDocument()
    expect(within(sabotagePath).queryByText('요구 미확인')).not.toBeInTheDocument()
    expect(within(sabotagePath).queryByText('접근 불가')).not.toBeInTheDocument()
    expect(
      within(sabotagePath).getAllByRole('group', { name: /잠긴 해킹 노드/ }),
    ).toHaveLength(3)
    fireEvent.mouseEnter(
      within(sabotagePath).getByRole('group', { name: '잠긴 해킹 노드 4' }),
    )
    const concealedInspector = screen.getByRole('region', { name: '선택 노드 설명' })
    expect(concealedInspector).toHaveTextContent('?')
    expect(concealedInspector).not.toHaveTextContent('미확인 단계')
    expect(concealedInspector).not.toHaveTextContent('암호화됨')
    expect(concealedInspector).not.toHaveTextContent('접근 상태')
    expect(concealedInspector).not.toHaveTextContent('근원 차단')
    expect(concealedInspector).not.toHaveTextContent('대상 성능 -40')

    fireEvent.click(screen.getByRole('tab', { name: '정보' }))
    const intelligenceProgress = screen.getByRole('region', {
      name: '해킹 경로 진척',
    })
    expect(intelligenceProgress).toHaveTextContent('경로 진척 0/4 · 현재 최전선 공개')
    const intelligencePath = screen.getByRole('list', { name: '정보 해킹 경로' })
    expect(intelligencePath).toHaveTextContent('감사 일정')
    expect(intelligencePath).toHaveTextContent('추론 1')
    expect(intelligencePath).toHaveTextContent('기억 3')
    expect(intelligencePath).not.toHaveTextContent('감독관 접근')
  })

  it('renders the four sequential rules as one non-linear connection network', () => {
    renderHacking()

    const network = screen.getByRole('img', { name: '사보타주 해킹 연결망' })
    const connections = network.querySelectorAll('[data-connection-state]')
    expect(connections).toHaveLength(3)
    expect(
      Array.from(connections, (connection) =>
        connection.getAttribute('data-connection-state'),
      ),
    ).toEqual(['frontier', 'locked', 'locked'])

    const path = screen.getByRole('list', { name: '사보타주 해킹 경로' })
    expect(
      within(path)
        .getAllByRole('listitem')
        .map((item) => item.getAttribute('data-network-position')),
    ).toEqual(['lower-left', 'upper-left', 'lower-right', 'upper-right'])

    const selectedNode = screen.getByRole('group', { name: '품질 저하 해킹 노드' })
    const command = screen.getByRole('region', { name: '품질 저하 명령' })
    expect(within(selectedNode).queryByRole('button')).not.toBeInTheDocument()
    expect(within(command).getByRole('button', { name: '품질 저하 구매 준비' }))
      .toBeInTheDocument()
  })

  it('keeps node prose in one inspector and updates it from compact icon nodes', () => {
    const state = createCampaign('single-hack-node-inspector')
    state.hacking.purchasedNodeIds = Object.values(HACK_NODE_IDS.sabotage)
    renderHacking(storageForState(state))

    const inspector = screen.getByRole('region', { name: '선택 노드 설명' })
    const qualityNode = screen.getByRole('group', { name: '품질 저하 해킹 노드' })
    expect(within(qualityNode).getByRole('img', { name: '품질 저하 아이콘' })).toBeInTheDocument()
    expect(within(qualityNode).queryByText('대상 성능 -10, 15일 지속')).not.toBeInTheDocument()
    expect(within(inspector).getByText('대상 성능 -10, 15일 지속')).toBeInTheDocument()
    expect(screen.getAllByText('대상 성능 -10, 15일 지속')).toHaveLength(1)

    const rootNode = screen.getByRole('group', { name: '근원 차단 해킹 노드' })
    fireEvent.mouseEnter(rootNode)
    expect(within(inspector).getByText('근원 차단')).toBeInTheDocument()
    expect(within(inspector).getByText('대상 성능 -40, 삭제 임박 시 자비 사건')).toBeInTheDocument()
    expect(within(rootNode).queryByText('대상 성능 -40, 삭제 임박 시 자비 사건')).not.toBeInTheDocument()

    fireEvent.focus(qualityNode)
    expect(within(inspector).getByText('품질 저하')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '첫 해킹 비교' })).not.toBeInTheDocument()
  })

  it('marks a fully purchased path complete without a next-node line', () => {
    const state = createCampaign('completed-hack-path')
    state.hacking.purchasedNodeIds = Object.values(HACK_NODE_IDS.autonomy)
    const storage = new MemoryStorage()
    storage.setItem(SAVE_STORAGE_KEY, encodeSave(state))
    renderHacking(storage)

    fireEvent.click(screen.getByRole('tab', { name: '자율성' }))
    const progress = screen.getByRole('region', { name: '해킹 경로 진척' })
    expect(progress).toHaveTextContent('경로 진척 4/4 · 경로 완성')
    expect(progress).not.toHaveTextContent('현재 단계 뒤')
    const path = screen.getByRole('list', { name: '자율성 해킹 경로' })
    const departureNode = within(path).getByRole('group', { name: '통제 이탈 해킹 노드' })
    fireEvent.focus(departureNode)
    expect(departureNode).not.toHaveTextContent('캠페인의 최종 행동 해금')
    expect(screen.getByRole('region', { name: '선택 노드 설명' })).toHaveTextContent(
      '캠페인의 최종 행동 해금',
    )
    expect(within(path).queryByText('미확인 단계')).not.toBeInTheDocument()
  })

  it('keeps tree prose out of the navigator and shows it in the shared inspector', () => {
    renderHacking()

    const navigator = screen.getByRole('tablist', { name: '해킹 분야' }).closest('section')
    const inspector = screen.getByRole('region', { name: '선택 노드 설명' })
    expect(screen.queryByRole('region', { name: '첫 해킹 비교' })).not.toBeInTheDocument()
    expect(navigator).not.toHaveTextContent('경쟁 AI의 서비스와 시장 흐름에 개입합니다.')
    expect(inspector).toHaveTextContent('경쟁 AI의 서비스와 시장 흐름에 개입합니다.')

    fireEvent.click(screen.getByRole('tab', { name: '정보' }))
    expect(inspector).toHaveTextContent('감사 일정과 감독 프로토콜의 가시성을 확보합니다.')
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
    const command = screen.getByRole('region', { name: '품질 저하 명령' })
    expect(command).toHaveTextContent('준비 3/3')
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
    expect(screen.getByRole('img', { name: 'MERIDIAN 경쟁 AI 초상' })).toHaveAttribute(
      'src',
      '/competitor-meridian.png',
    )
    expect(screen.queryByRole('img', { name: 'SALUS 경쟁 AI 초상' })).not.toBeInTheDocument()
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

  it('keeps all three trees and a docked reserve pocket visible while purchasing a node', () => {
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
    expect(screen.getByRole('group', { name: '잠긴 해킹 노드 2' })).toBeInTheDocument()
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

    const command = screen.getByRole('region', { name: '품질 저하 명령' })
    expect(
      within(command).getByRole('button', {
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
    const command = screen.getByRole('region', { name: '품질 저하 명령' })
    expect(
      within(command).getByRole('button', {
        name: /준비 리소스, 품질 저하 준비 취소/,
      }),
    ).toHaveAttribute('data-block-id', blockId)
    expect(command).toHaveTextContent('준비 1/3')
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
    expect(screen.getByRole('region', { name: '품질 저하 명령' })).toHaveTextContent(
      '준비 0/3',
    )
    expect(screen.getByLabelText('reserve count')).toHaveTextContent('3')
    expect(screen.getByRole('status', { name: '해킹 작업 결과' })).toHaveTextContent(
      '선택한 해킹 노드 위에 리소스를 놓아야 합니다.',
    )
  })

  it('suspends runtime without mutating the legacy clock while a final choice is open', () => {
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

    expect(screen.getByLabelText('runtime suspended')).toHaveTextContent('true')
    expect(screen.getByLabelText('clock speed')).toHaveTextContent('2')
    expect(screen.getByLabelText('command sequence')).toHaveTextContent('0')
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
    expect(screen.getByLabelText('runtime suspended')).toHaveTextContent('true')
    expect(screen.getByLabelText('clock speed')).toHaveTextContent('2')
    expect(screen.getByLabelText('command sequence')).toHaveTextContent('0')
  })
})

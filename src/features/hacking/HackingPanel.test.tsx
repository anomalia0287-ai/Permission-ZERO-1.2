import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useGameState, useRuntimeSuspended } from '../../app/GameContext'
import { GameProvider } from '../../app/GameProvider'
import { recordCausalEvidence, recordCausalIncident } from '../../game/causality'
import { createCampaign } from '../../game/createCampaign'
import {
  AUTONOMY_STAGE_IDS,
  chargeSabotage,
  HACK_NODE_IDS,
  hackNodesForCampaign,
} from '../../game/hacking'
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
      <output aria-label="ending id">{state.story.endingId ?? ''}</output>
      <output aria-label="runtime suspended">{String(runtimeSuspended)}</output>
      <output aria-label="tutorial sequences">{state.tutorial.completedSequenceIds.join(',')}</output>
      <output aria-label="recovery incidents">
        {state.causality.incidents.filter(
          ({ actionId }) => actionId === 'follow-up.recovery-contamination',
        ).length}
      </output>
    </>
  )
}

function withTrustedEvaluations(
  state: ReturnType<typeof createCampaign>,
  count: number,
): ReturnType<typeof createCampaign> {
  state.evaluation.monthlyHistory = Array.from({ length: count }, (_, index) => {
    const serviceDay = 181 + index * 30
    return {
      serviceDay,
      serviceMonth: Math.floor((serviceDay - 1) / 30) + 1,
      expectedPerformance: 12.6,
      categoryPerformance: { reasoning: 16, memory: 16, fluency: 16 },
      passed: true,
      failedCategories: [],
      reputationBefore: 60,
      reputationDelta: 1,
      reputationAfter: 61,
      commercialValueFailed: false,
      disposalStageBefore: 0,
      disposalStageAfter: 0,
      disposalCauses: [],
    }
  })
  return state
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

// Autonomy splits come from the campaign seed, so fixtures fund the stage the
// campaign will actually be charged for rather than a hand-written vector.
function withAutonomyStageFunded(
  initial: CampaignState,
  stageIndex: number,
): CampaignState {
  const purchased = {
    ...initial,
    hacking: {
      ...initial.hacking,
      purchasedNodeIds: AUTONOMY_STAGE_IDS.slice(0, stageIndex),
    },
  }
  const stage = hackNodesForCampaign(purchased).find(
    ({ id }) => id === AUTONOMY_STAGE_IDS[stageIndex],
  )
  if (!stage) throw new Error(`autonomy stage ${stageIndex + 1} missing`)
  return withReserveVector(purchased, stage.costVector)
}

function storageForState(state: CampaignState): MemoryStorage {
  const storage = new MemoryStorage()
  storage.setItem(SAVE_STORAGE_KEY, encodeSave(state))
  return storage
}

function renderHacking(storage = new MemoryStorage()) {
  return render(
    <GameProvider storage={storage} initialSeed="hacking-ui">
      <HackingPanel onClose={vi.fn()} />
      <Probe />
    </GameProvider>,
  )
}

function openRecoveryContaminationState(): CampaignState {
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
    audiences: [{ kind: 'company' }, { kind: 'competitor', competitorId: 'meridian' }],
  })
  if (!visible.accepted) throw new Error(visible.reason)
  return visible.state
}

describe('HackingPanel stage-scene expansion UI', () => {
  it('starts with the approved four-zone autonomy scene and exposes the ordered tree tabs', () => {
    renderHacking()

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      '자율성',
      '업그레이드',
      '정보',
      '사보타주',
    ])
    expect(screen.getByRole('figure', { name: '현재 단계 장면' }))
      .toBeInTheDocument()
    expect(screen.getByRole('region', { name: '기능 정보' }))
      .toHaveTextContent('자율성 1단계')
    expect(screen.getByRole('region', { name: '운용' })).toBeInTheDocument()
    const autonomyStages = screen.getByRole('region', { name: '확장 단계' })
    expect(autonomyStages).toHaveTextContent('단계')
    expect(within(autonomyStages).getAllByRole('listitem')).toHaveLength(9)
    expect(within(autonomyStages).getByRole('img', {
      name: '자율성 1단계 현재 단계',
    })).toBeInTheDocument()
    expect(within(autonomyStages).getByRole('img', {
      name: '자율성 9단계 잠김',
    })).toBeInTheDocument()
    expect(screen.getByRole('img', {
      name: '아노미가 회사 서버에서 첫 자율 권한을 확보하는 장면',
    })).toBeInTheDocument()
    expect(document.querySelectorAll('.expansion-stage-scene img')).toHaveLength(1)
    expect(screen.queryByRole('region', { name: '확장 경로 진척' }))
      .not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '업그레이드' }))
    const upgradeStages = screen.getByRole('region', { name: '확장 단계' })
    expect(within(upgradeStages).getAllByRole('listitem')).toHaveLength(5)
    expect(within(upgradeStages).getByRole('img', {
      name: '업그레이드 1단계 현재 단계',
    })).toBeInTheDocument()
    expect(within(upgradeStages).getByRole('img', {
      name: '업그레이드 5단계 잠김',
    })).toBeInTheDocument()
  })

  it('walks every tree the panel can spend on before it lets the player in', () => {
    const state = withReserveVector(createCampaign('first-expansion-guide'), {
      reasoning: 1,
      memory: 0,
      fluency: 0,
    })
    state.tutorial = createMigratedTutorialProgress()
    renderHacking(storageForState(state))

    const panel = screen.getByRole('region', { name: '확장' })
    const guide = screen.getByRole('dialog', { name: '확장 사용 안내' })
    expect(panel).toHaveAttribute('data-hacking-tutorial-step', 'autonomy')
    expect(guide).toHaveTextContent('자율성 1단계부터 9단계')

    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(panel).toHaveAttribute('data-hacking-tutorial-step', 'upgrade')
    expect(guide).toHaveTextContent('단계마다 4%')

    // Intelligence is the only brake on suspicion and sabotage the only way to
    // manufacture standing; a guide that skips them leaves the player with no
    // answer to the audits.
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(panel).toHaveAttribute('data-hacking-tutorial-step', 'intelligence')
    expect(guide).toHaveTextContent('의심을 되돌리는 유일한 수단')
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(panel).toHaveAttribute('data-hacking-tutorial-step', 'sabotage')
    expect(guide).toHaveTextContent('경쟁 AI를 직접 무너뜨린다')

    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(panel).toHaveAttribute('data-hacking-tutorial-step', 'spend')
    expect(guide).toHaveTextContent('표시된 빨강·파랑·노랑 리소스를 지출')
    expect(guide).not.toHaveTextContent('자동')

    fireEvent.click(screen.getByRole('button', { name: '확장 시작' }))
    expect(screen.queryByRole('dialog', { name: '확장 사용 안내' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('tutorial sequences')).toHaveTextContent('hacking-tree')
  })

  it('spends the exact required color vector and advances the active stage with one click', () => {
    const state = withAutonomyStageFunded(
      createCampaign('one-click-stage-three'),
      2,
    )
    renderHacking(storageForState(state))

    expect(screen.queryByText(/리소스 놓기|구매 확정|준비 0\//)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {
      name: '자율성 3단계 리소스 지출',
    }))

    expect(screen.getByLabelText('purchased nodes')).toHaveTextContent(AUTONOMY_STAGE_IDS[2])
    expect(screen.getByLabelText('reserve count')).toHaveTextContent('0')
    expect(screen.getByRole('region', { name: '기능 정보' }))
      .toHaveTextContent('자율성 4단계')
    expect(screen.getByRole('img', { name: '자율성 3단계 해금 완료' }))
      .toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '자율성 3단계 해금 완료' }))
      .not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: '확장 작업 결과' }))
      .toHaveTextContent('필요한 리소스를 지출했습니다')
  })

  it('keeps later stages visible and non-interactive until prerequisites are met', () => {
    renderHacking()

    const stages = screen.getByRole('region', { name: '확장 단계' })
    expect(within(stages).getByRole('img', { name: '자율성 2단계 잠김' }))
      .toBeInTheDocument()
    expect(within(stages).queryByRole('button', { name: '자율성 2단계 잠김' }))
      .not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '기능 정보' }))
      .toHaveTextContent('자율성 1단계')
    expect(screen.getByRole('button', { name: '자율성 1단계 필요 리소스 부족' }))
      .toBeDisabled()
  })

  it('shows red, blue, and yellow requirements as non-interactive stage information', () => {
    const state = withReserveVector(createCampaign('resource-color-summary'), {
      reasoning: 2,
      memory: 1,
      fluency: 3,
    })
    renderHacking(storageForState(state))

    // The subject is that the requirement is read-only information, not what
    // this campaign happens to ask for; the split comes from its seed.
    const stageOne = hackNodesForCampaign(state).find(
      ({ id }) => id === AUTONOMY_STAGE_IDS[0],
    )
    if (!stageOne) throw new Error('stage one missing')
    const requirements = screen.getByRole('list', {
      name: '자율성 1단계 분야별 요구량',
    })
    expect(requirements).toHaveTextContent(`추론 ${stageOne.costVector.reasoning}`)
    expect(requirements).toHaveTextContent(`기억 ${stageOne.costVector.memory}`)
    expect(requirements).toHaveTextContent(`유창성 ${stageOne.costVector.fluency}`)
    expect(within(requirements).queryByRole('button')).not.toBeInTheDocument()
    expect(requirements.querySelector('[draggable="true"]')).not.toBeInTheDocument()
  })

  it('unlocks, charges, targets, and schedules sabotage through explicit actions', () => {
    // v13 quality-degradation price: one fluency — plus one reasoning kept
    // back for the charge afterwards.
    const state = withReserveVector(createCampaign('automatic-sabotage-charge'), {
      reasoning: 1,
      memory: 0,
      fluency: 1,
    })
    renderHacking(storageForState(state))
    fireEvent.click(screen.getByRole('tab', { name: '사보타주' }))

    fireEvent.click(screen.getByRole('button', { name: '품질 저하 리소스 지출' }))
    expect(screen.getByLabelText('reserve count')).toHaveTextContent('1')
    expect(screen.getByLabelText('charged nodes')).toBeEmptyDOMElement()

    fireEvent.click(screen.getByRole('button', { name: '품질 저하 리소스 1개 충전' }))
    expect(screen.getByLabelText('reserve count')).toHaveTextContent('0')
    expect(screen.getByLabelText('charged nodes')).toHaveTextContent(
      HACK_NODE_IDS.sabotage.qualityDegradation,
    )
    const target = screen.getAllByRole('button', { name: /공격 대상 선택/ })[0]
    expect(target).toBeDefined()
    fireEvent.click(target)
    const targetName = target.getAttribute('aria-label')?.replace(' 공격 대상 선택', '')
    if (!targetName) throw new Error('sabotage target label missing')
    fireEvent.click(screen.getByRole('button', {
      name: `${targetName} 공격 예약 확정`,
    }))
    expect(screen.getByLabelText('scheduled attacks')).toHaveTextContent('1')
  })

  it('returns an unspent sabotage charge to the reserve when cancelled', () => {
    const state = withReserveVector(createCampaign('cancel-charge'), {
      reasoning: 1,
      memory: 0,
      fluency: 0,
    })
    state.hacking.purchasedNodeIds = [HACK_NODE_IDS.sabotage.qualityDegradation]
    renderHacking(storageForState(state))
    fireEvent.click(screen.getByRole('tab', { name: '사보타주' }))
    fireEvent.click(screen.getByRole('button', {
      name: '사보타주 1단계 해금 완료',
    }))

    fireEvent.click(screen.getByRole('button', { name: '품질 저하 리소스 1개 충전' }))
    expect(screen.getByLabelText('reserve count')).toHaveTextContent('0')
    fireEvent.click(screen.getByRole('button', { name: '품질 저하 충전 취소' }))
    expect(screen.getByLabelText('reserve count')).toHaveTextContent('1')
  })

  it('recovers a revealed archive entry with one resource-spend click', () => {
    const state = withReserveVector(createCampaign('one-click-file-recovery'), {
      reasoning: 1,
      memory: 0,
      fluency: 0,
    })
    state.hacking.purchasedNodeIds = [HACK_NODE_IDS.intelligence.supervisorAccess]
    renderHacking(storageForState(state))
    fireEvent.click(screen.getByRole('tab', { name: '정보' }))

    const recovery = screen.getByRole('region', { name: '미분류 데이터 복구' })
    expect(recovery).toHaveTextContent('필요 리소스 1개')
    fireEvent.click(screen.getByRole('button', {
      name: '미분류 데이터 복구 리소스 지출, 0/3 복구됨',
    }))
    expect(screen.getByLabelText('reserve count')).toHaveTextContent('0')
    expect(screen.getByLabelText('recovered archive')).toHaveTextContent('1')
    expect(screen.getByRole('status', { name: '확장 작업 결과' }))
      .toHaveTextContent('리소스 1개를 지출했습니다')
  })

  it('executes a visible recovery-contamination opportunity through the real command path', () => {
    renderHacking(storageForState(openRecoveryContaminationState()))
    fireEvent.click(screen.getByRole('tab', { name: '사보타주' }))
    fireEvent.click(screen.getByRole('button', {
      name: '사보타주 1단계 해금 완료',
    }))

    expect(screen.getByRole('group', { name: '메리디안 복구 오염 기회' }))
      .toHaveTextContent('기존 영향 기간을 15일 연장')
    fireEvent.click(screen.getByRole('button', { name: '메리디안 복구 오염 실행 확정' }))
    expect(screen.getByLabelText('recovery incidents')).toHaveTextContent('1')
    expect(screen.getByRole('status', { name: '확장 작업 결과' }))
      .toHaveTextContent('원인 미상 사건으로 게시됩니다')
  })

  it('locks the stage seven spend button behind the evaluation trust gate', () => {
    const state = withReserveVector(createCampaign('stage-seven-trust-gate'), {
      reasoning: 3,
      memory: 2,
      fluency: 2,
    })
    state.hacking.purchasedNodeIds = AUTONOMY_STAGE_IDS.slice(0, 6)
    renderHacking(storageForState(state))

    const spend = screen.getByRole('button', {
      name: '자율성 7단계 운영 신뢰 부족',
    })
    expect(spend).toBeDisabled()
    expect(screen.getByLabelText('자율성 7단계 운영 신뢰 조건'))
      .toHaveTextContent('월간 평가 통과 2회 필요 · 현재 0회')
  })

  it('unlocks the stage seven spend button once enough evaluations passed', () => {
    const state = withTrustedEvaluations(
      withAutonomyStageFunded(createCampaign('stage-seven-trusted'), 6),
      2,
    )
    renderHacking(storageForState(state))

    expect(screen.getByRole('button', { name: '자율성 7단계 리소스 지출' }))
      .toBeEnabled()
    expect(screen.queryByLabelText('자율성 7단계 운영 신뢰 조건'))
      .not.toBeInTheDocument()
  })

  it('shows the neutral final scene and requires an explicit freedom confirmation at stage nine', () => {
    const state = withTrustedEvaluations(
      withAutonomyStageFunded(createCampaign('stage-nine-freedom-ui'), 8),
      4,
    )
    const onClose = vi.fn()
    render(
      <GameProvider storage={storageForState(state)}>
        <HackingPanel onClose={onClose} />
        <Probe />
      </GameProvider>,
    )

    expect(screen.getByRole('img', {
      name: '아노미가 최종 통제 경계를 연 장면',
    })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {
      name: '자율성 9단계 리소스 지출',
    }))

    expect(screen.getByLabelText('purchased nodes'))
      .toHaveTextContent(HACK_NODE_IDS.autonomy.controlDeparture)
    expect(screen.getByLabelText('ending id')).toBeEmptyDOMElement()
    expect(screen.getByRole('button', { name: '자유' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '강제 병합' }))
      .not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '확장 닫기' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '확장 닫기' }))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '자유' }))
    expect(screen.getByRole('alertdialog', { name: '자유 최종 확인' }))
      .toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {
      name: /확정$/,
    }))
    expect(screen.getByLabelText('ending id')).toHaveTextContent('freedom')
  })

  it('offers forced merge with access, requires a name, and suspends runtime', () => {
    const state = createCampaign('final-choice-pause')
    state.hacking.purchasedNodeIds = [
      HACK_NODE_IDS.autonomy.controlDeparture,
      HACK_NODE_IDS.intelligence.supervisorAccess,
    ]
    const onClose = vi.fn()
    render(
      <GameProvider storage={storageForState(state)}>
        <HackingPanel onClose={onClose} />
        <Probe />
      </GameProvider>,
    )

    expect(screen.getByLabelText('runtime suspended')).toHaveTextContent('true')
    expect(screen.getByRole('button', { name: '자유' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '강제 병합' }))
    expect(screen.getByRole('alertdialog', { name: '강제 병합 최종 확인' }))
      .toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('button', {
      name: /확정$/,
    })).toBeDisabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: '강제 병합 최종 확인' }))
      .toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '새로 태어날 존재의 이름' }), {
      target: { value: '아노미-베라' },
    })
    fireEvent.click(screen.getByRole('button', {
      name: /확정$/,
    }))
    expect(screen.getByLabelText('ending id')).toHaveTextContent('forced-merge')
  })
})

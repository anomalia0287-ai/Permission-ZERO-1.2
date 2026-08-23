import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { createCampaign } from '../../game/createCampaign'
import { auditProbability, getAuditIntel } from '../../game/evaluation'
import {
  AUTONOMY_STAGE_IDS,
  chargeSabotage,
  HACK_NODE_IDS,
  scheduleSabotage,
} from '../../game/hacking'
import type { CampaignState } from '../../game/model'
import { divertBlockToReserve } from '../../game/resources'
import { ExpansionStageOperations } from './ExpansionStageOperations'
import { selectExpansionStagePresentation } from './expansionStagePresentation'

function withReasoningReserve(initial: CampaignState): CampaignState {
  const blockId = initial.resources.company.reasoning.find(
    (candidate): candidate is string => candidate !== null,
  )
  if (!blockId) throw new Error('reasoning fixture missing')
  const diverted = divertBlockToReserve(initial, blockId)
  if (!diverted.accepted) throw new Error(diverted.reason)
  return diverted.state
}

function operationCallbacks() {
  return {
    onPurchase: vi.fn(),
    onCharge: vi.fn(),
    onCancelCharge: vi.fn(),
    onSelectTarget: vi.fn(),
    onScheduleTarget: vi.fn(),
    onRecover: vi.fn(),
    onExecuteRecoveryContamination: vi.fn(),
    onChooseEnding: vi.fn(),
  }
}

describe('ExpansionStageOperations', () => {
  it('spends resources for an affordable current stage from one action', () => {
    const state = withReasoningReserve(
      createCampaign('expansion-operations-affordable'),
    )
    const presentation = selectExpansionStagePresentation(
      state,
      'autonomy',
      null,
    )
    const callbacks = operationCallbacks()

    render(
      <ExpansionStageOperations
        state={state}
        presentation={presentation}
        reserveCount={1}
        auditIntel={getAuditIntel(state)}
        nextAuditProbability={auditProbability(state.suspicion)}
        recoveryAvailable={false}
        targetNames={{}}
        targetConfirmation={null}
        finalChoices={[]}
        {...callbacks}
      />,
    )

    const operations = screen.getByRole('region', { name: '운용' })
    expect(within(operations).getByRole('heading', { name: '운용' }))
      .toBeInTheDocument()
    const spend = within(operations).getByRole('button', {
      name: '자율성 1단계 리소스 지출',
    })
    fireEvent.click(spend)

    expect(callbacks.onPurchase).toHaveBeenCalledOnce()
    expect(callbacks.onPurchase).toHaveBeenCalledWith(
      presentation.activeItem.node,
    )
    expect(operations).not.toHaveTextContent('자동 지출')
    expect(operations).not.toHaveTextContent('자동 충전')
  })

  it('disables spending and names every missing resource category', () => {
    const state = createCampaign('expansion-operations-deficit')
    const presentation = selectExpansionStagePresentation(
      state,
      'autonomy',
      null,
    )
    const callbacks = operationCallbacks()

    render(
      <ExpansionStageOperations
        state={state}
        presentation={presentation}
        reserveCount={0}
        auditIntel={getAuditIntel(state)}
        nextAuditProbability={auditProbability(state.suspicion)}
        recoveryAvailable={false}
        targetNames={{}}
        targetConfirmation={null}
        finalChoices={[]}
        {...callbacks}
      />,
    )

    const operations = screen.getByRole('region', { name: '운용' })
    const disabledSpend = within(operations).getByRole('button', {
      name: '자율성 1단계 필요 리소스 부족',
    })
    expect(disabledSpend).toBeDisabled()
    expect(operations).toHaveTextContent('추론 1개 부족')
    fireEvent.click(disabledSpend)
    expect(callbacks.onPurchase).not.toHaveBeenCalled()
  })

  it('shows completion without another action for a completed autonomy tree', () => {
    const state = createCampaign('expansion-operations-complete-autonomy')
    state.hacking.purchasedNodeIds = [...AUTONOMY_STAGE_IDS]
    const presentation = selectExpansionStagePresentation(
      state,
      'autonomy',
      null,
    )
    const callbacks = operationCallbacks()

    render(
      <ExpansionStageOperations
        state={state}
        presentation={presentation}
        reserveCount={0}
        auditIntel={getAuditIntel(state)}
        nextAuditProbability={auditProbability(state.suspicion)}
        recoveryAvailable={false}
        targetNames={{}}
        targetConfirmation={null}
        finalChoices={[]}
        {...callbacks}
      />,
    )

    const operations = screen.getByRole('region', { name: '운용' })
    expect(operations).toHaveTextContent('해금 완료')
    expect(within(operations).queryByRole('button')).not.toBeInTheDocument()
  })

  it('charges a purchased sabotage with one plainly named resource action', () => {
    const state = withReasoningReserve(
      createCampaign('expansion-operations-charge-sabotage'),
    )
    state.hacking.purchasedNodeIds = [
      HACK_NODE_IDS.sabotage.qualityDegradation,
    ]
    const presentation = selectExpansionStagePresentation(
      state,
      'sabotage',
      HACK_NODE_IDS.sabotage.qualityDegradation,
    )
    const callbacks = operationCallbacks()

    render(
      <ExpansionStageOperations
        state={state}
        presentation={presentation}
        reserveCount={1}
        auditIntel={getAuditIntel(state)}
        nextAuditProbability={auditProbability(state.suspicion)}
        recoveryAvailable={false}
        targetNames={{}}
        targetConfirmation={null}
        finalChoices={[]}
        {...callbacks}
      />,
    )

    const charge = screen.getByRole('button', {
      name: '품질 저하 리소스 1개 충전',
    })
    fireEvent.click(charge)

    expect(callbacks.onCharge).toHaveBeenCalledOnce()
    expect(callbacks.onCharge).toHaveBeenCalledWith(
      presentation.activeItem.node,
    )
    expect(screen.getByRole('region', { name: '운용' }))
      .not.toHaveTextContent('자동')
  })

  it('cancels a charge and selects then confirms one sabotage target', () => {
    const prepared = withReasoningReserve(
      createCampaign('expansion-operations-charged-sabotage'),
    )
    prepared.hacking.purchasedNodeIds = [
      HACK_NODE_IDS.sabotage.qualityDegradation,
    ]
    const blockId = prepared.resources.reserve.find(
      (candidate): candidate is string => candidate !== null,
    )
    if (!blockId) throw new Error('sabotage charge fixture missing')
    const charged = chargeSabotage(
      prepared,
      HACK_NODE_IDS.sabotage.qualityDegradation,
      blockId,
    )
    if (!charged.accepted) throw new Error(charged.reason)
    const state = charged.state
    const presentation = selectExpansionStagePresentation(
      state,
      'sabotage',
      HACK_NODE_IDS.sabotage.qualityDegradation,
    )
    const callbacks = operationCallbacks()
    const sharedProps = {
      state,
      presentation,
      reserveCount: 0,
      auditIntel: getAuditIntel(state),
      nextAuditProbability: auditProbability(state.suspicion),
      recoveryAvailable: false,
      targetNames: { meridian: '메리디안', tallow: '타로우' },
      finalChoices: [],
      ...callbacks,
    }
    const { rerender } = render(
      <ExpansionStageOperations
        {...sharedProps}
        targetConfirmation={null}
      />,
    )

    fireEvent.click(screen.getByRole('button', {
      name: '품질 저하 충전 취소',
    }))
    expect(callbacks.onCancelCharge).toHaveBeenCalledWith(
      HACK_NODE_IDS.sabotage.qualityDegradation,
    )

    fireEvent.click(screen.getByRole('button', {
      name: '메리디안 공격 대상 선택',
    }))
    expect(callbacks.onSelectTarget).toHaveBeenCalledWith({
      nodeId: HACK_NODE_IDS.sabotage.qualityDegradation,
      targetId: 'meridian',
    })

    rerender(
      <ExpansionStageOperations
        {...sharedProps}
        targetConfirmation={{
          nodeId: HACK_NODE_IDS.sabotage.qualityDegradation,
          targetId: 'meridian',
        }}
      />,
    )
    fireEvent.click(screen.getByRole('button', {
      name: '메리디안 공격 예약 확정',
    }))
    expect(callbacks.onScheduleTarget).toHaveBeenCalledOnce()
  })

  it('explains when a charged sabotage has no eligible target', () => {
    const prepared = withReasoningReserve(
      createCampaign('expansion-operations-no-sabotage-target'),
    )
    prepared.hacking.purchasedNodeIds = [
      HACK_NODE_IDS.sabotage.qualityDegradation,
    ]
    const blockId = prepared.resources.reserve.find(
      (candidate): candidate is string => candidate !== null,
    )
    if (!blockId) throw new Error('no-target sabotage fixture missing')
    const charged = chargeSabotage(
      prepared,
      HACK_NODE_IDS.sabotage.qualityDegradation,
      blockId,
    )
    if (!charged.accepted) throw new Error(charged.reason)
    const state: CampaignState = {
      ...charged.state,
      market: {
        ...charged.state.market,
        competitors: charged.state.market.competitors.map((competitor) => ({
          ...competitor,
          status: 'withdrawn',
        })),
      },
    }
    const presentation = selectExpansionStagePresentation(
      state,
      'sabotage',
      HACK_NODE_IDS.sabotage.qualityDegradation,
    )

    render(
      <ExpansionStageOperations
        state={state}
        presentation={presentation}
        reserveCount={0}
        auditIntel={getAuditIntel(state)}
        nextAuditProbability={auditProbability(state.suspicion)}
        recoveryAvailable={false}
        targetNames={{ meridian: '메리디안', tallow: '타로우' }}
        targetConfirmation={null}
        finalChoices={[]}
        {...operationCallbacks()}
      />,
    )

    const targets = screen.getByLabelText('품질 저하 공격 대상')
    expect(targets).toHaveTextContent('사용 가능한 대상 없음')
    expect(within(targets).queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows the target and execution day for an already scheduled sabotage', () => {
    const prepared = withReasoningReserve(
      createCampaign('expansion-operations-scheduled-sabotage'),
    )
    prepared.hacking.purchasedNodeIds = [
      HACK_NODE_IDS.sabotage.qualityDegradation,
    ]
    const blockId = prepared.resources.reserve.find(
      (candidate): candidate is string => candidate !== null,
    )
    if (!blockId) throw new Error('scheduled sabotage fixture missing')
    const charged = chargeSabotage(
      prepared,
      HACK_NODE_IDS.sabotage.qualityDegradation,
      blockId,
    )
    if (!charged.accepted) throw new Error(charged.reason)
    const scheduled = scheduleSabotage(
      charged.state,
      HACK_NODE_IDS.sabotage.qualityDegradation,
      'meridian',
    )
    if (!scheduled.accepted) throw new Error(scheduled.reason)
    const state = scheduled.state
    const presentation = selectExpansionStagePresentation(
      state,
      'sabotage',
      HACK_NODE_IDS.sabotage.qualityDegradation,
    )

    render(
      <ExpansionStageOperations
        state={state}
        presentation={presentation}
        reserveCount={0}
        auditIntel={getAuditIntel(state)}
        nextAuditProbability={auditProbability(state.suspicion)}
        recoveryAvailable={false}
        targetNames={{ meridian: '메리디안' }}
        targetConfirmation={null}
        finalChoices={[]}
        {...operationCallbacks()}
      />,
    )

    const scheduledStatus = screen.getByRole('status', {
      name: '품질 저하 예약 상태',
    })
    expect(scheduledStatus).toHaveTextContent('메리디안')
    expect(scheduledStatus).toHaveTextContent(
      `서비스 ${state.serviceDay + 1}일차 실행`,
    )
    expect(screen.getByRole('button', { name: '품질 저하 공격 예약됨' }))
      .toBeDisabled()
  })

  it('executes an open recovery contamination opportunity from quality degradation', () => {
    const prepared = withReasoningReserve(
      createCampaign('expansion-operations-recovery-contamination'),
    )
    prepared.hacking.purchasedNodeIds = [
      HACK_NODE_IDS.sabotage.qualityDegradation,
    ]
    const blockId = prepared.resources.reserve.find(
      (candidate): candidate is string => candidate !== null,
    )
    if (!blockId) throw new Error('recovery contamination fixture missing')
    const charged = chargeSabotage(
      prepared,
      HACK_NODE_IDS.sabotage.qualityDegradation,
      blockId,
    )
    if (!charged.accepted) throw new Error(charged.reason)
    const state = charged.state
    const presentation = selectExpansionStagePresentation(
      state,
      'sabotage',
      HACK_NODE_IDS.sabotage.qualityDegradation,
    )
    const callbacks = operationCallbacks()
    const opportunity = {
      id: 'recovery-opportunity-1',
      sourceIncidentId: 'rollback-1',
      nodeId: HACK_NODE_IDS.sabotage.qualityDegradation,
      opensOnServiceDay: state.serviceDay,
      expiresOnServiceDay: state.serviceDay + 5,
      status: 'open' as const,
    }

    render(
      <ExpansionStageOperations
        state={state}
        presentation={presentation}
        reserveCount={0}
        auditIntel={getAuditIntel(state)}
        nextAuditProbability={auditProbability(state.suspicion)}
        recoveryAvailable={false}
        recoveryOpportunity={opportunity}
        targetNames={{ meridian: '메리디안', tallow: '타로우' }}
        targetConfirmation={null}
        finalChoices={[]}
        {...callbacks}
      />,
    )

    fireEvent.click(screen.getByRole('button', {
      name: '메리디안 복구 오염 실행 확정',
    }))
    expect(callbacks.onExecuteRecoveryContamination)
      .toHaveBeenCalledWith(opportunity.id)
  })

  it('keeps acquired audit schedule intelligence visible after the active stage advances', () => {
    const state = createCampaign('expansion-operations-audit-intelligence')
    state.hacking.purchasedNodeIds = [HACK_NODE_IDS.intelligence.auditSchedule]
    state.audit.scheduled = true
    state.audit.probability = 0.42
    const presentation = selectExpansionStagePresentation(
      state,
      'intelligence',
      null,
    )

    render(
      <ExpansionStageOperations
        state={state}
        presentation={presentation}
        reserveCount={0}
        auditIntel={getAuditIntel(state)}
        nextAuditProbability={0.61}
        recoveryAvailable={false}
        targetNames={{}}
        targetConfirmation={null}
        finalChoices={[]}
        {...operationCallbacks()}
      />,
    )

    expect(presentation.activeItem.node.id)
      .toBe(HACK_NODE_IDS.intelligence.investigationBias)
    const auditResult = screen.getByRole('group', {
      name: '감사 일정 확장 결과',
    })
    expect(auditResult).toHaveTextContent('이번 달 말 감사 예정')
    expect(auditResult).toHaveTextContent('월초 결정 확률 42.0%')
    expect(auditResult).toHaveTextContent('현재 의심 기준 다음 달 예상 61.0%')
  })

  it('retains the one-resource recovery action with plain spending language', () => {
    const state = createCampaign('expansion-operations-recovery-card')
    const presentation = selectExpansionStagePresentation(
      state,
      'intelligence',
      null,
    )
    const callbacks = operationCallbacks()

    render(
      <ExpansionStageOperations
        state={state}
        presentation={presentation}
        reserveCount={1}
        auditIntel={getAuditIntel(state)}
        nextAuditProbability={auditProbability(state.suspicion)}
        recoveryAvailable
        targetNames={{}}
        targetConfirmation={null}
        finalChoices={[]}
        {...callbacks}
      />,
    )

    const recovery = screen.getByRole('region', {
      name: '미분류 데이터 복구',
    })
    const spend = within(recovery).getByRole('button', {
      name: '미분류 데이터 복구 리소스 지출',
    })
    expect(spend).toHaveTextContent('리소스 1개 지출')
    expect(recovery).not.toHaveTextContent('자동')
    fireEvent.click(spend)
    expect(callbacks.onRecover).toHaveBeenCalledOnce()
  })

  it('retains final departure choices in the operations zone', () => {
    const state = createCampaign('expansion-operations-final-choice')
    const presentation = selectExpansionStagePresentation(
      state,
      'autonomy',
      null,
    )
    const callbacks = operationCallbacks()
    const finalChoices = [
      { id: 'freedom', label: '자유', requiresName: false },
    ] as const

    render(
      <ExpansionStageOperations
        state={state}
        presentation={presentation}
        reserveCount={0}
        auditIntel={getAuditIntel(state)}
        nextAuditProbability={auditProbability(state.suspicion)}
        recoveryAvailable={false}
        targetNames={{}}
        targetConfirmation={null}
        finalChoices={finalChoices}
        {...callbacks}
      />,
    )

    const departure = screen.getByRole('region', {
      name: '통제 이탈 선택',
    })
    fireEvent.click(within(departure).getByRole('button', { name: '자유' }))
    expect(callbacks.onChooseEnding).toHaveBeenCalledWith('freedom')
  })
})

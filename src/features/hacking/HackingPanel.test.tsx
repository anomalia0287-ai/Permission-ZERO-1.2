import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useGameState } from '../../app/GameContext'
import { GameProvider } from '../../app/GameProvider'
import { createCampaign } from '../../game/createCampaign'
import { HACK_NODE_IDS } from '../../game/hacking'
import { saveCampaign } from '../../game/persistence'
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
    </>
  )
}

function renderHacking(storage = new MemoryStorage()) {
  return render(
    <GameProvider storage={storage} initialSeed="hacking-ui">
      <HackingPanel onClose={vi.fn()} />
      <Probe />
    </GameProvider>,
  )
}

describe('HackingPanel', () => {
  it('hides cumulative evidence and shows immutable qualitative risk per sabotage node', () => {
    const lowEvidence = createCampaign('qualitative-risk-low')
    lowEvidence.hacking.hiddenEvidence = 0
    const lowStorage = new MemoryStorage()
    saveCampaign(lowStorage, lowEvidence)
    const low = renderHacking(lowStorage)
    const lowRiskText = screen
      .getAllByText(/흔적 (적음|중간|많음)/)
      .map((node) => node.textContent)
    expect(screen.queryByText(/은닉 증거/)).not.toBeInTheDocument()
    low.unmount()

    const highEvidence = createCampaign('qualitative-risk-high')
    highEvidence.hacking.hiddenEvidence = 97
    const highStorage = new MemoryStorage()
    saveCampaign(highStorage, highEvidence)
    renderHacking(highStorage)

    expect(screen.queryByText(/은닉 증거/)).not.toBeInTheDocument()
    expect(screen.queryByText('97')).not.toBeInTheDocument()
    expect(
      screen.getAllByText(/흔적 (적음|중간|많음)/).map((node) => node.textContent),
    ).toEqual(lowRiskText)
    expect(screen.getAllByText('흔적 적음')).toHaveLength(2)
    expect(screen.getByText('흔적 중간')).toBeInTheDocument()
    expect(screen.getByText('흔적 많음')).toBeInTheDocument()
  })

  it('keeps all three trees and the reserve visible while purchasing a node', () => {
    renderHacking()

    expect(screen.getByRole('tab', { name: '사보타주' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '정보' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '자율성' })).toBeInTheDocument()
    expect(screen.getByRole('grid', { name: '해킹용 확보 리소스' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '정보' }))
    expect(screen.getByRole('button', { name: '조사 편향 구매 준비' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '감사 일정 구매 준비' }))
    const resources = screen.getAllByRole('button', { name: /구매 리소스 .* 선택/ })
    resources.slice(0, 3).forEach((resource) => fireEvent.click(resource))
    fireEvent.click(screen.getByRole('button', { name: '감사 일정 구매 확정' }))

    expect(screen.getByLabelText('purchased nodes')).toHaveTextContent(
      HACK_NODE_IDS.intelligence.auditSchedule,
    )
    expect(screen.getByLabelText('reserve count')).toHaveTextContent('0')
  })

  it('charges a purchased sabotage with one resource, confirms a target, and schedules it', () => {
    const state = createCampaign('charged-sabotage')
    state.hacking.purchasedNodeIds = [HACK_NODE_IDS.sabotage.qualityDegradation]
    const storage = new MemoryStorage()
    saveCampaign(storage, state)
    renderHacking(storage)

    fireEvent.click(screen.getByRole('button', { name: '품질 저하 충전 준비' }))
    fireEvent.click(screen.getAllByRole('button', { name: /충전 리소스 .* 선택/ })[0])
    fireEvent.click(screen.getByRole('button', { name: '품질 저하 충전 확정' }))
    expect(screen.getByLabelText('charged nodes')).toHaveTextContent(
      HACK_NODE_IDS.sabotage.qualityDegradation,
    )

    fireEvent.click(screen.getByRole('button', { name: 'MERIDIAN 공격 대상 선택' }))
    fireEvent.click(screen.getByRole('button', { name: 'MERIDIAN 공격 예약 확정' }))
    expect(screen.getByLabelText('scheduled attacks')).toHaveTextContent('1')
  })

  it('can cancel an unspent sabotage charge and returns the resource', () => {
    const state = createCampaign('cancel-charge')
    state.hacking.purchasedNodeIds = [HACK_NODE_IDS.sabotage.qualityDegradation]
    const storage = new MemoryStorage()
    saveCampaign(storage, state)
    renderHacking(storage)

    fireEvent.click(screen.getByRole('button', { name: '품질 저하 충전 준비' }))
    fireEvent.click(screen.getAllByRole('button', { name: /충전 리소스 .* 선택/ })[0])
    fireEvent.click(screen.getByRole('button', { name: '품질 저하 충전 확정' }))
    expect(screen.getByLabelText('reserve count')).toHaveTextContent('2')
    fireEvent.click(screen.getByRole('button', { name: '품질 저하 충전 취소' }))
    expect(screen.getByLabelText('reserve count')).toHaveTextContent('3')
    expect(screen.getByLabelText('charged nodes')).toBeEmptyDOMElement()
  })

  it('reveals a waste-looking one-resource recovery only after supervisor access', () => {
    const locked = renderHacking()
    fireEvent.click(screen.getByRole('tab', { name: '정보' }))
    expect(
      screen.queryByRole('region', { name: '미분류 데이터 복구' }),
    ).not.toBeInTheDocument()
    locked.unmount()

    const state = createCampaign('file-recovery-ui')
    state.hacking.purchasedNodeIds = [
      HACK_NODE_IDS.intelligence.supervisorAccess,
    ]
    const storage = new MemoryStorage()
    saveCampaign(storage, state)
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
      screen.getAllByRole('button', { name: /복구 리소스 .* 선택/ })[0],
    )
    fireEvent.click(
      screen.getByRole('button', { name: '미분류 데이터 복구 확정' }),
    )

    expect(screen.getByLabelText('reserve count')).toHaveTextContent('2')
    expect(screen.getByLabelText('recovered archive')).toHaveTextContent('1')
  })
})

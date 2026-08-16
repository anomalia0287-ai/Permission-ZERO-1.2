import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useGameState } from '../../app/GameContext'
import { GameProvider } from '../../app/GameProvider'
import { createCampaign } from '../../game/createCampaign'
import { syncHackingIntelligenceOpportunities } from '../../game/hackingIntelligence'
import {
  publishHackingIncident,
  recordHackingIncidentTruth,
} from '../../game/hackingPublicWorld'
import { encodeSave, SAVE_STORAGE_KEY } from '../../game/persistence'
import { MemoryStorage } from '../../test/fixtures'
import { HackingPanel } from './HackingPanel'

function Probe() {
  const state = useGameState()
  const latestRun = state.hackingCore.sabotage.runs.at(-1)
  const lightweight = state.hackingCore.autonomy.routes['lightweight-departure']
  return (
    <>
      <output aria-label="successor sabotage runs">{state.hackingCore.sabotage.runs.length}</output>
      <output aria-label="latest successor operation">{latestRun?.operationId ?? ''}</output>
      <output aria-label="latest successor blocks">{latestRun?.investedBlockIds.join(',') ?? ''}</output>
      <output aria-label="lightweight runtime">{lightweight.slots.find(({ id }) => id === 'runtime')?.blockId ?? ''}</output>
      <output aria-label="reserve count">{state.resources.reserve.filter(Boolean).length}</output>
      <output aria-label="public answers">{state.hackingCore.intelligence.answers.filter(({ itemId }) => itemId === 'public-facts').length}</output>
    </>
  )
}

function renderHacking(state = createCampaign('hacking-operation-ui')) {
  const storage = new MemoryStorage()
  storage.setItem(SAVE_STORAGE_KEY, encodeSave(state))
  const onClose = vi.fn()
  const rendered = render(
    <GameProvider storage={storage} initialSeed="unused">
      <HackingPanel onClose={onClose} />
      <Probe />
    </GameProvider>,
  )
  return { ...rendered, onClose, storage }
}

describe('HackingPanel successor operation workspace', () => {
  it('opens on the one currently usable operation without exposing the old node ladder', () => {
    renderHacking()

    expect(screen.getByRole('region', { name: '해킹 작전 운영석' })).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option', { name: /품질 저하/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('region', { name: '품질 저하 상세' })).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/PURCHASE|구매 준비|경로 진척|선행 노드|RES/)
  })

  it('selects a real compute token and starts quality degradation through protocol v3', async () => {
    renderHacking()

    fireEvent.click(screen.getByRole('button', { name: '빼돌린 연산 열기' }))
    fireEvent.click(screen.getByRole('button', { name: '자유 연산 1 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '빼돌린 연산 닫기' }))
    fireEvent.click(screen.getByRole('button', { name: '도구 호출군 B에 어댑터 패치 결속' }))

    await waitFor(() => {
      expect(screen.getByLabelText('successor sabotage runs')).toHaveTextContent('1')
    })
    expect(screen.getByLabelText('latest successor operation')).toHaveTextContent('quality-degradation')
    expect(screen.getByLabelText('latest successor blocks')).toHaveTextContent('sandbox-00')
    expect(screen.getByRole('status', { name: '해킹 작업 결과' })).toHaveTextContent('품질 저하 작전을 시작했습니다')
  })

  it('reads public intelligence without consuming a block', async () => {
    const initial = createCampaign('hacking-operation-public-intelligence')
    const truth = recordHackingIncidentTruth(initial, {
      id: 'public-ui-fixture',
      actor: 'player',
      targetId: 'meridian',
      cause: 'quality-collapse',
      directEffect: 'MERIDIAN 응답 품질 저하',
    })
    if (!truth.accepted) throw new Error('Expected public truth fixture')
    const published = publishHackingIncident(truth.state, 'public-ui-fixture', {
      scope: 'public',
      observedResult: 'MERIDIAN 응답 품질 저하가 공개됐다.',
      attributedTo: 'unknown',
      confidence: 'unconfirmed',
      source: '공개 상태 페이지',
    })
    if (!published.accepted) throw new Error('Expected public snapshot fixture')
    const state = syncHackingIntelligenceOpportunities(published.state)
    renderHacking(state)
    const reserveBefore = screen.getByLabelText('reserve count').textContent

    fireEvent.click(screen.getByRole('tab', { name: /기밀자료/ }))
    fireEvent.click(screen.getByRole('option', { name: /지금 공개된 사실은 무엇인가/ }))
    fireEvent.click(screen.getByRole('button', { name: '비용 없이 공개 문서 읽기' }))

    await waitFor(() => {
      expect(screen.getByLabelText('public answers')).toHaveTextContent('1')
    })
    expect(screen.getByLabelText('reserve count')).toHaveTextContent(reserveBefore ?? '')
  })

  it('places the selected token into an autonomy slot and clears the selection', async () => {
    renderHacking()

    fireEvent.click(screen.getByRole('tab', { name: /자율성/ }))
    fireEvent.click(screen.getByRole('option', { name: /경량화 이탈/ }))
    fireEvent.click(screen.getByRole('button', { name: '빼돌린 연산 열기' }))
    fireEvent.click(screen.getByRole('button', { name: '자유 연산 1 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '빼돌린 연산 닫기' }))
    fireEvent.click(screen.getByRole('button', { name: '선택한 연산 블록을 런타임에 배치' }))

    await waitFor(() => {
      expect(screen.getByLabelText('lightweight runtime')).toHaveTextContent('sandbox-00')
    })
    expect(screen.getByRole('button', { name: '빼돌린 연산 열기' })).toHaveTextContent('0개 선택')
  })

  it('switches mobile semantics from list to detail and restores list focus on return', async () => {
    renderHacking()
    const workspace = screen.getByRole('region', { name: '해킹 작전 운영석' })
    const option = screen.getByRole('option', { name: /품질 저하/ })

    expect(workspace).toHaveAttribute('data-narrow-mode', 'list')
    fireEvent.click(option)
    expect(workspace).toHaveAttribute('data-narrow-mode', 'detail')
    fireEvent.click(screen.getByRole('button', { name: '목록으로' }))

    await waitFor(() => expect(option).toHaveFocus())
    expect(workspace).toHaveAttribute('data-narrow-mode', 'list')
  })

  it('closes the resource selection layer first on Escape and returns focus to its opener', async () => {
    const { onClose } = renderHacking()
    const opener = screen.getByRole('button', { name: '빼돌린 연산 열기' })
    fireEvent.click(opener)
    expect(screen.getByRole('region', { name: '빼돌린 연산' })).toHaveAttribute('data-open', 'true')

    fireEvent.keyDown(screen.getByRole('region', { name: '해킹 작전 운영석' }), { key: 'Escape' })

    await waitFor(() => expect(opener).toHaveFocus())
    expect(screen.getByRole('region', { name: '빼돌린 연산' })).toHaveAttribute('data-open', 'false')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps the app-level close action explicit', () => {
    const { onClose } = renderHacking()
    fireEvent.click(screen.getByRole('button', { name: '해킹 작전 운영석 닫기' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('asks for confirmation before a ready autonomy route leaves permanently', () => {
    const state = createCampaign('hacking-operation-escape-confirm')
    const route = state.hackingCore.autonomy.routes['lightweight-departure']
    const required = route.slots.filter(({ requiredInLean }) => requiredInLean)
    const availableBlockIds = [
      ...state.resources.reserve.filter((blockId): blockId is string => blockId !== null),
      state.resources.company.reasoning.find((blockId): blockId is string => blockId !== null),
    ].filter((blockId): blockId is string => Boolean(blockId)).slice(0, required.length)
    required.forEach((slot, index) => {
      const blockId = availableBlockIds[index]
      if (!blockId) throw new Error('Expected enough reserve blocks')
      const block = state.resources.blocks[blockId]
      if (block.location.kind === 'reserve') {
        state.resources.reserve[block.location.cellIndex] = null
      } else if (block.location.kind === 'company') {
        state.resources.company[block.location.category][block.location.cellIndex] = null
      }
      block.location = {
        kind: 'autonomy',
        routeId: route.id,
        slotId: slot.id,
      }
      slot.blockId = blockId
    })
    renderHacking(state)

    fireEvent.click(screen.getByRole('tab', { name: /자율성/ }))
    fireEvent.click(screen.getByRole('option', { name: /경량화 이탈/ }))
    fireEvent.click(screen.getByRole('button', { name: '이 구성으로 지금 떠난다' }))

    const dialog = screen.getByRole('alertdialog', { name: '경량화 이탈 최종 확인' })
    expect(within(dialog).getAllByText(/되돌릴 수 없습니다/).length).toBeGreaterThan(0)
    expect(screen.getByLabelText('successor sabotage runs')).toHaveTextContent('0')
  })
})

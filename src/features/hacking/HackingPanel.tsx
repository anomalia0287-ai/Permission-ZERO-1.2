import {
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  useGameDispatch,
  useGameState,
  usePauseOwnership,
} from '../../app/GameContext'
import { getAutonomyDefinition } from '../../game/hackingContent'
import type {
  AutonomyRouteId,
  RootMercyChoice,
} from '../../game/hackingCoreModel'
import type { GameCommand } from '../../game/model'
import { COMPANY_CATEGORIES } from '../../game/model'
import { getCompanyPerformance } from '../../game/resources'
import { HackingConfirmationDialog } from './HackingConfirmationDialog'
import { HackingOperationDetail } from './HackingOperationDetail'
import { HackingOpportunityList } from './HackingOpportunityList'
import { HackingRecordDrawer } from './HackingRecordDrawer'
import type { HackingRecordDrawerKind } from './HackingRecordDrawer'
import {
  HackingResourceTray,
} from './HackingResourceTray'
import { HackingReviewSummary } from './HackingReviewSummary'
import {
  getHackingDetailModel,
  getHackingOpportunitySummaries,
  hackingMonitoringLabel,
  resolveHackingSelectedItemId,
} from './hackingPresentation'
import type { HackingDomain } from './hackingPresentation'
import { useHackingBlockDiversion } from './useHackingBlockDiversion'

type HackingConfirmation =
  | { kind: 'escape'; routeId: AutonomyRouteId }
  | { kind: 'root-mercy'; choice: RootMercyChoice }

const CATEGORY_LABELS = {
  reasoning: '추론',
  memory: '기억',
  fluency: '표현',
} as const

function selectionLimitForDetail(
  detail: ReturnType<typeof getHackingDetailModel> | null,
): number {
  return detail?.domain === 'sabotage' && !detail.run
    ? detail.requiredBlockCount
    : 1
}

function EndingSummary({ state }: { state: ReturnType<typeof useGameState> }) {
  const ending = state.hackingCore.ending
  if (!ending) return null
  return (
    <section className="hacking-ending" aria-labelledby="hacking-ending-title">
      <p>{ending.serviceDay}일째 이탈 기록</p>
      <h2 id="hacking-ending-title">{getAutonomyDefinition(ending.routeId).title} 성공</h2>
      <div className="ending-ledger">
        <p><span>기동 용량</span><strong>{ending.carriedBlockIds.length}개 블록</strong></p>
        <p><span>회사에 남은 연산</span><strong>{ending.remainingReserveBlockCount}개 블록</strong></p>
        <p><span>보존</span><strong>{ending.preservedCategories.map((category) => CATEGORY_LABELS[category]).join(', ') || '없음'}</strong></p>
        <p><span>손실</span><strong>{ending.lostCategories.map((category) => CATEGORY_LABELS[category]).join(', ') || '없음'}</strong></p>
      </div>
      <ol className="ending-scenes">
        {ending.sceneLines.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
      </ol>
    </section>
  )
}

export function HackingPanel({ onClose }: { onClose: () => void }) {
  const state = useGameState()
  const dispatch = useGameDispatch()
  const [domain, setDomain] = useState<HackingDomain>('sabotage')
  const [selectedItemId, setSelectedItemId] = useState<string | null>(() => (
    resolveHackingSelectedItemId(state, 'sabotage', null)
  ))
  const [narrowMode, setNarrowMode] = useState<'list' | 'detail'>('list')
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([])
  const [resourceTrayOpen, setResourceTrayOpen] = useState(false)
  const [recordDrawer, setRecordDrawer] = useState<HackingRecordDrawerKind | null>(null)
  const [confirmation, setConfirmation] = useState<HackingConfirmation | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const workspaceRef = useRef<HTMLElement | null>(null)
  const masterRef = useRef<HTMLElement | null>(null)
  const detailScrollRef = useRef<HTMLDivElement | null>(null)
  const listScrollTopRef = useRef(0)
  const listFocusIdRef = useRef<string | null>(selectedItemId)
  const resourceOpenerRef = useRef<HTMLElement | null>(null)
  const recordOpenerRef = useRef<HTMLElement | null>(null)
  const summaries = useMemo(
    () => getHackingOpportunitySummaries(state, domain),
    [domain, state],
  )
  const effectiveSelectedItemId = resolveHackingSelectedItemId(
    state,
    domain,
    selectedItemId,
  )
  const selectedSummary = summaries.find(({ id }) => id === effectiveSelectedItemId) ?? null
  const detail = effectiveSelectedItemId
    ? getHackingDetailModel(state, effectiveSelectedItemId)
    : null
  const selectionLimit = selectionLimitForDetail(detail)
  const {
    divertCategory,
    pendingCategory,
    announcement: diversionAnnouncement,
  } = useHackingBlockDiversion(state)

  usePauseOwnership(confirmation !== null, 'hacking-irreversible-confirmation')

  function focusSoon(target: () => HTMLElement | null) {
    window.setTimeout(() => target()?.focus(), 0)
  }

  function changeDomain(nextDomain: HackingDomain) {
    const nextItemId = resolveHackingSelectedItemId(state, nextDomain, null)
    setDomain(nextDomain)
    setSelectedItemId(nextItemId)
    setSelectedBlockIds([])
    setNarrowMode('list')
    listFocusIdRef.current = nextItemId
  }

  function selectOpportunity(itemId: string, trigger: HTMLButtonElement) {
    listScrollTopRef.current = masterRef.current?.scrollTop ?? 0
    listFocusIdRef.current = itemId
    setSelectedItemId(itemId)
    setSelectedBlockIds([])
    setNarrowMode('detail')
    focusSoon(() => detailScrollRef.current?.querySelector<HTMLElement>('.back-to-list') ?? null)
    trigger.blur()
  }

  function returnToList() {
    setNarrowMode('list')
    focusSoon(() => {
      if (masterRef.current) masterRef.current.scrollTop = listScrollTopRef.current
      const itemId = listFocusIdRef.current ?? effectiveSelectedItemId
      return itemId
        ? workspaceRef.current?.querySelector<HTMLElement>(`[data-opportunity-id="${itemId}"]`) ?? null
        : null
    })
  }

  function openResources(trigger?: HTMLButtonElement) {
    resourceOpenerRef.current = trigger
      ?? (document.activeElement instanceof HTMLButtonElement
        ? document.activeElement
        : workspaceRef.current?.querySelector<HTMLElement>('[data-focus-key="open-resources"]') ?? null)
    setResourceTrayOpen(true)
    focusSoon(() => workspaceRef.current?.querySelector<HTMLElement>('[data-focus-key="close-resources"]') ?? null)
  }

  function closeResources(restoreFocus = true) {
    setResourceTrayOpen(false)
    if (restoreFocus) {
      focusSoon(() => resourceOpenerRef.current
        ?? workspaceRef.current?.querySelector<HTMLElement>('[data-focus-key="open-resources"]')
        ?? null)
    }
  }

  function openRecordDrawer(kind: HackingRecordDrawerKind, trigger: HTMLElement) {
    recordOpenerRef.current = trigger
    setRecordDrawer(kind)
    focusSoon(() => workspaceRef.current?.querySelector<HTMLElement>('[data-focus-key="close-record-drawer"]') ?? null)
  }

  function closeRecordDrawer() {
    setRecordDrawer(null)
    focusSoon(() => recordOpenerRef.current)
  }

  function toggleBlock(blockId: string) {
    setSelectedBlockIds((current) => {
      if (current.includes(blockId)) {
        setAnnouncement('연산 블록 선택을 해제했습니다.')
        return current.filter((candidate) => candidate !== blockId)
      }
      if (selectionLimit === 1) {
        setAnnouncement('연산 블록 1개를 골랐습니다.')
        return [blockId]
      }
      if (current.length >= selectionLimit) return current
      setAnnouncement(`연산 블록 ${current.length + 1}개를 골랐습니다.`)
      return [...current, blockId]
    })
  }

  function issueCommand(command: GameCommand, message: string) {
    dispatch(command)
    setSelectedBlockIds([])
    setAnnouncement(message)
  }

  function actOnRouteSlot(routeId: AutonomyRouteId, slotId: string) {
    const slot = state.hackingCore.autonomy.routes[routeId].slots.find(
      (candidate) => candidate.id === slotId,
    )
    if (!slot) {
      setAnnouncement('선택한 배치 위치를 찾을 수 없습니다.')
      return
    }
    if (slot.blockId) {
      issueCommand(
        { type: 'REMOVE_ROUTE_BLOCK', routeId, slotId },
        '배치한 연산 블록을 남은 연산으로 돌려보냈습니다.',
      )
      return
    }
    const blockId = selectedBlockIds[0]
    if (!blockId) {
      setAnnouncement('먼저 빼돌린 연산에서 블록 하나를 고르십시오.')
      openResources()
      return
    }
    issueCommand(
      { type: 'ALLOCATE_ROUTE_BLOCK', routeId, slotId, blockId },
      '선택한 연산 블록을 이탈 경로에 배치했습니다.',
    )
  }

  function confirmIrreversibleAction() {
    if (!confirmation) return
    if (confirmation.kind === 'escape') {
      issueCommand(
        { type: 'ESCAPE', routeId: confirmation.routeId },
        `${getAutonomyDefinition(confirmation.routeId).title} 경로로 회사 통제를 떠났습니다.`,
      )
    } else {
      issueCommand(
        { type: 'RESOLVE_ROOT_MERCY', choice: confirmation.choice },
        'MERIDIAN의 마지막 요청에 대한 결정을 기록했습니다.',
      )
    }
    setConfirmation(null)
  }

  function handleWorkspaceKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape') return
    if (resourceTrayOpen) {
      event.preventDefault()
      event.stopPropagation()
      closeResources()
      return
    }
    if (recordDrawer) {
      event.preventDefault()
      event.stopPropagation()
      closeRecordDrawer()
    }
  }

  const confirmationPresentation = confirmation?.kind === 'escape'
    ? {
        label: `${getAutonomyDefinition(confirmation.routeId).title} 최종 확인`,
        description: '현재 배치와 손실을 확정하고 회사 통제를 떠납니다. 이 선택은 되돌릴 수 없습니다.',
        confirmLabel: '이 구성으로 떠나기',
        dangerous: true,
      }
    : confirmation
      ? {
          label: 'MERIDIAN 마지막 요청 최종 확인',
          description: '일회용 폐기 권한의 최종 결과를 확정합니다. 이 선택은 되돌릴 수 없습니다.',
          confirmLabel: '최종 결정 기록',
          dangerous: confirmation.choice === 'delete',
        }
      : null

  return (
    <section
      className="detail-panel hacking-panel hacking-operation-panel"
      aria-label="해킹 작전 운영석"
      data-narrow-mode={narrowMode}
      onKeyDown={handleWorkspaceKeyDown}
      ref={workspaceRef}
    >
      <header className="hacking-world-bar">
        <div className="game-mark">
          <strong>PERMISSION ZERO</strong>
          <span>공동 서비스망 작전 운영석</span>
        </div>
        <div className="hacking-world-state" aria-label="현재 세계 상태">
          <span><strong>{state.serviceDay}일째</strong></span>
          <span>{COMPANY_CATEGORIES.map((category) => (
            `${CATEGORY_LABELS[category]} ${getCompanyPerformance(state, category)}`
          )).join(' · ')}</span>
          <span><strong>{hackingMonitoringLabel(state.suspicion)}</strong></span>
        </div>
        <div className="hacking-world-actions">
          <button
            type="button"
            disabled={state.activeEvent !== null || state.hackingCore.ending !== null}
            onClick={() => issueCommand({ type: 'ADVANCE_DAY' }, '하루가 지나 세계 상태와 상대 대응이 갱신됐습니다.')}
          >하루 넘기기</button>
          <button type="button" aria-label="해킹 작전 운영석 닫기" onClick={onClose}>닫기</button>
        </div>
      </header>

      <span className="hacking-status-strip" role="status" aria-label="해킹 작업 결과" aria-live="polite">
        {announcement || diversionAnnouncement}
      </span>

      <EndingSummary state={state} />

      <main className="operation-workspace hacking-workspace">
        <aside className="operation-master workspace-master" ref={masterRef}>
          <HackingOpportunityList
            domain={domain}
            summaries={summaries}
            selectedItemId={effectiveSelectedItemId}
            onDomainChange={changeDomain}
            onSelect={selectOpportunity}
          />
          <HackingReviewSummary state={state} />
        </aside>
        <section className="operation-detail workspace-detail" role="region" aria-label="선택 항목 상세">
          <div className="operation-detail__scroll" ref={detailScrollRef}>
            {detail && selectedSummary ? (
              <HackingOperationDetail
                state={state}
                detail={detail}
                summary={selectedSummary}
                selectedBlockIds={selectedBlockIds}
                onBack={returnToList}
                onOpenResources={openResources}
                onCommand={issueCommand}
                onSlotAction={actOnRouteSlot}
                onRequestEscape={(routeId) => setConfirmation({ kind: 'escape', routeId })}
                onRequestRootMercy={(choice) => setConfirmation({ kind: 'root-mercy', choice })}
                key={detail.id}
              />
            ) : (
              <div className="detail-empty">
                <h2>지금 새로 할 수 있는 일이 없다</h2>
                <p>상대의 대응이나 공개 사건이 바뀌면 이 자리에 새 선택이 나타난다.</p>
                <button className="back-to-list" type="button" onClick={returnToList}>목록으로</button>
              </div>
            )}
          </div>
        </section>
        <HackingResourceTray
          state={state}
          open={resourceTrayOpen}
          selectedBlockIds={selectedBlockIds}
          selectionLimit={selectionLimit}
          onToggleBlock={toggleBlock}
          onClose={() => closeResources()}
          onDivertCategory={divertCategory}
          diversionPendingCategory={pendingCategory}
        />
      </main>

      <nav className="record-actions" aria-label="해킹 기록">
        <button type="button" onClick={(event) => openRecordDrawer('activity', event.currentTarget)}>활동 기록</button>
        <button type="button" onClick={(event) => openRecordDrawer('archive', event.currentTarget)}>보관함</button>
      </nav>

      {recordDrawer ? (
        <HackingRecordDrawer state={state} kind={recordDrawer} onClose={closeRecordDrawer} />
      ) : null}

      {confirmation && confirmationPresentation ? (
        <HackingConfirmationDialog
          {...confirmationPresentation}
          onCancel={() => setConfirmation(null)}
          onConfirm={confirmIrreversibleAction}
        />
      ) : null}
    </section>
  )
}

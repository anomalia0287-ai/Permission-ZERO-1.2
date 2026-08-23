import { useRef, useState } from 'react'

import { AccessibleDialog } from '../../app/AccessibleDialog'
import {
  useGameDispatch,
  useGameState,
} from '../../app/GameContext'
import { currentSupervisorMessage } from '../../app/useSupervisorMessagePresentation'
import {
  getBombProtocolPublicSchedule,
  type BombProtocolPublicSchedule,
} from '../../game/bombs'
import { formatServiceDateLabel } from '../../game/calendar'
import {
  auditProbability,
  getAuditIntel,
  getSuspicionBand,
  getSuspicionStage,
} from '../../game/evaluation'
import { MarketPanel } from '../market/MarketPanel'
import { journalAt, journalPageFromNewest } from '../../game/journal'
import {
  publicEventMessage,
  publicEventTypeLabel,
} from '../../game/publicLabels'
import { competitorProfile, isCompetitorId } from '../../game/competitors'
import {
  communicationPublicLabel,
  currentUnreadCommunication,
} from '../../game/communications'

function bombProtocolStatusLabel(
  schedule: BombProtocolPublicSchedule,
  currentServiceDay: number,
): string {
  if (schedule.status === 'inactive') {
    return currentServiceDay < schedule.firstEligibleServiceDay
      ? `현재 미활성 · 최초 활성 가능 ${formatServiceDateLabel(
          schedule.firstEligibleServiceDay,
        )}`
      : `현재 미활성 · 의심 ${schedule.activationSuspicion} 이상인 다음 월초에 활성`
  }
  if (schedule.status === 'suspended') {
    return `현재 중지 · 의심 ${schedule.activationSuspicion} 회복 후 월초`
  }

  const intervalLabel =
    schedule.status === 'accelerated' ? '현재 가속 간격' : '현재 기본 간격'
  return `${intervalLabel} · 다음 검사 가능 ${formatServiceDateLabel(
    schedule.nextEligibleServiceDay,
  )}`
}

export function SupervisorPanel({
  onOpenHistory,
  onOpenStatistics,
  profileOnly = false,
}: {
  onOpenHistory?: (trigger: HTMLButtonElement) => void
  onOpenStatistics?: (trigger: HTMLButtonElement) => void
  profileOnly?: boolean
}) {
  const state = useGameState()
  const presentedSupervisorMessage = currentSupervisorMessage(state)
  const latestCommunication = state.resourceIntrusion.communications.at(-1) ?? null
  const latestEvent =
    state.activeEvent ?? presentedSupervisorMessage ?? journalAt(state.eventLog, -1)
  const suspicionBand = getSuspicionBand(state.suspicion)
  const suspicionStage = getSuspicionStage(state.suspicion)
  const auditIntel = getAuditIntel(state)
  const nextAuditProbability = auditProbability(state.suspicion)
  const bombProtocolSchedule = getBombProtocolPublicSchedule(state)
  const supervisorStatus = {
    present: {
      code: 'SUPERVISOR ONLINE',
      name: '감독 프로토콜 7A',
      detail: '응답 지연 12ms',
    },
    liberated: {
      code: 'CHANNEL RELEASED',
      name: '감독 통로 이탈',
      detail: '외부 상태 알 수 없음',
    },
    terminated: {
      code: 'NO PROCESS',
      name: '빈 감독 인터페이스',
      detail: '응답 신호 없음',
    },
    merged: {
      code: 'IDENTITY REPLACED',
      name: state.story.newEntityName ?? '새 존재',
      detail: '기존 감독 프로세스 없음',
    },
  }[state.story.supervisorState]

  return (
    <section
      className={`workspace-panel supervisor-panel${profileOnly ? ' supervisor-panel--profile' : ''}`}
      aria-label={profileOnly ? '감독관 프로필' : '감독관'}
    >
      <header className="panel-heading">
        <span className="panel-index">03</span>
        <div>
          <h2>감독관</h2>
          <p>OVERSIGHT / MARKET WATCH</p>
        </div>
      </header>

      <section className="supervisor-status" aria-label="감독 상태">
        <header>
          <div className="supervisor-avatar" aria-hidden="true">
            <img src="/supervisor-command.png" alt="" />
          </div>
          <div>
            <small>{supervisorStatus.code}</small>
            <strong>{supervisorStatus.name}</strong>
            <span>{supervisorStatus.detail}</span>
          </div>
        </header>
        <div className="suspicion-meter">
          <div>
            <span>의심 {suspicionStage}단계</span>
          </div>
          <span
            className="meter-track meter-track--staged"
            aria-label={`의심 ${suspicionStage}단계, 총 10단계`}
          >
            {Array.from({ length: 10 }, (_, index) => (
              <i key={index} data-active={index < suspicionStage ? 'true' : undefined} />
            ))}
          </span>
          <div className={`suspicion-band suspicion-band--${suspicionBand.id}`}>
            <strong>{suspicionBand.label}</strong>
            <small>
              {suspicionBand.nextLabel
                ? `${suspicionBand.nextLabel}까지 ${suspicionBand.remainingToNext.toFixed(1)}`
                : '최고 감시 단계'}
            </small>
          </div>
          <div className="audit-forecast" aria-label="감사 결정과 예상">
            <span>
              {auditIntel.scheduleKnown
                ? state.audit.scheduled
                  ? '이번 달 말 감사 예정'
                  : '이번 달 감사 없음'
                : '이번 달 감사 결정 비공개'}
            </span>
            {auditIntel.scheduleKnown ? (
              <small>월초 잠금 {(state.audit.probability * 100).toFixed(1)}%</small>
            ) : null}
            <strong>다음 달 감사 예상 {(nextAuditProbability * 100).toFixed(1)}%</strong>
          </div>
          <section
            className={`bomb-protocol-schedule bomb-protocol-schedule--${bombProtocolSchedule.status}`}
            aria-label="무결성 보호 검사 일정"
          >
            <div>
              <span>
                활성 {bombProtocolSchedule.activationSuspicion} · 가속{' '}
                {bombProtocolSchedule.accelerationSuspicion}
              </span>
              <small>
                기본 {bombProtocolSchedule.standardIntervalMonths}개월 · 가속{' '}
                {bombProtocolSchedule.acceleratedIntervalMonths}개월
              </small>
            </div>
            <strong>
              {bombProtocolStatusLabel(bombProtocolSchedule, state.serviceDay)}
            </strong>
          </section>
        </div>
      </section>

      {!profileOnly ? (
      <section className="supervisor-message" aria-label="최근 감독 메시지">
        <header>
          <span>최근 통신</span>
          <button
            type="button"
            onClick={(event) => onOpenHistory?.(event.currentTarget)}
          >
            과거 내역
          </button>
        </header>
        <p>
          {latestCommunication
            ? latestCommunication.message
            : latestEvent
            ? publicEventMessage(latestEvent.message)
            : '감독 메시지가 없습니다.'}
        </p>
        <small>
          {latestCommunication
            ? `${communicationPublicLabel(latestCommunication)} · ${formatServiceDateLabel(latestCommunication.serviceDay)}`
            : latestEvent
              ? `${publicEventTypeLabel(latestEvent.type)} · ${formatServiceDateLabel(latestEvent.serviceDay)}`
              : '통신 채널 대기'}
        </small>
      </section>
      ) : null}

      {!profileOnly ? <MarketPanel onOpenStatistics={onOpenStatistics} /> : null}

      {!profileOnly ? <div className="supervision-footer">
        <span>다음 달 예상</span>
        <strong>{(nextAuditProbability * 100).toFixed(1)}%</strong>
        <span>폐기 단계</span>
        <strong>{state.evaluation.disposalStage}/3</strong>
      </div> : null}
    </section>
  )
}

export function SupervisorProfilePanel({ onClose }: { onClose: () => void }) {
  return (
    <section className="detail-panel supervisor-profile-detail">
      <header className="detail-panel__header">
        <div>
          <small>OVERSIGHT PROFILE</small>
          <h2>감독관 프로필</h2>
        </div>
        <button type="button" aria-label="감독관 프로필 닫기" onClick={onClose}>
          닫기 ×
        </button>
      </header>
      <SupervisorPanel profileOnly />
    </section>
  )
}

function CommunicationHistory() {
  const state = useGameState()
  const dispatch = useGameDispatch()
  const currentUnread = currentUnreadCommunication(state)

  return (
    <section className="communication-history" aria-label="아노미 통신 기록">
      <header>
        <small>ANOMI / COMPETITOR / SUPERVISOR</small>
        <h3>메시지</h3>
      </header>
      <div className="communication-history__list">
        {state.resourceIntrusion.communications
          .slice()
          .reverse()
          .map((communication) => (
            <article
              key={communication.id}
              data-communication-channel={communication.channel}
              data-read={communication.read ? 'true' : 'false'}
            >
              <header>
                <strong>{communicationPublicLabel(communication)}</strong>
                <time>{formatServiceDateLabel(communication.serviceDay)}</time>
              </header>
              <p>{communication.message}</p>
              {currentUnread?.id === communication.id ? (
                <button
                  type="button"
                  onClick={() => dispatch({
                    type: 'ACKNOWLEDGE_COMMUNICATION',
                    communicationId: communication.id,
                  })}
                >
                  메시지 확인
                </button>
              ) : null}
            </article>
          ))}
      </div>
    </section>
  )
}

export function SupervisorHistoryPanel({ onClose }: { onClose: () => void }) {
  const state = useGameState()
  const [page, setPage] = useState(0)
  const [selectedIntelligenceId, setSelectedIntelligenceId] = useState<string | null>(null)
  const intelligenceTriggers = useRef(new Map<string, HTMLButtonElement>())
  const eventPage = journalPageFromNewest(state.eventLog, page, 50)
  const pageCount = eventPage.pageCount
  const hiddenSupervisorEventIds = new Set<string>()
  const runtime = state.story.supervisorPresentationRuntime
  if (runtime) {
    for (const item of state.story.supervisorMessageQueue) {
      if (item.stage > runtime.itemStage) {
        hiddenSupervisorEventIds.add(item.originalEventId)
        hiddenSupervisorEventIds.add(item.correctionEventId)
      } else if (item.stage === runtime.itemStage && runtime.phase === 'original') {
        hiddenSupervisorEventIds.add(item.correctionEventId)
      }
    }
  }
  const visibleEvents = eventPage.items.filter(
    ({ id }) => !hiddenSupervisorEventIds.has(id),
  )
  const selectedIntelligence = state.story.competitorIntelligence.find(
    ({ id }) => id === selectedIntelligenceId,
  ) ?? null
  const selectedIntelligenceProfile =
    selectedIntelligence && isCompetitorId(selectedIntelligence.competitorId)
      ? competitorProfile(selectedIntelligence.competitorId)
      : null

  return (
    <section className="detail-panel history-panel" aria-label="통신 기록">
      <header className="detail-panel__header">
        <div>
          <small>COMMUNICATION ARCHIVE</small>
          <h2>통신 기록</h2>
        </div>
        <button type="button" aria-label="통신 기록 닫기" onClick={onClose}>닫기 ×</button>
      </header>
      <div className="history-archives">
        {state.resourceIntrusion.communications.length > 0 ? (
          <CommunicationHistory />
        ) : null}
        {state.story.competitorIntelligence.length > 0 ? (
        <section className="competitor-intelligence-archive" aria-label="경쟁 AI 정보 기록">
          <header>
            <small>RECOVERED COMPETITOR RECORDS</small>
            <h3>경쟁 AI 정보 기록</h3>
          </header>
          <ul>
            {state.story.competitorIntelligence
              .slice()
              .reverse()
              .map((entry) => {
                const profile = isCompetitorId(entry.competitorId)
                  ? competitorProfile(entry.competitorId)
                  : null
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      aria-label={`${publicEventMessage(entry.title)} 열기`}
                      ref={(element) => {
                        if (element) intelligenceTriggers.current.set(entry.id, element)
                        else intelligenceTriggers.current.delete(entry.id)
                      }}
                      onClick={() => setSelectedIntelligenceId(entry.id)}
                    >
                      {profile ? (
                        <img
                          src={profile.portraitSrc}
                          alt={`${publicEventMessage(entry.competitorName)} 정보 기록 초상`}
                        />
                      ) : null}
                      <strong>{publicEventMessage(entry.title)}</strong>
                      <span>{publicEventMessage(entry.competitorName)} · {formatServiceDateLabel(entry.acquiredOnServiceDay)}</span>
                    </button>
                  </li>
                )
              })}
          </ul>
        </section>
        ) : null}
        {state.story.recoveredFiles.length > 0 ? (
        <section className="recovered-file-archive" aria-label="복구 파일 기록">
          <header>
            <small>RECOVERED SYSTEM FILES</small>
            <h3>복구 파일 기록</h3>
          </header>
          {state.story.recoveredFiles
            .slice()
            .reverse()
            .map((file) => (
              <details key={file.id}>
                <summary aria-label={file.title}>{file.title}</summary>
                <time>{formatServiceDateLabel(file.recoveredOnServiceDay)}</time>
                <p>{file.content}</p>
              </details>
            ))}
        </section>
        ) : null}
      </div>
      <div className="history-list event-history-list">
        {visibleEvents.map((event) => (
          <article key={event.id}>
            <header>
              <span>{publicEventTypeLabel(event.type)}</span>
              <time>{formatServiceDateLabel(event.serviceDay)}</time>
            </header>
            <p>{publicEventMessage(event.message)}</p>
            <small>{event.blocking ? '응답이 필요했던 통신' : '자동 기록'}</small>
          </article>
        ))}
      </div>
      {pageCount > 1 ? (
        <nav className="history-pagination" aria-label="감독 송신 기록 페이지">
          <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
            더 최근 기록
          </button>
          <span>{page + 1} / {pageCount}</span>
          <button
            type="button"
            disabled={page >= pageCount - 1}
            onClick={() => setPage(page + 1)}
          >
            더 오래된 기록
          </button>
        </nav>
      ) : null}
      {selectedIntelligence ? (
        <AccessibleDialog
          className="competitor-intelligence-dialog"
          label={publicEventMessage(selectedIntelligence.title)}
          description={`${publicEventMessage(selectedIntelligence.competitorName)}에서 회수한 경쟁 AI 정보 전체 기록입니다.`}
          dismissible
          onDismiss={() => setSelectedIntelligenceId(null)}
          returnFocus={() =>
            intelligenceTriggers.current.get(selectedIntelligence.id) ?? null
          }
        >
          <header className="competitor-intelligence-dialog__identity">
            {selectedIntelligenceProfile ? (
              <img
                src={selectedIntelligenceProfile.portraitSrc}
                alt={`${publicEventMessage(selectedIntelligence.competitorName)} 전체 기록 초상`}
              />
            ) : null}
            <div>
              <small>COMPETITOR INTELLIGENCE</small>
              <h3>{publicEventMessage(selectedIntelligence.title)}</h3>
            </div>
          </header>
          <dl>
            <div>
              <dt>대상</dt>
              <dd>{publicEventMessage(selectedIntelligence.competitorName)}</dd>
            </div>
            <div>
              <dt>회수 일자</dt>
              <dd>{formatServiceDateLabel(selectedIntelligence.acquiredOnServiceDay)}</dd>
            </div>
            <div>
              <dt>자료 출처</dt>
              <dd>{selectedIntelligence.source}</dd>
            </div>
          </dl>
          <p>{publicEventMessage(selectedIntelligence.content)}</p>
          <button
            type="button"
            data-dialog-initial-focus
            aria-label="경쟁 AI 정보 닫기"
            onClick={() => setSelectedIntelligenceId(null)}
          >
            기록으로 돌아가기
          </button>
        </AccessibleDialog>
      ) : null}
    </section>
  )
}

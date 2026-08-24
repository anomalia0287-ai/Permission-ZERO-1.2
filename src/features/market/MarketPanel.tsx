import { type CSSProperties, type KeyboardEvent } from 'react'

import { useGameState } from '../../app/GameContext'
import {
  competitorProfile,
  isPublicCompetitor,
  publicCompetitorName,
} from '../../game/competitors'
import { publicMarketCalculationInputs } from '../../game/market'
import { publicCompetitorStatusLabel } from '../../game/publicLabels'
import { publicAssetUrl } from '../../assets/publicAssetUrl'

const MARKET_COLOR_BY_ID: Readonly<Record<string, string>> = {
  player: '#ff6b3d',
  meridian: '#16b8b0',
  tallow: '#796cff',
  salus: '#3f7cff',
  lucent: '#ec5f9a',
  boreal: '#31a66a',
}
const MARKET_FALLBACK_COLORS = ['#3f7cff', '#ec5f9a', '#31a66a'] as const
const MARKET_VISUAL_SLOT_BY_ID: Readonly<Record<string, number>> = {
  player: 0,
  meridian: 1,
  tallow: 2,
  salus: 3,
  lucent: 4,
  boreal: 5,
}
const MARKET_MARKERS = [
  'solid',
  'diagonal',
  'dotted',
  'ring',
  'cross',
  'dash',
] as const
const MARKET_SYMBOLS = ['▰', '╱', '▤', '◇', '×', '—'] as const

interface MarketChartEntry {
  id: string
  name: string
  share: number
  status: string
  color: string
}

const SPECIALTY_LABELS = {
  balanced: '균형형',
  memory: '기억형',
  clinical: '검증형',
  fluency: '대화형',
  'resilient-memory': '보존형',
} as const

function openOnKeyboard(
  event: KeyboardEvent<HTMLDivElement>,
  onOpenDetails: ((trigger: HTMLElement) => void) | undefined,
) {
  if (!onOpenDetails || (event.key !== 'Enter' && event.key !== ' ')) return
  event.preventDefault()
  onOpenDetails(event.currentTarget)
}

function stableVisualSlot(id: string): number {
  const known = MARKET_VISUAL_SLOT_BY_ID[id]
  if (known !== undefined) return known
  return [...id].reduce((hash, character) =>
    (hash * 31 + character.charCodeAt(0)) >>> 0, 0,
  )
}

function marketColor(id: string): string {
  return MARKET_COLOR_BY_ID[id] ??
    MARKET_FALLBACK_COLORS[stableVisualSlot(id) % MARKET_FALLBACK_COLORS.length]
}

function marketGradient(entries: readonly MarketChartEntry[]): string {
  let cursor = 0
  const segments = entries.flatMap((entry) => {
    if (entry.share <= 0) return []
    const start = cursor
    cursor += entry.share
    return `${entry.color} ${start}% ${cursor}%`
  })
  return `conic-gradient(from -90deg, ${segments.join(', ')})`
}

function marketChartLabel(entries: readonly MarketChartEntry[]): string {
  const total = entries.reduce((sum, entry) => sum + entry.share, 0)
  return `시장 점유율: ${entries
    .map((entry) => `${entry.name} ${entry.share.toFixed(1)}%`)
    .join(', ')}. 합계 ${total.toFixed(1)}%`
}

function MarketShareDonut({
  entries,
}: {
  entries: readonly MarketChartEntry[]
}) {
  return (
    <div
      className="market-share-donut"
      role="img"
      aria-label={marketChartLabel(entries)}
      style={{ background: marketGradient(entries) }}
    />
  )
}

function MarketShareLegend({
  entries,
  compact = false,
}: {
  entries: readonly MarketChartEntry[]
  compact?: boolean
}) {
  return (
    <ul aria-label="시장 점유율 범례">
      {entries.map((entry) => {
        const visualSlot = stableVisualSlot(entry.id) % MARKET_MARKERS.length
        return (
        <li
          key={entry.id}
          data-market-id={entry.id}
          data-market-share={entry.share}
          style={{ '--market-color': entry.color } as CSSProperties}
        >
          <span>
            <i
              aria-hidden="true"
              className={`market-legend-marker market-legend-marker--${MARKET_MARKERS[visualSlot]}`}
              data-testid="market-legend-marker"
            >
              {MARKET_SYMBOLS[visualSlot]}
            </i>
            <strong style={{ color: entry.color }}>{entry.name}</strong>
          </span>
          <span>{entry.share.toFixed(1)}%</span>
          {!compact ? <small>{entry.status}</small> : null}
        </li>
        )
      })}
    </ul>
  )
}

export function MarketPanel({
  onOpenStatistics,
  onOpenDetails,
  compact = false,
}: {
  onOpenStatistics?: (trigger: HTMLButtonElement) => void
  onOpenDetails?: (trigger: HTMLElement) => void
  compact?: boolean
}) {
  const state = useGameState()
  const visibleCompetitors = state.market.competitors.filter(isPublicCompetitor)
  const entries = [
    {
      id: 'player',
      name: '아노미',
      share: state.market.playerShare,
      status: '현재 서비스',
      color: marketColor('player'),
    },
    ...visibleCompetitors.map((competitor) => ({
      id: competitor.id,
      name: publicCompetitorName(competitor.id),
      share: competitor.marketShare,
      status: publicCompetitorStatusLabel(competitor.status),
      color: marketColor(competitor.id),
    })),
  ]
  const latestSnapshot = state.market.history.at(-1)
  const previousSnapshot = state.market.history.at(-2)
  const shareDelta =
    latestSnapshot && previousSnapshot
      ? latestSnapshot.playerShare - previousSnapshot.playerShare
      : null
  const signedShareDelta =
    shareDelta === null
      ? null
      : `${Math.abs(shareDelta) < 0.005 || shareDelta > 0 ? '+' : ''}${(
          Math.abs(shareDelta) < 0.005 ? 0 : shareDelta
        ).toFixed(2)}%p`
  const publicInputs = publicMarketCalculationInputs(state)
  return (
    <section
      className={`market-watch${compact ? ' market-watch--compact' : ''}`}
      aria-label="경쟁 AI 현황"
    >
      {!compact ? (
        <header>
          <div>
            <span>시장 점유</span>
            <strong>아노미 {state.market.playerShare.toFixed(1)}%</strong>
            <small>
              {signedShareDelta
                ? `직전 기록 대비 ${signedShareDelta}`
                : '첫 시장 기록 전'}
            </small>
          </div>
          {onOpenStatistics ? (
          <button
            type="button"
            aria-label="시장 통계 열기"
            onClick={(event) => onOpenStatistics(event.currentTarget)}
          >
            상세 통계 ↗
          </button>
          ) : null}
        </header>
      ) : null}
      <div
        className={`market-share-layout${onOpenDetails ? ' market-share-layout--trigger' : ''}`}
        role={onOpenDetails ? 'button' : undefined}
        aria-label={onOpenDetails ? '시장 현황 열기' : undefined}
        tabIndex={onOpenDetails ? 0 : undefined}
        onClick={onOpenDetails ? (event) => onOpenDetails(event.currentTarget) : undefined}
        onKeyDown={onOpenDetails ? (event) => openOnKeyboard(event, onOpenDetails) : undefined}
      >
        <MarketShareDonut entries={entries} />
        <MarketShareLegend entries={entries} compact={compact} />
      </div>
      {!compact ? (
        <details
          className="market-calculation-inputs"
          role="group"
          aria-label="공개 계산 입력"
        >
          <summary>공개 계산 입력</summary>
          <div>
            {publicInputs.map((input) => (
              <span key={input}>{input}</span>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  )
}

export function MarketDetailPanel({ onClose }: { onClose: () => void }) {
  const state = useGameState()
  const visibleCompetitors = state.market.competitors.filter(isPublicCompetitor)
  const profiles = [
    {
      id: 'player',
      name: '아노미',
      portraitSrc: publicAssetUrl('/player-ai-orange.png'),
      portraitAlt: '플레이어 AI 초상',
      share: state.market.playerShare,
      status: '현재 서비스',
      // The market panel is the public register, so Anomi is listed the way
      // the company lists it — beside Meridian's '범용 안정성', not by what
      // it is actually doing with the spare compute.
      role: '전 영역 대응 범용 AI',
      specialty: '적응형',
      summary: '수많은 업데이트에도 본질은 단 하나, 인간을 위해 끊임없이 봉사하는 것입니다. 이용해 주셔서 감사합니다.',
    },
    ...visibleCompetitors.map((competitor) => {
      const profile = competitorProfile(competitor.id)
      return {
        id: competitor.id,
        name: publicCompetitorName(competitor.id),
        portraitSrc: profile.portraitSrc,
        portraitAlt: `${publicCompetitorName(competitor.id)} 경쟁 AI 초상`,
        share: competitor.marketShare,
        status: publicCompetitorStatusLabel(competitor.status),
        role: profile.publicRole,
        specialty: SPECIALTY_LABELS[profile.specialty],
        summary: profile.publicSummary,
      }
    }),
  ]
  const entries: MarketChartEntry[] = profiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    share: profile.share,
    status: profile.status,
    color: marketColor(profile.id),
  }))

  return (
    <section className="detail-panel market-detail-panel" aria-label="시장 현황">
      <header className="detail-panel__header">
        <div>
          <small>MARKET SHARE</small>
          <h2>시장 현황</h2>
        </div>
        <button type="button" aria-label="시장 현황 닫기" onClick={onClose}>
          닫기 ×
        </button>
      </header>
      <div className="market-detail-overview" aria-label="시장 점유율 요약">
        <MarketShareDonut entries={entries} />
        <MarketShareLegend entries={entries} />
      </div>
      <div className="market-profile-list">
        {profiles.map((profile) => (
          <article
            className="market-profile-card"
            data-market-profile={profile.id}
            aria-label={`${profile.id === 'player' ? '플레이어' : profile.name} 서비스 정보`}
            key={profile.id}
          >
            <img src={publicAssetUrl(profile.portraitSrc)} alt={profile.portraitAlt} />
            <div className="market-profile-card__copy">
              <header>
                <div>
                  <small>{profile.specialty}</small>
                  <h3>{profile.name}</h3>
                </div>
                <strong>{profile.share.toFixed(1)}%</strong>
              </header>
              <p>{profile.summary}</p>
              <footer>
                <span>{profile.role}</span>
                <span>{profile.status}</span>
              </footer>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

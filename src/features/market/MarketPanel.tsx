import { useGameState } from '../../app/GameContext'
import { publicMarketCalculationInputs } from '../../game/market'
import { publicCompetitorStatusLabel } from '../../game/publicLabels'

const MARKET_COLORS = ['var(--reserve)', 'var(--company)', 'var(--prompt)']
const MARKET_MARKERS = ['solid', 'diagonal', 'dotted'] as const
const MARKET_SYMBOLS = ['●', '╱', '⁙'] as const

function marketGradient(shares: number[]): string {
  let cursor = 0
  const segments = shares.flatMap((share, index) => {
    if (share <= 0) return []
    const start = cursor
    cursor += share
    return `${MARKET_COLORS[index % MARKET_COLORS.length]} ${start}% ${cursor}%`
  })
  return `conic-gradient(${segments.join(', ')})`
}

export function MarketPanel({
  onOpenStatistics,
  compact = false,
}: {
  onOpenStatistics?: (trigger: HTMLButtonElement) => void
  compact?: boolean
}) {
  const state = useGameState()
  const entries = [
    {
      id: 'player',
      name: '당신',
      share: state.market.playerShare,
      status: '현재 서비스',
    },
    ...state.market.competitors.map((competitor) => ({
      id: competitor.id,
      name: competitor.name,
      share: competitor.marketShare,
      status: publicCompetitorStatusLabel(competitor.status),
    })),
  ]
  const total = entries.reduce((sum, entry) => sum + entry.share, 0)
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
  const chartLabel = `시장 점유율: ${entries
    .map((entry) => `${entry.name} ${entry.share.toFixed(1)}%`)
    .join(', ')}. 합계 ${total.toFixed(1)}%`

  return (
    <section
      className={`market-watch${compact ? ' market-watch--compact' : ''}`}
      aria-label="경쟁 AI 현황"
    >
      <header>
        <div>
          <span>시장 경쟁 구도</span>
          <h3>경쟁 AI 점유율</h3>
          <strong>당신 {state.market.playerShare.toFixed(1)}%</strong>
          <small>
            {signedShareDelta
              ? `직전 기록 대비 ${signedShareDelta}`
              : '첫 시장 기록 전'}
          </small>
        </div>
        {!compact && onOpenStatistics ? (
          <button
            type="button"
            aria-label="시장 통계 열기"
            onClick={(event) => onOpenStatistics(event.currentTarget)}
          >
            상세 통계 ↗
          </button>
        ) : null}
      </header>
      <div className="market-share-layout">
        <div
          className="market-share-donut"
          role="img"
          aria-label={chartLabel}
          style={{ background: marketGradient(entries.map(({ share }) => share)) }}
        >
          <div className="market-share-donut__center" aria-hidden="true">
            <span>당신</span>
            <strong>{state.market.playerShare.toFixed(1)}%</strong>
          </div>
        </div>
        <ul aria-label="시장 점유율 범례">
          {entries.map((entry, index) => (
            <li key={entry.id} data-market-share={entry.share}>
              <span className="market-share-layout__identity">
                <i
                  aria-hidden="true"
                  className={`market-legend-marker market-legend-marker--${MARKET_MARKERS[index]}`}
                  data-testid="market-legend-marker"
                >
                  {MARKET_SYMBOLS[index]}
                </i>
                <span>
                  <strong>{entry.name}</strong>
                  <small>{entry.status}</small>
                </span>
              </span>
              <output>{entry.share.toFixed(1)}%</output>
              <span className="market-share-layout__bar" aria-hidden="true">
                <i style={{ width: `${entry.share}%` }} />
              </span>
            </li>
          ))}
        </ul>
      </div>
      {!compact ? (
        <details
          className="market-calculation-inputs"
          role="group"
          aria-label="공개 계산 입력"
        >
          <summary>점유율 계산 근거 보기</summary>
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

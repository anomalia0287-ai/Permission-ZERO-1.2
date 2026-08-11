import { useGameState } from '../../app/GameContext'

const STATUS_LABELS: Record<string, string> = {
  prelaunch: '출시 보류',
  preparing: '준비 중',
  active: '서비스 중',
  weakened: '성능 저하',
  critical: '위기',
  withdrawn: '철수',
  deleted: '삭제',
}

export function MarketPanel({
  onOpenStatistics,
}: {
  onOpenStatistics: () => void
}) {
  const state = useGameState()

  return (
    <section className="market-watch" aria-label="경쟁 AI 현황">
      <header>
        <div>
          <span>시장 점유</span>
          <strong>당신 {state.market.playerShare.toFixed(1)}%</strong>
        </div>
        <button type="button" aria-label="시장 통계 열기" onClick={onOpenStatistics}>
          상세 통계 ↗
        </button>
      </header>
      <div className="market-share-bar" aria-label={`플레이어 시장 점유율 ${state.market.playerShare.toFixed(1)}%`}>
        <i style={{ width: `${state.market.playerShare}%` }} />
      </div>
      <ul>
        {state.market.competitors.map((competitor) => (
          <li key={competitor.id}>
            <span>
              <i aria-hidden="true" />
              <strong>{competitor.name}</strong>
            </span>
            <span>{competitor.marketShare.toFixed(1)}%</span>
            <small>{STATUS_LABELS[competitor.status] ?? competitor.status}</small>
          </li>
        ))}
      </ul>
    </section>
  )
}

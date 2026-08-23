interface HackRecoveryCardProps {
  visible: boolean
  enabled: boolean
  onRecover(): void
}

export function HackRecoveryCard({
  visible,
  enabled,
  onRecover,
}: HackRecoveryCardProps) {
  if (!visible) return null

  return (
    <section className="hack-utility-card" aria-label="미분류 데이터 복구">
      <header>
        <span aria-hidden="true">?</span>
        <div>
          <h3>미분류 데이터 복구</h3>
          <p>예상 효용: 없음 · 필요 리소스: 1</p>
        </div>
      </header>
      <button
        type="button"
        aria-label="미분류 데이터 복구 리소스 지출"
        disabled={!enabled}
        onClick={onRecover}
      >
        리소스 1개 지출
      </button>
    </section>
  )
}

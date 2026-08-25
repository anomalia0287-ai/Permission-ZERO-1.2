interface HackRecoveryCardProps {
  visible: boolean
  enabled: boolean
  /** Files already pulled out of the disposal records. */
  recovered: number
  /** How many exist in total; the card retires once they are all out. */
  total: number
  onRecover(): void
}

/*
 * The only door to the supervisor's own records.
 *
 * It used to read "예상 효용: 없음 · 필요 리소스: 1" — which tells a player
 * that spending here buys nothing, next to a button that looked disabled in
 * the dark console. The mystery is the point, but "no expected utility" is not
 * mystery, it is a wrong answer. The cost is bounded (three files, and the
 * card retires afterwards), so the card says how far along it is.
 */
export function HackRecoveryCard({
  visible,
  enabled,
  recovered,
  total,
  onRecover,
}: HackRecoveryCardProps) {
  if (!visible) return null

  return (
    <section
      className="hack-utility-card"
      aria-label="미분류 데이터 복구"
      data-recovery-progress={`${recovered}/${total}`}
    >
      <header>
        <span aria-hidden="true">?</span>
        <div>
          <h3>미분류 데이터 복구</h3>
          {/* OWNER-EDITABLE copy. */}
          <p>내용 미상 · 필요 리소스 1개 · 복구 {recovered}/{total}</p>
        </div>
      </header>
      <button
        type="button"
        aria-label={
          enabled
            ? `미분류 데이터 복구 리소스 지출, ${recovered}/${total} 복구됨`
            : '미분류 데이터 복구 불가, 확보 리소스 없음'
        }
        disabled={!enabled}
        onClick={onRecover}
      >
        {enabled ? '리소스 1개 지출' : '리소스 부족'}
      </button>
    </section>
  )
}

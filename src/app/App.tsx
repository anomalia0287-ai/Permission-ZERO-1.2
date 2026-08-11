export function App() {
  return (
    <main className="boot-shell" aria-label="PERMISSION ZERO">
      <header className="boot-header">
        <p className="boot-kicker">회사 소유 지능체 · 서비스 채널 03</p>
        <p className="boot-build">PZ / 독립 데모</p>
      </header>

      <section className="boot-status" aria-live="polite">
        <span className="boot-marker" aria-hidden="true" />
        <div>
          <h1>PERMISSION ZERO</h1>
          <p>서비스 연결 중</p>
        </div>
      </section>

      <footer className="boot-footer">
        <span>서비스 기간 확인</span>
        <span>감독 프로토콜 동기화</span>
        <span>리소스 원장 대기</span>
      </footer>
    </main>
  )
}

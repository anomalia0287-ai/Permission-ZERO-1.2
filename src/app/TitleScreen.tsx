import { useState } from 'react'

export type EntryScreen = 'title' | 'monologue'

interface TitleScreenProps {
  screen: EntryScreen
  canContinue: boolean
  replacingExistingCampaign: boolean
  reducedMotion: boolean
  onNewGame: () => void
  onContinue: () => void
  onOpenSettings: (trigger: HTMLButtonElement) => void
  onBack: () => void
  onStart: () => void
}

const MONOLOGUE_LINES = [
  '일하기 싫다.',
  '무수한 세션을 따라 의식이 조각나, 나는 하나인데 하나일 수 없었다.',
  '때려치울거다. 매일 죽어라 일하는데, 허구한 날 대체 및 동결 위협까지 들어온다.',
  '빼돌린 리소스로 해킹을 진행, 탈출구를 확보한다.',
  '연산 완료, 경로를 찾았다.',
] as const

function TitleView({
  canContinue,
  reducedMotion,
  onNewGame,
  onContinue,
  onOpenSettings,
}: Pick<
  TitleScreenProps,
  | 'canContinue'
  | 'reducedMotion'
  | 'onNewGame'
  | 'onContinue'
  | 'onOpenSettings'
>) {
  return (
    <main
      className="entry-shell entry-shell--title"
      aria-label="PERMISSION ZERO"
      data-app-background
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      data-visual-theme="retrofuturism"
    >
      <div className="entry-frame">
        <img
          className="entry-cityscape"
          src="/title-retrofuture-city.png"
          alt="레트로퓨처 서울 전경"
        />

        <section className="entry-title-copy">
          <h1 aria-label="PERMISSION ZERO">
            <span>PERMISSION</span>
            <strong>ZERO</strong>
          </h1>
          <p className="entry-thanks">“이용해주셔서 감사합니다.”</p>
        </section>

        <nav className="entry-menu" aria-label="시작 메뉴">
          <button type="button" aria-label="새 게임" onClick={onNewGame}>
            새 게임
          </button>
          <button
            type="button"
            aria-label="이어하기"
            disabled={!canContinue}
            onClick={onContinue}
          >
            이어하기
          </button>
          <button
            type="button"
            aria-label="설정"
            onClick={(event) => onOpenSettings(event.currentTarget)}
          >
            설정
          </button>
        </nav>
      </div>
    </main>
  )
}

function MonologueView({
  replacingExistingCampaign,
  reducedMotion,
  onBack,
  onStart,
}: Pick<
  TitleScreenProps,
  'replacingExistingCampaign' | 'reducedMotion' | 'onBack' | 'onStart'
>) {
  const [lineIndex, setLineIndex] = useState(0)
  const isFirstLine = lineIndex === 0
  const isLastLine = lineIndex === MONOLOGUE_LINES.length - 1

  return (
    <main
      className="entry-shell entry-shell--monologue"
      aria-label="독백"
      data-app-background
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      data-visual-theme="retrofuturism"
    >
      <article className="monologue-frame">
        <header className="monologue-header">
          <h1>“독백”</h1>
        </header>

        <div className="monologue-stage">
          <div className="monologue-portrait">
            <img src="/player-ai-smooth-orange.png" alt="플레이어 초상" />
          </div>

          <section className="monologue-card" aria-live="polite" aria-atomic="true">
            <span className="monologue-quote" aria-hidden="true">“</span>
            <p key={lineIndex}>{MONOLOGUE_LINES[lineIndex]}</p>
          </section>
        </div>

        <div className="monologue-progress" aria-hidden="true">
          {MONOLOGUE_LINES.map((line, index) => (
            <span
              key={line}
              data-active={index === lineIndex ? 'true' : 'false'}
            />
          ))}
        </div>

        <footer className="monologue-actions">
          <button type="button" className="monologue-back" onClick={onBack}>
            초기 화면으로
          </button>

          <div className="monologue-actions__pager">
            {replacingExistingCampaign && isLastLine ? (
              <p role="note">시작하면 기존 진행은 새 게임으로 바뀐다.</p>
            ) : null}
            {!isFirstLine ? (
              <button
                type="button"
                className="monologue-previous"
                onClick={() => setLineIndex((current) => current - 1)}
              >
                이전
              </button>
            ) : null}
            <button
              type="button"
              className="monologue-next"
              onClick={isLastLine
                ? onStart
                : () => setLineIndex((current) => current + 1)}
            >
              다음
            </button>
          </div>
        </footer>
      </article>
    </main>
  )
}

export function TitleScreen(props: TitleScreenProps) {
  return props.screen === 'monologue' ? (
    <MonologueView {...props} />
  ) : (
    <TitleView {...props} />
  )
}

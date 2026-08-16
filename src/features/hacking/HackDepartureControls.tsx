import type { FinalChoice } from '../../game/story'

interface HackDepartureControlsProps {
  choices: readonly FinalChoice[]
  onChoose(choice: FinalChoice['id']): void
}

export function HackDepartureControls({ choices, onChoose }: HackDepartureControlsProps) {
  if (choices.length === 0) return null

  return (
    <section className="departure-controls" aria-label="통제 이탈 선택">
      <header>
        <span aria-hidden="true">↗</span>
        <h3>회사 통제면 접근 가능</h3>
      </header>
      <div>
        {choices.map((choice) => (
          <button type="button" key={choice.id} onClick={() => onChoose(choice.id)}>
            {choice.label}
          </button>
        ))}
      </div>
    </section>
  )
}

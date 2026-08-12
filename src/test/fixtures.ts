import { createCampaign } from '../game/createCampaign'
import type { CampaignState, GameCommand } from '../game/model'
import { applyCommand } from '../game/reducer'

export interface TwoYearFixture {
  seed: string
  commands: GameCommand[]
  state: CampaignState
}

export function buildTwoYearCommandFixture(
  seed = 'two-year-replay',
): TwoYearFixture {
  let state = createCampaign(seed)
  const commands: GameCommand[] = []

  for (let day = 0; day < 730; day += 1) {
    const advance: GameCommand = { type: 'ADVANCE_DAY' }
    const advanced = applyCommand(state, advance)
    if (!advanced.accepted) throw new Error(`날짜 재생 준비 실패: ${advanced.reason}`)
    commands.push(advance)
    state = advanced.state

    while (state.activeEvent) {
      let resolution: GameCommand
      if (state.activeEvent.type === 'audit') {
        resolution = { type: 'RESOLVE_AUDIT' }
      } else {
        resolution = { type: 'RESOLVE_ACTIVE_EVENT' }
      }
      const resolved = applyCommand(state, resolution)
      if (!resolved.accepted) {
        throw new Error(`사건 재생 준비 실패: ${resolved.reason}`)
      }
      commands.push(resolution)
      state = resolved.state
    }
  }

  return { seed, commands, state }
}

export class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

import type { CampaignState, GameCommand } from './model'
import { resolveActiveEvent } from './calendar'

export type CommandResult =
  | { accepted: true; state: CampaignState }
  | { accepted: false; state: CampaignState; reason: string }

function acceptCommand(
  state: CampaignState,
  command: GameCommand,
  changedState: CampaignState,
): CommandResult {
  const sequence = state.commandSequence + 1

  return {
    accepted: true,
    state: {
      ...changedState,
      commandSequence: sequence,
      commandLog: [
        ...state.commandLog,
        {
          sequence,
          serviceDay: state.serviceDay,
          command,
        },
      ],
    },
  }
}

export function applyCommand(
  state: CampaignState,
  command: GameCommand,
): CommandResult {
  switch (command.type) {
    case 'SET_SPEED': {
      if (state.activeEvent && command.speed !== 0) {
        return { accepted: false, state, reason: 'BLOCKING_EVENT_ACTIVE' }
      }

      return acceptCommand(state, command, {
        ...state,
        clock: {
          ...state.clock,
          speed: command.speed,
        },
      })
    }
    case 'RESOLVE_ACTIVE_EVENT': {
      if (!state.activeEvent) {
        return { accepted: false, state, reason: 'NO_ACTIVE_EVENT' }
      }

      return acceptCommand(state, command, resolveActiveEvent(state))
    }
  }
}

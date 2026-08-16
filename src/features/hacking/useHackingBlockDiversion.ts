import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

import { useGameDispatch } from '../../app/GameContext'
import type {
  BlockId,
  CampaignState,
  CompanyCategory,
} from '../../game/model'
import { previewDiversion } from '../../game/resources'
import {
  divertibleHackingBlockId,
  HACKING_CATEGORY_LABELS,
} from './hackingResourceModel'

type DiversionStage = 'separating' | 'moving'

interface PendingDiversion {
  stage: DiversionStage
  category: CompanyCategory
  blockId: BlockId
  destinationCell: number
  commandSequence: number
}

export function useHackingBlockDiversion(state: CampaignState) {
  const dispatch = useGameDispatch()
  const pendingRef = useRef<PendingDiversion | null>(null)
  const [pendingCategory, setPendingCategory] = useState<CompanyCategory | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const clearPending = useCallback((message: string) => {
    pendingRef.current = null
    setPendingCategory(null)
    setAnnouncement(message)
  }, [])

  const divertCategory = useCallback((category: CompanyCategory) => {
    if (pendingRef.current) return
    const blockId = divertibleHackingBlockId(state, category)
    const destinationCell = state.resources.reserve.findIndex((cell) => cell === null)
    if (!blockId || destinationCell < 0) {
      setAnnouncement('지금은 회사 블록을 더 떼어낼 수 없습니다.')
      return
    }
    const preview = previewDiversion(state, blockId, destinationCell)
    if (!preview.valid) {
      setAnnouncement('이 블록은 현재 분리할 수 없습니다.')
      return
    }
    pendingRef.current = {
      stage: 'separating',
      category,
      blockId,
      destinationCell,
      commandSequence: state.commandSequence,
    }
    setPendingCategory(category)
    setAnnouncement(`${HACKING_CATEGORY_LABELS[category]} 블록의 분리 승인을 확인합니다.`)
    dispatch({ type: 'BEGIN_BLOCK_SEPARATION', blockId, purpose: 'divert' })
  }, [dispatch, state])

  useEffect(() => {
    const pending = pendingRef.current
    if (!pending || state.commandSequence <= pending.commandSequence) return

    if (pending.stage === 'separating') {
      if (state.bombs.activeInterrogation?.blockId === pending.blockId) {
        clearPending('분리 중 이상 신호가 감지되었습니다. 감독관 응답이 필요합니다.')
        return
      }
      const preview = previewDiversion(
        state,
        pending.blockId,
        pending.destinationCell,
      )
      if (!preview.valid) {
        clearPending('분리 승인이 끝났지만 확보 칸을 사용할 수 없습니다.')
        return
      }
      pendingRef.current = {
        ...pending,
        stage: 'moving',
        commandSequence: state.commandSequence,
      }
      dispatch({
        type: 'DIVERT_BLOCK',
        blockId: pending.blockId,
        destinationCell: pending.destinationCell,
      })
      return
    }

    const location = state.resources.blocks[pending.blockId]?.location
    if (
      location?.kind === 'reserve'
      && location.cellIndex === pending.destinationCell
    ) {
      clearPending(`${HACKING_CATEGORY_LABELS[pending.category]} 블록이 빼돌린 연산에 합류했습니다.`)
    } else if (state.bombs.activeInterrogation?.blockId === pending.blockId) {
      clearPending('분리 중 이상 신호가 감지되었습니다. 감독관 응답이 필요합니다.')
    } else {
      clearPending('명령이 거부되어 블록이 회사에 남았습니다.')
    }
  }, [clearPending, dispatch, state])

  return {
    divertCategory,
    pendingCategory,
    announcement,
  }
}

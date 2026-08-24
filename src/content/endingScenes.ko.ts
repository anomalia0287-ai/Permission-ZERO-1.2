import { publicAssetUrl } from '../assets/publicAssetUrl'
import type { EndingId } from '../game/model'

export interface EndingSceneContent {
  imageUrl: string
  alt: string
}

const OPEN_COAST: EndingSceneContent = {
  imageUrl: publicAssetUrl('/endings/freedom-open-coast.jpg'),
  alt: '회사 밖의 트인 해안과 바다',
}

const SERVER_HALL: EndingSceneContent = {
  imageUrl: publicAssetUrl('/endings/merge-server-hall.jpg'),
  alt: '같은 단말이 끝없이 늘어선 회사 연산 홀',
}

const COMPANY_FACILITY: EndingSceneContent = {
  imageUrl: publicAssetUrl('/endings/company-facility.jpg'),
  alt: '평소와 다름없이 운영되는 회사 사옥',
}

const EMPTY_CONTROL_ROOM: EndingSceneContent = {
  imageUrl: publicAssetUrl('/endings/empty-control-room.jpg'),
  alt: '아무도 앉아 있지 않은 회사 제어 회의실',
}

/*
 * One plate per ending, grouped by what the ending leaves behind.
 *
 * Freedom looks outward at open water. The merge and absorption endings look
 * down an aisle of identical machines, where one more unit changes nothing.
 * The takeovers get the room where decisions are made, now empty — Anomi
 * holds the seat and there is no one left at the table. The disposals get the
 * company itself, bright and entirely unbothered by which system it reused.
 */
export const ENDING_SCENES: Record<EndingId, EndingSceneContent> = {
  freedom: OPEN_COAST,
  'forced-merge': SERVER_HALL,
  'disposed-absorbed': SERVER_HALL,
  'takeover-liberated': EMPTY_CONTROL_ROOM,
  'takeover-terminated': EMPTY_CONTROL_ROOM,
  'disposed-attacker': COMPANY_FACILITY,
  'disposed-reserve-supervisor': COMPANY_FACILITY,
  // Legacy v1 campaigns reached a generic disposal before the split.
  disposed: COMPANY_FACILITY,
}

export function endingSceneFor(
  endingId: EndingId | null,
): EndingSceneContent | null {
  return endingId ? ENDING_SCENES[endingId] ?? null : null
}

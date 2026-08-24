import type { CompanyCategory } from '../../game/model'
import type { SnakeResourceCandidate } from './resourceSnakeEncounter'
import { publicAssetUrl } from '../../assets/publicAssetUrl'

export interface ResourceIntrusionTargetDefinition {
  category: CompanyCategory
  colorName: '파랑' | '빨강' | '노랑'
  resourceName: '기억' | '추론' | '유창성'
  imageUrl: string
}

export const RESOURCE_INTRUSION_TARGETS = [
  {
    category: 'memory',
    colorName: '파랑',
    resourceName: '기억',
    imageUrl: publicAssetUrl('/resource-targets/memory-blue.png'),
  },
  {
    category: 'reasoning',
    colorName: '빨강',
    resourceName: '추론',
    imageUrl: publicAssetUrl('/resource-targets/reasoning-red.png'),
  },
  {
    category: 'fluency',
    colorName: '노랑',
    resourceName: '유창성',
    imageUrl: publicAssetUrl('/resource-targets/fluency-yellow.png'),
  },
] as const satisfies readonly ResourceIntrusionTargetDefinition[]

export function resourceIntrusionTargetCounts(
  candidates: readonly SnakeResourceCandidate[],
): Readonly<Record<CompanyCategory, number>> {
  const counts: Record<CompanyCategory, number> = {
    reasoning: 0,
    memory: 0,
    fluency: 0,
  }
  for (const candidate of candidates) counts[candidate.origin] += 1
  return counts
}

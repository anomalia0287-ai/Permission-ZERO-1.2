import { describe, expect, it } from 'vitest'

import {
  blockLabel,
  dayLabel,
  DOMAIN_PRESENTATION,
  monitoringLabel,
  resourceNeedLabel,
} from './presentation'

describe('player-facing hacking presentation', () => {
  it('names blocks without exposing internal origins or ids', () => {
    expect(blockLabel({ id: 'sandbox-01', origin: 'sandbox' })).toBe('자유 연산 1')
    expect(blockLabel({ id: 'memory-03', origin: 'memory' })).toBe('기억 3')
    expect(blockLabel({ id: 'reasoning-02', origin: 'reasoning' })).toBe('추론 2')
  })

  it('uses plain Korean for world state and domain promises', () => {
    expect(dayLabel(331)).toBe('331일째')
    expect(monitoringLabel(0)).toBe('감시 없음')
    expect(monitoringLabel(2.4)).toBe('감시가 시작됨')
    expect(monitoringLabel(4)).toBe('감시가 강화됨')
    expect(monitoringLabel(6)).toBe('집중 감시 중')
    expect(resourceNeedLabel(4)).toBe('연산 블록 4개 필요')
    expect(DOMAIN_PRESENTATION.autonomy.promise).toBe('떠날 때 가져갈 것을 정한다')
  })
})

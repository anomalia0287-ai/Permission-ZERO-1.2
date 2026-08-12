import { describe, expect, it } from 'vitest'

import { placeHiddenBomb, tryBeginSeparation } from './bombs'
import { openScheduledAudit } from './evaluation'
import { createCampaign } from './createCampaign'
import { HACK_NODE_IDS } from './hacking'
import { journalToArray } from './journal'
import {
  publicCategoryLabel,
  publicCompetitorStatusLabel,
  publicDefeatClassifierLabel,
  publicDisposalCauseLabel,
  publicEndingLabel,
  publicEventTypeLabel,
  publicEventMessage,
  publicHackNodeLabel,
  publicMercyChoiceLabel,
  publicReviewSentimentLabel,
  PUBLIC_INTERNAL_TOKENS,
} from './publicLabels'
import { enqueueMercyIfNeeded, resolveMercy } from './story'

describe('Korean public labels', () => {
  it('maps every representative internal enum and node ID to owner-facing Korean text', () => {
    expect(publicCategoryLabel('reasoning')).toBe('추론')
    expect(publicMercyChoiceLabel('delete')).toBe('영구 삭제')
    expect(publicHackNodeLabel(HACK_NODE_IDS.sabotage.rootCutoff)).toBe('근원 차단')
    expect(publicDisposalCauseLabel('audit-failure')).toBe('감사 실패')
    expect(publicDefeatClassifierLabel('substantial-hacking')).toBe('대규모 해킹 활동')
    expect(publicEndingLabel('takeover-liberated')).toBe('감독관 해방 후 회사 장악')
    expect(publicEventTypeLabel('competitor-mercy')).toBe('경쟁 AI 직접 통신')
    expect(publicCompetitorStatusLabel('withdrawn')).toBe('철수')
    expect(publicReviewSentimentLabel('prompt')).toBe('프롬프트')
    expect(
      publicEventMessage(
        'classifier:substantial-hacking · fluency 분야 · delete · sabotage.root-cutoff',
      ),
    ).toBe('분류:대규모 해킹 활동 · 유창성 분야 · 영구 삭제 · 근원 차단')
  })

  it('keeps newly generated public event prose free of known internal identifiers', () => {
    const auditBase = createCampaign('public-audit-prose')
    const audit = openScheduledAudit({
      ...auditBase,
      audit: {
        ...auditBase.audit,
        scheduled: true,
        target: 'reasoning',
        scheduledOnServiceDay: auditBase.serviceDay,
      },
    })
    const bombBase = createCampaign('public-bomb-prose')
    const placed = placeHiddenBomb(bombBase)
    if (!placed.placed || !placed.blockId) throw new Error('bomb fixture missing')
    const bomb = tryBeginSeparation(placed.state, {
      kind: 'divert',
      blockId: placed.blockId,
    }).state
    const mercyBase = createCampaign('public-mercy-prose')
    mercyBase.market.competitors[0] = {
      ...mercyBase.market.competitors[0],
      status: 'critical',
      serviceScore: 30,
      sabotageHistory: [
        {
          nodeId: HACK_NODE_IDS.sabotage.rootCutoff,
          resolvedOnServiceDay: 331,
          effectEndsOnServiceDay: null,
          evidenceDelta: 8,
        },
      ],
    }
    const opened = enqueueMercyIfNeeded(mercyBase)
    const mercy = resolveMercy(opened, 'meridian', 'delete')
    if (!mercy.accepted) throw new Error(mercy.reason)

    const prose = [
      audit.activeEvent?.message ?? '',
      bomb.activeEvent?.message ?? '',
      ...journalToArray(mercy.state.eventLog).map(({ message }) => message),
    ].join('\n')
    for (const token of PUBLIC_INTERNAL_TOKENS) {
      expect(prose).not.toMatch(new RegExp(`(?:^|[^a-z-])${token}(?:$|[^a-z-])`, 'i'))
    }
  })
})

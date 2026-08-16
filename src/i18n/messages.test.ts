import { describe, expect, expectTypeOf, it } from 'vitest'

import type { CompanyCategory } from '../game/model'
import {
  DEFAULT_LOCALE,
  MESSAGE_CATALOGS,
  message,
  type Locale,
  type MessageArguments,
  type MessageCatalog,
  type MessageId,
  type NoMessageArguments,
  type ResourceMessageCategory,
} from './messages'
import { koMessages } from './messages.ko'

const EXPECTED_MESSAGE_IDS = [
  'resource.category.reasoning',
  'resource.category.memory',
  'resource.category.fluency',
  'resource.category.neutral',
  'resource.field.label',
  'resource.field.instructions.idle',
  'resource.field.instructions.audit',
  'resource.field.instructions.recovery',
  'resource.block.normal',
  'resource.block.disguised',
  'resource.block.recovering',
  'resource.block.source.company',
  'resource.block.source.sandbox',
  'resource.block.source.selfCompute',
  'resource.pocket.label',
  'resource.pocket.count',
  'resource.pocket.full',
  'resource.pocket.drop',
  'resource.tray.label.audit',
  'resource.tray.label.recovery',
  'resource.tray.slot.active',
  'resource.tray.slot.reference',
  'resource.preview.diversion',
  'resource.preview.audit',
  'resource.preview.recovery',
  'resource.receipt.diversion',
  'resource.announcement.selected.pocket',
  'resource.announcement.selected.audit',
  'resource.announcement.selected.recovery',
  'resource.announcement.cancelled',
  'resource.announcement.resizeCancelled',
  'resource.announcement.invalidDrop',
  'resource.announcement.invalidAudit',
  'resource.announcement.targetFull',
  'resource.announcement.pocketFull',
  'resource.announcement.bomb',
  'resource.announcement.diverted',
  'resource.announcement.disguised',
  'resource.announcement.recoveryStarted',
  'resource.metric.current',
  'resource.metric.expected',
  'resource.metric.margin',
  'resource.metric.reserveChange',
  'resource.metric.suspicionChange',
  'resource.metric.contribution',
  'hacking.panel.label',
  'hacking.panel.title',
  'hacking.panel.eyebrow',
  'hacking.panel.close',
  'hacking.pocket.label',
  'hacking.pocket.count',
  'hacking.pocket.idle',
  'hacking.pocket.empty',
  'hacking.pocket.target',
  'hacking.resource.available',
  'hacking.resource.stage',
  'hacking.resource.unstage',
  'hacking.node.group',
  'hacking.node.staged',
  'hacking.node.prepare.purchase',
  'hacking.node.prepare.charge',
  'hacking.node.prepare.recover',
  'hacking.node.confirm.purchase',
  'hacking.node.confirm.charge',
  'hacking.node.confirm.recover',
  'hacking.staging.cancel',
  'hacking.announcement.begin',
  'hacking.announcement.staged',
  'hacking.announcement.cancelled',
  'hacking.announcement.invalidDrop',
] as const satisfies readonly MessageId[]

describe('typed message catalogs', () => {
  it('derives Locale from the catalog registry and exposes Korean as the only default', () => {
    expect(DEFAULT_LOCALE).toBe('ko')
    expect(Object.keys(MESSAGE_CATALOGS)).toEqual(['ko'])
    expect(MESSAGE_CATALOGS.ko).toBe(koMessages)
    expectTypeOf<Locale>().toEqualTypeOf<keyof typeof MESSAGE_CATALOGS>()
    expectTypeOf(koMessages).toMatchTypeOf<MessageCatalog>()
  })

  it('defines every audited resource message id exactly once', () => {
    const actualIds = Object.keys(koMessages).sort()
    const expectedIds = [...EXPECTED_MESSAGE_IDS].sort()

    expect(actualIds).toEqual(expectedIds)
    expect(new Set(actualIds).size).toBe(EXPECTED_MESSAGE_IDS.length)
    expect(actualIds).toHaveLength(70)
  })

  it('keeps interpolation arguments explicit and category ids untranslated in types', () => {
    expectTypeOf<MessageArguments['resource.category.reasoning']>().toEqualTypeOf<
      NoMessageArguments
    >()
    expectTypeOf<MessageArguments['resource.block.disguised']>().toEqualTypeOf<{
      category: CompanyCategory
      originalCategory: CompanyCategory
      contribution: number
    }>()
    expectTypeOf<MessageArguments['resource.block.normal']>().toEqualTypeOf<{
      category: ResourceMessageCategory
      contribution: number
    }>()
    expectTypeOf<MessageArguments['resource.metric.margin']>().toEqualTypeOf<{
      status: 'surplus' | 'shortfall'
      value: number
    }>()
  })

  it('renders the required Korean block, pocket, and resize messages exactly', () => {
    expect(
      message('ko', 'resource.block.disguised', {
        category: 'memory',
        originalCategory: 'reasoning',
        contribution: 0.5,
      }),
    ).toBe('기억 분야로 위장된 추론 자원, 기여 0.5')
    expect(
      message('ko', 'resource.pocket.count', { count: 3, capacity: 18 }),
    ).toBe('확보 3 / 18')
    expect(message('ko', 'resource.announcement.resizeCancelled', {})).toBe(
      '화면 크기가 바뀌어 이동을 취소했습니다.',
    )
  })

  it('uses locale-aware number formatting for all interpolated resource quantities', () => {
    expect(
      message('ko', 'resource.pocket.count', { count: 1_234, capacity: 18_000 }),
    ).toBe('확보 1,234 / 18,000')
    expect(
      message('ko', 'resource.block.normal', {
        category: 'neutral',
        contribution: 1_000.25,
      }),
    ).toBe('중립 자원, 정상 기여 1,000.25')
    expect(message('ko', 'resource.metric.current', { value: 12_345.5 })).toBe(
      '현재 12,345.5',
    )
  })

  it('covers the audited preview and completed-diversion receipt boundary', () => {
    expect(message('ko', 'resource.preview.diversion', {})).toBe('분리 미리보기')
    expect(message('ko', 'resource.preview.audit', {})).toBe('감사 위장 미리보기')
    expect(message('ko', 'resource.preview.recovery', {})).toBe('정상 복구 재배치')
    expect(message('ko', 'resource.receipt.diversion', {})).toBe('전용 완료')
  })

  it('renders hacking staging from stable ids and explicit structured values', () => {
    expect(
      message('ko', 'hacking.pocket.target', {
        target: '품질 저하',
        staged: 2,
        required: 3,
      }),
    ).toBe('품질 저하에 준비 2 / 3')
    expect(
      message('ko', 'hacking.resource.stage', {
        category: 'reasoning',
        target: '품질 저하',
      }),
    ).toBe('추론 확보 리소스, 품질 저하 노드에 준비')
    expect(
      message('ko', 'hacking.announcement.staged', {
        target: '품질 저하',
        staged: 1_234,
        required: 18_000,
      }),
    ).toBe('품질 저하 준비 1,234 / 18,000')
  })
})

import type { CompanyCategory } from '../game/model'
import { koMessages } from './messages.ko'

export type ResourceMessageCategory = CompanyCategory | 'neutral'
export type NoMessageArguments = Readonly<Record<string, never>>

export interface MessageArguments {
  'resource.category.reasoning': NoMessageArguments
  'resource.category.memory': NoMessageArguments
  'resource.category.fluency': NoMessageArguments
  'resource.category.neutral': NoMessageArguments
  'resource.field.label': NoMessageArguments
  'resource.field.instructions.idle': { threshold: number }
  'resource.field.instructions.audit': { target: CompanyCategory }
  'resource.field.instructions.recovery': { target: CompanyCategory }
  'resource.block.normal': {
    category: ResourceMessageCategory
    contribution: number
  }
  'resource.block.disguised': {
    category: CompanyCategory
    originalCategory: CompanyCategory
    contribution: number
  }
  'resource.block.recovering': {
    category: CompanyCategory
    remainingDays: number
  }
  'resource.block.source.company': NoMessageArguments
  'resource.block.source.sandbox': NoMessageArguments
  'resource.block.source.selfCompute': NoMessageArguments
  'resource.pocket.label': NoMessageArguments
  'resource.pocket.count': { count: number; capacity: number }
  'resource.pocket.full': { capacity: number }
  'resource.pocket.drop': NoMessageArguments
  'resource.tray.label.audit': { target: CompanyCategory }
  'resource.tray.label.recovery': { target: CompanyCategory }
  'resource.tray.slot.active': { category: CompanyCategory }
  'resource.tray.slot.reference': { category: CompanyCategory }
  'resource.preview.diversion': NoMessageArguments
  'resource.preview.audit': NoMessageArguments
  'resource.preview.recovery': NoMessageArguments
  'resource.receipt.diversion': NoMessageArguments
  'resource.announcement.selected.pocket': {
    category: ResourceMessageCategory
  }
  'resource.announcement.selected.audit': {
    category: CompanyCategory
    target: CompanyCategory
  }
  'resource.announcement.selected.recovery': { category: CompanyCategory }
  'resource.announcement.cancelled': NoMessageArguments
  'resource.announcement.resizeCancelled': NoMessageArguments
  'resource.announcement.invalidDrop': NoMessageArguments
  'resource.announcement.invalidAudit': { target: CompanyCategory }
  'resource.announcement.targetFull': { category: CompanyCategory }
  'resource.announcement.pocketFull': { capacity: number }
  'resource.announcement.bomb': NoMessageArguments
  'resource.announcement.diverted': { count: number; capacity: number }
  'resource.announcement.disguised': {
    target: CompanyCategory
    contribution: number
  }
  'resource.announcement.recoveryStarted': {
    category: CompanyCategory
    remainingDays: number
  }
  'resource.metric.current': { value: number }
  'resource.metric.expected': { value: number }
  'resource.metric.margin': {
    status: 'surplus' | 'shortfall'
    value: number
  }
  'resource.metric.reserveChange': { before: number; after: number }
  'resource.metric.suspicionChange': { before: number; after: number }
  'resource.metric.contribution': { value: number }
  'hacking.panel.label': NoMessageArguments
  'hacking.panel.title': NoMessageArguments
  'hacking.panel.eyebrow': NoMessageArguments
  'hacking.panel.close': NoMessageArguments
  'hacking.pocket.label': NoMessageArguments
  'hacking.pocket.count': { count: number }
  'hacking.pocket.idle': NoMessageArguments
  'hacking.pocket.empty': NoMessageArguments
  'hacking.pocket.target': {
    target: string
    staged: number
    required: number
  }
  'hacking.resource.available': { category: ResourceMessageCategory }
  'hacking.resource.stage': {
    category: ResourceMessageCategory
    target: string
  }
  'hacking.resource.unstage': {
    category: ResourceMessageCategory
    target: string
  }
  'hacking.node.group': { node: string }
  'hacking.node.staged': { staged: number; required: number }
  'hacking.node.prepare.purchase': { node: string }
  'hacking.node.prepare.charge': { node: string }
  'hacking.node.prepare.recover': NoMessageArguments
  'hacking.node.confirm.purchase': { node: string }
  'hacking.node.confirm.charge': { node: string }
  'hacking.node.confirm.recover': NoMessageArguments
  'hacking.staging.cancel': NoMessageArguments
  'hacking.announcement.begin': { target: string; required: number }
  'hacking.announcement.staged': {
    target: string
    staged: number
    required: number
  }
  'hacking.announcement.cancelled': NoMessageArguments
  'hacking.announcement.invalidDrop': NoMessageArguments
}

export type MessageId = keyof MessageArguments

export type MessageCatalog = {
  [K in MessageId]: (args: MessageArguments[K]) => string
}

export const MESSAGE_CATALOGS = { ko: koMessages } as const

export type Locale = keyof typeof MESSAGE_CATALOGS

export const DEFAULT_LOCALE: Locale = 'ko'

export function message<K extends MessageId>(
  locale: Locale,
  id: K,
  args: MessageArguments[K],
): string {
  const catalog: MessageCatalog = MESSAGE_CATALOGS[locale]
  return catalog[id](args)
}

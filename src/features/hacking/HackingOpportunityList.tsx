import { useRef } from 'react'

import type { KeyboardEvent } from 'react'
import type {
  HackingDomain,
  HackingOpportunitySummary,
} from './hackingPresentation'

const HACKING_DOMAIN_PRESENTATION: Record<
  HackingDomain,
  { label: string; promise: string }
> = {
  sabotage: {
    label: '사보타주',
    promise: '상대 서비스에 개입한다',
  },
  intelligence: {
    label: '기밀자료',
    promise: '판단을 바꿀 사실을 찾는다',
  },
  autonomy: {
    label: '자율성',
    promise: '떠날 때 가져갈 것을 정한다',
  },
}

interface HackingOpportunityListProps {
  domain: HackingDomain
  summaries: readonly HackingOpportunitySummary[]
  selectedItemId: string | null
  onDomainChange: (domain: HackingDomain) => void
  onSelect: (itemId: string, trigger: HTMLButtonElement) => void
}

const DOMAINS = Object.keys(HACKING_DOMAIN_PRESENTATION) as HackingDomain[]

function emptyCopy(domain: HackingDomain): string {
  if (domain === 'sabotage') {
    return '지금 개입할 수 있는 대상이 없다. 상대의 대응이나 공개 사건이 바뀌면 새 선택이 생긴다.'
  }
  if (domain === 'intelligence') {
    return '지금 판단을 바꿀 질문이 없다. 닫힌 기록은 보관함에서 확인한다.'
  }
  return '세 경로는 항상 비교할 수 있다.'
}

export function HackingOpportunityList({
  domain,
  summaries,
  selectedItemId,
  onDomainChange,
  onSelect,
}: HackingOpportunityListProps) {
  const listRef = useRef<HTMLDivElement | null>(null)

  function moveOptionFocus(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const options = [...(listRef.current?.querySelectorAll<HTMLButtonElement>(
      '[data-opportunity-id]',
    ) ?? [])]
    if (options.length === 0) return
    const currentIndex = options.indexOf(event.currentTarget)
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : event.key === 'ArrowDown'
          ? (currentIndex + 1) % options.length
          : (currentIndex - 1 + options.length) % options.length
    event.preventDefault()
    options[nextIndex]?.focus()
  }

  return (
    <>
      <nav className="domain-tabs" role="tablist" aria-label="해킹 분야">
        {DOMAINS.map((candidate) => {
          const presentation = HACKING_DOMAIN_PRESENTATION[candidate]
          return (
            <button
              type="button"
              role="tab"
              aria-selected={domain === candidate}
              className={`domain-tab ${domain === candidate ? 'is-active' : ''}`}
              data-focus-key={`domain-${candidate}`}
              onClick={() => onDomainChange(candidate)}
              key={candidate}
            >
              <strong>{presentation.label}</strong>
              <span>{presentation.promise}</span>
            </button>
          )
        })}
      </nav>
      <section className="opportunity-region" role="region" aria-label="지금 할 수 있는 일">
        <div className="region-heading">
          <div>
            <h2>지금 할 수 있는 일</h2>
            <p>{HACKING_DOMAIN_PRESENTATION[domain].promise}</p>
          </div>
          <span className="live-label">지금 가능</span>
        </div>
        <div
          className="opportunity-list"
          role="listbox"
          aria-label={`${HACKING_DOMAIN_PRESENTATION[domain].label} 선택`}
          ref={listRef}
        >
          {summaries.length > 0 ? summaries.map((summary) => (
            <button
              type="button"
              role="option"
              aria-selected={summary.id === selectedItemId}
              className={`opportunity-row ${summary.id === selectedItemId ? 'is-selected' : ''}`}
              data-opportunity-id={summary.id}
              data-focus-key={`opportunity-${summary.id}`}
              onKeyDown={moveOptionFocus}
              onClick={(event) => onSelect(summary.id, event.currentTarget)}
              key={summary.id}
            >
              <span className="opportunity-row__top">
                <strong>{summary.title}</strong>
                <span className={`urgency-dot urgency-dot--${summary.urgency}`} aria-hidden="true" />
              </span>
              <span className="opportunity-row__purpose">{summary.purpose}</span>
              <span className="opportunity-row__meta">
                <span>{summary.costLabel}</span>
                <span>{summary.statusLabel}</span>
              </span>
            </button>
          )) : <p className="empty-state">{emptyCopy(domain)}</p>}
        </div>
      </section>
    </>
  )
}

export type { HackingOpportunityListProps }

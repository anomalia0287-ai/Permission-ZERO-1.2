# Shared UI primitives

The current mockup is vanilla HTML/CSS/ES modules. It has no component library. The reusable visual primitives are emitted by `design-mockup/scripts/render.js`.

## ServiceHeader
- Source: `design-mockup/scripts/render.js`
- Description: global service controls and campaign metrics.

```js
function serviceHeader(state) {
  return `<header class="service-bar" aria-label="서비스 제어">
    <div class="service-brand"><span class="service-brand__mark"><i>PZ</i></span><span><small>비공개 서비스 인스턴스</small><strong>PERMISSION ZERO</strong></span></div>
    <div class="speed-control"><button data-action="pause">Ⅱ</button>${[1, 2, 4].map((speed) => `<button data-action="speed" data-speed="${speed}">${speed}×</button>`).join('')}</div>
    <time class="service-date">${state.serviceDate}</time>
    <dl class="service-metrics"><div><dt>평판</dt><dd>${state.reputation}</dd></div><div><dt>주간 갱신</dt><dd>${state.weeklyCountdown}일</dd></div><div><dt>월간 평가</dt><dd>${state.monthlyCountdown}일</dd></div></dl>
    <nav class="service-actions"><button data-action="settings">설정</button><button data-action="sound">소리</button><button data-action="guide">가이드</button></nav>
  </header>`
}
```

## ReviewCard
- Source: `design-mockup/scripts/render.js`
- Description: selectable public-review row.

```js
function reviewMarkup(review) {
  return `<button class="review-card review-card--${review.sentiment}" data-action="open-review" data-review-id="${review.id}">
    <span class="review-card__meta"><strong>${review.author}</strong><span>${review.sentiment}</span><time>${review.date}</time></span>
    <span class="review-card__text">${review.text}</span><span class="review-card__open">상세 보기 ↗</span>
  </button>`
}
```

## ResourceBlock
- Source: `design-mockup/scripts/render.js`
- Description: interactive 3×6 resource-cell primitive with company, empty, selected, and diverted states.

```js
function blockMarkup(domain, block, selection) {
  const selected = selection?.blockId === block.id
  return `<button class="resource-block ${block.active ? 'is-company' : 'is-empty'} ${selected ? 'is-selected' : ''}" data-action="select-block" data-domain-id="${domain.id}" data-block-id="${block.id}" aria-pressed="${selected}">${String(block.position).padStart(2, '0')}</button>`
}
```

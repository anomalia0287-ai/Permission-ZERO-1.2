# Extractable components

## ServiceHeader
- Source: `design-mockup/scripts/render.js`
- Category: layout
- Description: service identity, speed, date, metrics, and global actions.
- Extractable props: speed, serviceDate, reputation, weeklyCountdown, monthlyCountdown.
- Hardcoded: brand label and action labels.

## ReviewCard
- Source: `design-mockup/scripts/render.js`
- Category: basic
- Description: public review with author, sentiment, date, and detail affordance.
- Extractable props: author, sentiment, date, text.

## ResourceBlock
- Source: `design-mockup/scripts/render.js`
- Category: basic
- Description: resource lattice cell.
- Extractable props: active, selected, diverted, position, domain.

No current hacking-card component is approved for extraction or reuse.

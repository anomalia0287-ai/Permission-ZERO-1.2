# PERMISSION ZERO — One-Screen UI Brief

> **2026-08-16 status:** This brief remains a historical layout and information-density reference. Reserve capacity, a 9×2 destination grid, `/18`, generic hacking cost, and future-node disclosure are superseded by the [`hacking resource uncertainty contract`](../superpowers/specs/2026-08-16-hacking-resource-uncertainty-contract.ko.md). Do not reintroduce them while applying the one-screen composition goals.

## Goal

- Build a playable company-control surface for a player who is an owned AI.
- The player must read time, performance, reserve capacity, suspicion, market pressure, reviews, and current incidents without page scrolling.
- Success means the next useful action is legible within two seconds while the world still feels inhabited during idle time.

## Format

- Primary viewport: 1280×720; expanded viewport: 1440×900.
- Outer safe margin: 10–14px.
- No document scrolling at either target viewport.

## Layout

- Top: 52px control strip for service date, speed, reputation, update countdowns, and settings access.
- Left: public review/request stream with hacking access anchored at the bottom.
- Center: three company resource fields, aligned 9×2 reserve, and compact performance plot.
- Right: supervisor presence and suspicion, market share, current/internal history channel.
- Bottom access points stay inside their owning column; do not add a generic site footer.

## Type system

- Korean UI: system grotesk, 400/550/650 weights.
- Metrics, dates, and micro-labels: system monospace.
- Labels use restrained tracking; body copy remains normally tracked and readable.

## Color and material

- Matte graphite-black base with cold steel-blue company surfaces.
- One ownership accent: amber, reserved for diverted resources and active player controls.
- Red is semantic only: blocking warnings, failure, and high suspicion.
- Fine structural rules, sparse coordinate marks, restrained grain; no generic glass cards or neon rainbow.

## Interaction hierarchy

- Primary: resource movement and blocking-event decisions.
- Secondary: speed, hacking, current message.
- Tertiary: history, statistics, settings, guide.
- Keyboard focus is always visible; color is never the only state signal.

## Negative constraints

- Do not copy the supplied structural sketch's visual styling.
- No marketing hero, floating glass panels, decorative 3D orb, or excessive rounded cards.
- No raw IDs, schema names, command traces, or developer diagnostics in player-facing UI.

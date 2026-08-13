# Theme

## Compact token summary

- Background: `#030a1e`, `#051334`, `#071a45`
- Primary text: `#fffdf6`; secondary text: `#b7c5d7`
- Structural metal: `#e6cd8a`, `#ceb36e`, `#9f7933`
- State accents: cyan `#86c7dd`, amber `#dea856`, red `#d9635d`, green `#76b99a`
- Korean UI: SUIT Variable; Korean display: Gowun Batang; English display: Cormorant Garamond
- Geometry: square or 6–14px chamfered corners; never rounded cards or pills
- Lines: 1px low-contrast field lines; gold reserved for hierarchy, selection, and action
- Motion: 160–260ms ease-out; transform/opacity only; reduced-motion fallback

## Raw token source

```css
:root {
  --navy-950:#030a1e; --navy-925:#051334; --navy-900:#071a45; --navy-850:#0a2356;
  --ivory-50:#fffdf6; --ivory-100:#f4eedf; --slate-300:#b7c5d7; --slate-500:#8194ac;
  --brass-200:#f2dfaa; --brass-300:#e6cd8a; --brass-400:#ceb36e; --brass-500:#9f7933;
  --company-400:#86c7dd; --reserve-400:#dea856; --danger-400:#d9635d; --positive-400:#76b99a;
  --type-micro:.8125rem; --type-meta:.9375rem; --type-body:1.0625rem; --type-control:1.125rem;
  --type-panel:1.625rem; --type-metric:2rem; --type-display:clamp(4rem,6vw,4.75rem);
  --space-1:.25rem; --space-2:.5rem; --space-3:.75rem; --space-4:1rem; --space-6:1.5rem; --space-8:2rem;
  --ease-ui:cubic-bezier(.2,.8,.2,1); --motion-fast:160ms; --motion-ui:220ms;
}
```

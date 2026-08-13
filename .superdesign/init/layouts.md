# Shared layouts

## Existing mockup shell
- Source: `design-mockup/index.html`
- Description: three mutually exclusive screens in a full-viewport shell.

```html
<main class="mockup-shell">
  <section class="screen title-screen deco-frame is-active" data-screen="title" aria-label="시작 화면">…</section>
  <section id="workspace-screen" class="screen workspace-screen" data-screen="workspace" aria-label="운영 화면" hidden></section>
  <section class="screen hacking-screen" data-screen="hacking" aria-label="해킹 네트워크" hidden></section>
</main>
```

## Current rendered desktop workspace
- Source: `design-mockup/scripts/render.js`
- Structure: top service bar; left review column; center 3-domain resource board and 9×2 reserve; right supervisor/market column.
- Known redesign target: the hacking view currently uses a boxed 2×2 node catalog and fixed right inspector. Version 2 must not retain that structure.
